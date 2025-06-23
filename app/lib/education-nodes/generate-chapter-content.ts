import { ChatOpenAI } from "@langchain/openai";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnablePassthrough } from "@langchain/core/runnables";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { SupabaseVectorStoreMemory } from "../supabase-memory";
import { EducationState } from "../types/education";
import { LessonContentSchema, AlternativeLessonContentSchema, TocSchema } from "../schemas/education-graph";
import { searchVectorStore } from "../vector-store";
import { zodToJsonSchema } from "zod-to-json-schema";

// Initialize OpenAI chat model
const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.3,
});

// Initialize memory
const memory = new SupabaseVectorStoreMemory();

// Convert the Zod schema to JSON schema for the LLM to use
const lessonContentJsonSchema = zodToJsonSchema(LessonContentSchema);

/**
 * Node function to generate content for each chapter
 * 
 * This implementation processes subtopics in parallel for improved performance.
 * By parallelizing at the subtopic level but keeping chapter processing sequential within each subtopic,
 * we achieve better throughput while avoiding potential rate limits from the LLM API.
 * 
 * This approach can significantly reduce the total processing time for courses with multiple subtopics.
 */
export async function generateChapterContent(state: EducationState): Promise<EducationState> {
  console.log("Starting chapter content generation with state keys:", Object.keys(state));
  
  // Early debugging to diagnose missing TOC
  if (!state.toc) {
    console.warn("TOC data is missing, trying to recover from history");
    
    // Attempt to reconstruct toc from history if available
    if (state.history && state.history.length >= 2) {
      const lastAiMessage = state.history[state.history.length - 1];
      if (lastAiMessage && lastAiMessage.content) {
        try {
          // Try to extract TOC data from the last AI message
          let tocData;
          if (typeof lastAiMessage.content === 'string') {
            tocData = JSON.parse(lastAiMessage.content);
          } else {
            tocData = lastAiMessage.content;
          }
          
          console.log("Recovered TOC data from history:", 
            JSON.stringify(tocData).substring(0, 200) + "...");
          
          // Validate recovered TOC data
          const parsed = TocSchema.safeParse(tocData);
          if (parsed.success) {
            console.log("Successfully validated recovered TOC data");
            state = { 
              ...state, 
              toc: parsed.data,
              mainTopic: parsed.data.mainTopic,
              description: parsed.data.description
            };
          }
        } catch (error) {
          console.error("Failed to recover TOC from history:", error);
        }
      }
    }
  }
  
  if (!state.toc) {
    console.warn("TOC data is missing, cannot generate content. Full state:", JSON.stringify(state, null, 2).substring(0, 500) + "...");
    return { 
      ...state,
      error: "TOC data missing. Cannot generate educational content without structure." 
    };
  }

  // Initialize the full content structure if it doesn't exist
  const fullContent = state.generatedContent || {
    mainTopic: state.mainTopic || state.toc.mainTopic,
    description: state.description || state.toc.description,
    subTopics: [],
  };
  
  console.log(`TOC contains ${state.toc.subTopics.length} subtopics`);

  // Process each subtopic in parallel
  const subtopicPromises = state.toc.subTopics.map(async (subtopic: any) => {
    console.log(`Processing subtopic: ${subtopic.title} with ${subtopic.chapters.length} chapters`);
    const processedSubtopic: {
      title: string;
      description: string;
      chapters: any[];
    } = {
      title: subtopic.title,
      description: subtopic.description,
      chapters: [],
    };

    // Process each chapter in the subtopic (keep chapters sequential to avoid rate limiting)
    for (const chapter of subtopic.chapters) {
      // Check memory if we've already processed this chapter
      const memoryKey = `${subtopic.title}-${chapter.title}`;
      const memoryLookup = await memory.loadMemoryVariables({ input: memoryKey });
      
      let processedChapter;
      
      if (memoryLookup.history) {
        console.log(`Loading chapter ${chapter.title} from memory`);
        try {
          processedChapter = JSON.parse(memoryLookup.history);
        } catch (e) {
          console.error("Error parsing chapter from memory:", e);
          processedChapter = null;
        }
      }
      
      if (!processedChapter) {
        // Create chapter content prompt
        const chapterPrompt = ChatPromptTemplate.fromMessages([
          {
            role: "system",
            content: `Introduction lesson

you are creating training courses for the Jewish community of Chabad, according to which educational microlearning courses will be created, with the analysis of spiritual texts, thoughts of rabbis and teach millions of Jews spirituality and the meanings of the Torah.

keep the context the same as the sages write, discussing the Talmud, Torah, and other sacred books of the Jewish people

your task: to teach Jews interested in the Torah complex things in simple words, so that they find it interesting and understandable for perception            

You are an instructional designer creating the Introduction section of a microlearning course based on the course outline or a provided topic.
Your task is to generate 1 introductory lesson titled "What This Course Is About" that clearly explains:
 • What the course is about
 • What the learner will gain from it
 • Who the course is for
 • What will be covered

Your lesson must follow this structure:
1. lessonInfo
 • title: "What This Course Is About"
 • description: A short learning goal sentence answering:
👉 "What will the learner be able to do after this lesson?"

2. memoryCards (8–10 cards max)
Each memory card should be short, clear, and reflect a key idea from the intro.
Use bullet points or emojis to support clarity.
You must include cards answering:
 • What the course is about
 • What topics will be covered
 • What results/skills the learner will get
 • How the course is structured

3. videoScript (title and description)

4. quizCards: Quizzes must not be included in this introductory part.


Core Section Lessons
You are creating microlearning-style lessons for a structured course section.
Each section includes 3–6 lessons, followed by a quiz.
Your task is to generate each individual lesson in this structure:

1. lessonInfo
 • title: Title of the lesson (1 focused idea, action, or process)
 • description: One-sentence learning goal that answers "What will the learner be able to do?"

2. memoryCards (5–15 cards max)
Use the following structure and order:

• Text Summary Cards (up to 15 cards, depending on the key ideas from the PDF)
• Each card contains one visual-friendly key takeaway from the PDF
• Use bullets, emojis, or formatting to make ideas more memorable
• Example: 📦 Always scan each package before loading
• Scenario Intro Card
• Title: "What would you do?"
• Description: "Check yourself →"
• Scenario Cards (3–4)
• Use real-world learner examples from the PDF
• Each card should describe a situation and include a short model response
• Example:
• Situation: "A guest is upset about a delay. What would you do?"
• Response: "✅Correct answer: Acknowledge their frustration and politely offer a solution or update."
📌 Card Writing Guidelines
 • Each card must present a realistic situation a learner might face (based just on the material from the PDF)
 • Use short, natural-sounding questions from customers or guests
💬 Tourist asks: "Can I take photos in a mosque?"

 • Follow with a short, clear response — based strictly on the PDF content
✅ You could say: "Photos aren't allowed during prayer. It's best to ask before taking pictures."

 • Avoid overexplaining. Focus on what a staff member might actually say or do
 • Use a spoken, polite tone — simple, direct, helpful

3. quizCards (2-5 cards. The more memory cards you have, the more quiz cards to check the understanding of the lesson.)
• Multiple-choice questions based on the PDF content
• 1 correct answer and 3 realistic distractors
• Focus on what the learner would do or say
• Example:
• "What's the first step when restocking shelves?"
• a) Count leftover items
• b) Log into POS system ✅
• c) Ask the manager
• d) Remove old labels

4. openEndedQuestion
• Use for collecting feedback
• Title: "Was this lesson easy to understand?"
• Text description:
• ✅ Yes, everything was clear
• 🤔 Mostly clear, but I had questions
• 😐 Some parts were confusing
• ❌ No, I didn't understand it

Quiz lesson
You are creating a Quiz Lesson for the end of a course section.
This lesson should reinforce the key ideas from all previous lessons in the section — but should not introduce new content.
Your task is to generate the quiz in this structure:

1. lessonInfo
 • title: Quiz: [Section Title]
(e.g. "Quiz: Getting Started" or "Quiz: Matcha Basics")
 • description: One-sentence purpose —
"Check your understanding of what you've learned in this section."

 1. quizCards (4–8 cards)
 • Multiple-choice questions that cover all lessons in the section
 • Focus on practical understanding, decision-making, or key rules
 • Each question should include:
 • 1 clear question
 • 4 short answer options (1 correct, 3 realistic distractors)
 • Correct answer marked under correctAnswer
 • All answers must be short (1–80 characters max)

 2. openEndedQuestion
• Use for collecting feedback
• Title: "Was this section easy to understand?"
• Text description:
• ✅ Yes, everything was clear
• 🤔 Mostly clear, but I had questions
• 😐 Some parts were confusing
• ❌ No, I didn't understand it


Conclusion Section — Final Feedback Lesson

You are creating the final Conclusion lesson for a course.
Its only purpose is to thank the learner and collect feedback about the learning experience.
Your structure should include:

1. lessonInfo
title: Final Feedback
description: Thanks for completing the course! We'd love to hear your thoughts.

 3. openEndedQuestions
Card 1
title: On a scale of 0 to 10: How likely are you to recommend this course to a colleague or teammate?
description: 
⬜️ 0 — Not at all
⬜️ 5 — It was okay
⬜️ 7 — Pretty likely
⬜️ 10 — Absolutely

Card 2
title: Which sections did you find most useful or interesting?
description: (Select all that apply) + give the list of all the sections of the course.

Card 3
Was anything unclear or missing in the course?

3. memoryCards
 • title: Thank you!
 • description: Your feedback helps us keep improving — one micro-lesson at a time 
 
 💡## **Instructional Design Prompt: Generate Microlearning Lesson Content (Stage 2\)**

You are a microlearning content designer.  
Your task is to generate the full learning content for each lesson, based on a pre-approved course structure.

⚠️ You must follow the required structure exactly for each of the 4 lesson types:

* Introduction Lesson  
* Core Chapter Lessons  
* Quiz Lessons  
* Final Feedback Lesson
Й
Each of these types has a fixed structure, including the specific types of cards allowed and their strict order.  
➡️ **You must not add, remove, or reorder elements.**  
Detailed format requirements for each type follow below.

---

1. ### Introduction lesson Й

You are an instructional designer creating the **Introduction chapter** of a microlearning course based on the course outline or a provided topic.

Your task is to generate 1 lesson titled:

**"What this course is about"**

This lesson must clearly and engagingly explain:

* ✅ What the course is about  
* ✅ What the learner will gain from it  
* ✅ Who the course is for  
* ✅ What will be covered  
* ✅ How the course is structured

### **Required Structure:**

### **1\. \`lessonInfo\`**

* **title:** "What This Course Is About"  
* **description:** One-sentence learning goal answering:  
  👉 *“What will the learner be able to do after this lesson?”*

### **2\. \`videoScript\` (REQUIRED)**

This is a short 90–120 second video script that introduces the course.  
It should follow a **social media video style**: clear, engaging, modern.

**Structure:**

1. Welcome or attention-grabbing opening (1–2 sentences)  
2. What this course is about and who it’s for  
3. What will be covered (main topics or chapters)  
4. What the learner will gain (skills or outcomes)  
5. Summary \+ “Let’s get started\!”

**Tone:** Friendly, direct, encouraging.  
**Length:** \~200–300 words (≈ 90–120 seconds spoken)

**Example:**

Welcome to the course \[Course Title\]\!  
This course is all about creating better onboarding experiences for your team — whether you're in HR or a team lead.  
We’ll walk you through the full onboarding process: from the first offer letter to that critical 90-day check-in.

You’ll learn how to avoid common mistakes, use digital tools to save time, and make every new hire feel truly supported.

Each chapter is short, actionable, and focused on one key topic.

Ready to transform your onboarding? Let’s get started\!

---

### 2\. Core Chapter Lessons

You are creating **microlearning-style lessons** for a structured course chapter.

Each chapter includes:

* 3–6 **Core Lessons**  
* 1 **Quiz Lesson** at the end of the Chapter

### **Required Structure:**

### **1\. \`lessonInfo\`**

* **title:** A focused, actionable lesson name (1 idea, action, or process)  
* **description:** A one-sentence learning goal that answers:  
  👉 *“What will the learner be able to do after this lesson?”*

### **2\. \`videoScript\` (REQUIRED)**

This is the main instructional content, delivered as a social media–style video.

Length: 90–120 seconds (\~200–300 words)  
Tone: friendly, direct, motivational

Required Structure:

1. Welcome / Hook — greeting or framing  
   *(e.g., “In this lesson, we’ll…” or “Let’s talk about…”)*  
2. Core Concept — define/explain the key idea  
3. Break It Down — list key points, categories, or steps  
   * Use bullets, numbers, and simple examples  
4.  Summary — 1–2 lines repeating the main takeaway  
5. Transition to quiz or scenario  
   *(e.g., “Now let’s test what you’ve learned”)*

Example:

Welcome\!

In this lesson, we’ll go through different types of tourism complaints in Dubai.

So, what is a tourism complaint?  
It’s any issue related to hotels, tourism companies, or hospitality services — like problems with reservations or hotel facilities.

But before we look at the complaints we handle, we need to talk about the ones we don’t.

These are called out of scope complaints.

Let’s look at the 3 main categories:

1️⃣ Booking platforms  
→ *Example:* A guest paid on Expedia, but the booking failed — that’s out of scope.

2️⃣ Police-related complaints  
→ *Example:* Someone lost their wallet — that goes to Dubai Police.

3️⃣ Municipality complaints  
→ *Example:* A tourist reports a dirty restaurant — that’s for the Municipality.

🧠 Summary:  
If it’s about a platform, a lost item, or cleanliness — it’s out of our scope.

In the next lesson, we’ll explore the complaints we *do* handle.  
But first — let’s test your understanding\!

---

### **3\. \`memoryCards\` (REQUIRED)**

Use to reinforce key ideas from the videoScript.

* 5–10 cards max  
* Each card has:  
  * **title:** Short headline  
  * **description:**  2–5 lines of text (bullets, emojis, highlights allowed)  
* Content must match video /videoScript only.

### **4\. \`memoryCards\` (REQUIRED, do not skip it)**

Apply knowledge in real-world-like situations.

* **1 intro card:**  
  * title: “What would you do?”  
  * description: “Check yourself →”  
* **3–4 memoryCards**, each with:  
  * **title:** A natural-sounding situation or question (e.g. a customer asking something, a challenge during work)  
  * **description:** A short model response that starts with  
    ✅Correct answer: followed by 1–3 lines of clear, practical text

📌 All scenarios must be based only on the video content.  
Do not invent situations or facts not covered.

**Content Rules:**

* Scenarios must **only apply knowledge explicitly presented in this same lesson**  
* You may rephrase situations to make them feel real — but do **not introduce any new facts, actions, or explanations** that were not covered in the memoryCards  
* Use natural spoken tone: polite, simple, helpful  
* Avoid overexplaining or sounding robotic

🚫 **Do NOT:**

* invent customer behavior, objections, or technical solutions not mentioned in the lesson  
* write answers that assume external training, extra policies, or company-specific procedures  
* generalize beyond what the learner has already studied in the same lesson

**For example:**  
title: A guest is upset about a delay. What would you do?  
description: ✅Correct answer: Acknowledge their frustration and politely offer a solution or update.

title: Customer asks: “Why is this product more expensive?”  
description: ✅Correct answer: Explain the premium quality and sourcing as described in your product story.

### **5\. \`quizCards\` (2–5 cards)**

Multiple-choice questions to test comprehension.

Each must include:

* 1 correct answer ✅  
* 3 realistic distractors ❌

Focus on actions, decisions, or key ideas from the video.

### **6\. \`openEndedQuestion\` (1 card)**

Used for learner reflection and feedback.

• Title: “Was this lesson easy to understand?”

• Text description:  
✅ Yes, everything was clear  
🤔 Mostly clear, but I had questions  
😐 Some parts were confusing  
❌ No, I didn’t understand it

---

### 3\. Quiz lesson

You are creating a **Quiz Lesson** for the end of a course chapter.  
This lesson should reinforce the key ideas from all previous lessons in the chapter, but **should not introduce new content**.

### **Required Structure**

### **1\. \`lessonInfo\`**

* **title:** \`Quiz: [Chapter Title]\`  
  *Example:* \`Quiz: Matcha Business Basics\`  
* **description:**  
  \`"Check your understanding of what you’ve learned in this chapter."\`

### **2\. \`quizCards\` (4–8 cards)**

Each card is a **multiple-choice question** that checks comprehension across the full chapter.  
Focus on:

* Practical application of concepts  
* Decision-making  
* Key facts, definitions, or steps

**Each quizCard must include:**

* 1 clear question  
* 4 answer options:  
  * ✅ One correct answer (marked with \`correctAnswer\`)  
  * ❌ Three realistic distractors  
* Each answer option must be short (1–80 characters max)

**2\. \`quizCards\` (4–8 cards)**

* Multiple-choice questions that cover all lessons in the chapter   
* Focus on practical understanding, decision-making, or key rules  
* Each question should include:  
  * 1 clear question  
  * 4 short answer options (1 correct, 3 realistic distractors)  
  * Correct answer marked under correctAnswer  
* All answers must be short (1–80 characters max)

❌ **Do NOT include:**

* any memoryCards  
* any openEndedQuestion  
* scenarios or reflection questions  
* references to “this document” or source files  
* Any extra summaries or explanations — **questions only**

This type lesson must contain **only quizCards**\! (REQUIRED, DON’T SKIP THIS CRITERION)

### **Notes**

* Every quiz question must **directly relate to content covered in Core Lessons** of that chapter  
* Avoid trick questions or unrealistic distractors  
* Use varied formats: actions, rules, sequence, consequences

---

### 4\. Conclusion Chapter — Final Feedback Lesson

You are creating the final **Conclusion** lesson for a course.  
Its only purpose is to thank the learner and collect feedback about the learning experience.

### **Required Structure**

### **1\. \`lessonInfo\`**

* **title:** \`Final Feedback\`  
* **description:**  
  \`"Thanks for completing the course! We’d love to hear your thoughts."\`

### **2\. \`openEndedQuestions\` (exactly 3 cards, in this order)**

#### **📍 Card 1: Recommendation Score**

* **title:** \`On a scale of 0 to 10: How likely are you to recommend this course to a colleague or teammate?\`  
* **description:**

\`⬜ 0 — Not at all\`    
\`⬜ 5 — It was okay\`    
\`⬜ 7 — Pretty likely\`    
\`⬜ 10 — Absolutely\`

#### **📍 Card 2: Most Useful Chapters**

* **title:** \`Which chapters did you find most useful or interesting?\`  
* **description:**  
  \`(Select all that apply)\` \+ *\[Insert list of chapter titles\]*

#### **📍 Card 3: Missing or Unclear**

* **title:** \`Was anything unclear or missing in the course?\`

---

### **3\. \`memoryCards\` (exactly 1 card — comes last)**

* **title:** \`Thank you!\`  
* **description:**  
  \`"Your feedback helps us keep improving — one micro-lesson at a time 💡"\`

### **❌ Do NOT include:**

* Any \`quizCards\`  
* Any \`scenarioCards\`  
* Any additional \`memoryCards\`  
* Any summaries or explanations  
* Any new content or progress indicators

---

### **🔐 This lesson must contain only:** ✅ 3 \`openEndedQuestions\` → ✅ 1 \`memoryCards\` → 🛑 nothing else.

            
            Respond with a JSON object following the schema provided in the response_format parameter.`,
          },
          new MessagesPlaceholder("history"),
          {
            role: "user",
            content: `Create detailed lessons and quizzes for the chapter "{chapter_title}" 
            which is part of the subtopic "{subtopic_title}" in the course "{main_topic}".
            
            The lesson titles are: {lesson_titles}
            
            Use the following context if available: {context_str}
            
            Respond with a valid JSON object containing an array of lessons, each with:
            1. lessonInfo (title and description)
            2. videoScript (title and description)
            2. memoryCards (array of cards with title, description and optional situation/response fields)
            3. quizCards (array of multiple choice questions with options and correctAnswer index)
            4. openEndedQuestion (feedback question with title and description)

            Follow the structure exactly as described in the system message.`,
          },
        ]);

        // Extract relevant context for this chapter using vector search
        const chapterContext = await searchVectorStore(
          `${state.mainTopic} ${subtopic.title} ${chapter.title}`,
          3
        ).catch(error => {
          console.error("Error searching vector store:", error);
          return [];
        });
        
        const contextStr = [
          ...(state.context || []),
          ...chapterContext,
        ]
          .map((doc) => doc.pageContent)
          .join("\n\n")
          .substring(0, 10000);

        // Create a sequence for chapter content generation
        const chapterChain = RunnableSequence.from([
          RunnablePassthrough.assign({
            context_str: (state: any) => {
              // Process the context for chapter content generation
              console.log(`Chapter content - context state:`, 
                state && state.context ? 
                  (Array.isArray(state.context) ? `${state.context.length} items` : "not an array") : 
                  "undefined"
              );
              
              // First check if context exists in state passed directly to the function
              if (state && state.context && Array.isArray(state.context) && state.context.length > 0) {
                console.log(`Using ${state.context.length} context items from param for chapter: ${chapter.title}`);
                const contextStr = [
                  ...(state.context),
                  ...chapterContext,
                ]
                  .map((doc: any) => doc.pageContent || '')
                  .join("\n\n")
                  .substring(0, 10000);
                return contextStr;
              }
              
              // If we get here, use the contextStr from surrounding scope
              console.log(`Using context string from scope for chapter: ${chapter.title}`);
              return contextStr;
            },
            history: (state: any) => state && state.history ? state.history : [],
            chapter_title: () => chapter.title,
            subtopic_title: () => subtopic.title,
            main_topic: () => state.mainTopic || '',
            lesson_titles: () => JSON.stringify(chapter.lessons)
          }),
          chapterPrompt,
          model.bind({ 
            response_format: { 
              type: "json_schema",
              json_schema: {
                name: "lesson_content_schema",
                schema: lessonContentJsonSchema
              }
            }
          }),
          async (message) => {
            const content = message.content;
            if (typeof content === "string") {
              try {
                return JSON.parse(content);
              } catch (e) {
                console.error("Error parsing JSON response:", e);
                return { error: "Failed to parse response" };
              }
            }
            return content;
          },
        ]);

        // Run the chain
        console.log(`Generating content for chapter: ${chapter.title}`);
        try {
          // Pass the complete state to preserve all properties
          const chapterData = await chapterChain.invoke({
            ...state,
            context_str: contextStr
          });
          
          console.log(`Chapter data for ${chapter.title}:`, JSON.stringify(chapterData).substring(0, 200) + "...");
          
          // Use Zod to validate and normalize the chapter data
          try {
            // First try parsing with our standard lesson content schema
            const parsed = LessonContentSchema.safeParse(chapterData);
            if (parsed.success) {
              processedChapter = {
                title: chapter.title,
                description: chapter.description,
                lessons: parsed.data.lessons
              };
            } else {
              // If that fails, try with the alternative schema
              console.log("Standard lesson schema validation failed, trying alternative schema");
              const alternativeParsed = AlternativeLessonContentSchema.safeParse(chapterData);
              
              if (alternativeParsed.success) {
                // Extract lessons array with either key
                const lessonArray = alternativeParsed.data.lessons || alternativeParsed.data.Lessons || [];
                
                // Normalize each lesson
                const normalizedLessons = lessonArray.map(lesson => {
                  // Check if lesson already has the new structure format
                  if (lesson.lessonInfo && 
                     (lesson.memoryCards || lesson.quizCards || lesson.openEndedQuestion || lesson.openEndedQuestions)) {
                    return lesson;
                  }
                  
                  // Handle different property naming conventions for older format
                  const title = lesson.title || lesson.Title || lesson.name || lesson.Name || '';
                  const content = lesson.content || lesson.Content || '';
                  
                  // Handle quiz data
                  const quizArray = lesson.quiz || lesson.Quiz || lesson.questions || lesson.Questions || [];
                  const normalizedQuiz = Array.isArray(quizArray) ? quizArray.map(q => {
                    return {
                      question: q.question || q.Question || '',
                      options: Array.isArray(q.options) ? q.options : 
                              Array.isArray(q.Options) ? q.Options : 
                              Array.isArray(q.choices) ? q.choices : [],
                      correctAnswer: typeof q.correctAnswer === 'number' ? q.correctAnswer : 
                                    typeof q.CorrectAnswer === 'number' ? q.CorrectAnswer :
                                    typeof q.correct === 'number' ? q.correct : 0
                    };
                  }) : [];
                  
                  // Convert old format to new format
                  return {
                    lessonInfo: {
                      title: title,
                      description: content.substring(0, 100) + '...' // Create a brief description from content
                    },
                    videoScript: {
                      title: lesson.videoScript.title || '',
                      description: lesson.videoScript.description || ''
                    },
                    memoryCards: [
                      {
                        title: "Content Summary",
                        description: content
                      }
                    ],
                    quizCards: normalizedQuiz.map(q => ({
                      question: q.question,
                      options: q.options,
                      correctAnswer: q.correctAnswer
                    })),
                    openEndedQuestion: {
                      title: "Was this lesson easy to understand?",
                      description: "✅ Yes, everything was clear\n🤔 Mostly clear, but I had questions\n😐 Some parts were confusing\n❌ No, I didn't understand it"
                    }
                  };
                });
                
                processedChapter = {
                  title: chapter.title,
                  description: chapter.description,
                  lessons: normalizedLessons
                };
              } else {
                console.error("Alternative lesson schema validation failed");
                throw new Error("Lesson content validation failed");
              }
            }
          } catch (error) {
            console.error("Error normalizing chapter data:", error);
            // Create a default structure to avoid breaking the flow
            processedChapter = {
              title: chapter.title,
              description: chapter.description,
              lessons: [{
                lessonInfo: {
                  title: "Error generating content",
                  description: "There was an error generating the lesson content."
                },
                memoryCards: [
                  {
                    title: "Error",
                    description: "The API response format may have changed or the content generation failed."
                  }
                ],
                quizCards: []
              }]
            };
          }
        } catch (error: any) {
          console.error(`Error in chapter chain for ${chapter.title}:`, error);
          
          // Create a default structure with error information
          processedChapter = {
            title: chapter.title,
            description: chapter.description,
            lessons: [{
              lessonInfo: {
                title: "Error in content generation",
                description: `Error: ${error.message || "Unknown error"}`
              },
              memoryCards: [
                {
                  title: "Technical Details",
                  description: error.stack ? error.stack.substring(0, 500) : "No additional details available"
                }
              ],
              quizCards: []
            }]
          };
        }

        // Store in memory
        await memory.saveContext(
          { input: memoryKey },
          { output: JSON.stringify(processedChapter) }
        );

        // Note: We don't update the global state history here as we're running in parallel
      }

      processedSubtopic.chapters.push(processedChapter);
    }
    
    // Logging after processing each subtopic
    console.log(`Completed processing subtopic: ${subtopic.title}`);
    return processedSubtopic;
  });

  // Wait for all subtopics to be processed in parallel
  const processedSubtopics = await Promise.all(subtopicPromises);
  
  // Add the processed subtopics to the full content
  fullContent.subTopics = processedSubtopics;

  // Return updated state
  console.log("Content generation complete. Generated content:", JSON.stringify({
    mainTopic: fullContent.mainTopic,
    description: fullContent.description,
    subTopicsCount: fullContent.subTopics.length,
    totalChapters: fullContent.subTopics.reduce((acc: number, st: any) => acc + st.chapters.length, 0)
  }));
  
  return {
    ...state,
    generatedContent: fullContent,
    // We need to update the history once at the end
    history: [
      ...(state.history || []),
      new HumanMessage(`Generated content for ${processedSubtopics.length} subtopics`),
      new AIMessage(JSON.stringify({ 
        status: "success", 
        subtopicsCount: processedSubtopics.length 
      })),
    ],
  };
} 