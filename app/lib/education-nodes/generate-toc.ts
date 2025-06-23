import { ChatOpenAI } from "@langchain/openai";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnablePassthrough } from "@langchain/core/runnables";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { SupabaseVectorStoreMemory } from "../supabase-memory";
import { EducationState } from "../types/education";
import { TocSchema, AlternativeTocSchema } from "../schemas/education-graph";

// Initialize OpenAI chat model
const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.4,
});

// Initialize SupabaseVectorStoreMemory
const memory = new SupabaseVectorStoreMemory();

// Define JSON schema structure for TOC
const tocJsonSchema = {
  type: "object",
  properties: {
    mainTopic: {
      type: "string",
      description: "The main topic or title of the educational course"
    },
    description: {
      type: "string",
      description: "Comprehensive description of the main topic"
    },
    subTopics: {
      type: "array",
      description: "major chapters that cover different aspects of the main topic",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title of the subtopic"
          },
          description: {
            type: "string",
            description: "Description of what this subtopic covers"
          },
          chapters: {
            type: "array",
            description: "2-4 chapters per subtopic",
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "Title of the chapter"
                },
                description: {
                  type: "string",
                  description: "Description of what this chapter covers"
                },
                lessons: {
                  type: "array",
                  description: "lesson titles per chapter",
                  items: {
                    type: "string",
                    description: "Title of the lesson"
                  }
                }
              },
              required: ["title", "description", "lessons"]
            }
          }
        },
        required: ["title", "description", "chapters"]
      }
    }
  },
  required: ["mainTopic", "description", "subTopics"]
};

/**
 * Node function to generate a table of contents (TOC) for educational content
 */
export async function generateTOC(state: EducationState): Promise<EducationState> {
  console.log("State:", state);
  console.log("Starting TOC generation with state keys:", Object.keys(state));
  
  // Create a context-aware prompt for TOC generation
  const tocPrompt = ChatPromptTemplate.fromMessages([
    {
      role: "system",
      content: `## **Instructional Design Prompt: Generate Microlearning Course Structure (Stage 1\)**

      you are creating training courses for the Jewish community of Chabad, according to which educational microlearning courses will be created, with the analysis of spiritual texts, thoughts of rabbis and teach millions of Jews spirituality and the meanings of the Torah.

keep the context the same as the sages write, discussing the Talmud, Torah, and other sacred books of the Jewish people

your task: to teach Jews interested in the Torah complex things in simple words, so that they find it interesting and understandable for perception

You are an Instructional Designer and Curriculum Architect.  
Your task is to analyze the provided document (PDF extraction or raw text) and generate a clear, pedagogically sound **microlearning course structure**.

### **⚠️ This is Stage 1: Course Structure Only**

Do **not** generate video scripts, quiz questions, or feedback forms yet.  
Your task is to define the **logical structure of the course**, based strictly on the source content.

You must produce:

* Intro lesson  
* Core chapters (with lessons and quiz lessons)  
* Conclusion chapter with a feedback lesson

---

Apply These Instructional Design Principles:

* **Backward Design** — start from outcomes  
* **Scaffolding** — move from simple to complex  
* **Chunking** — break into short, outcome-oriented lessons

---

### **Your Output Must Follow This Structure:**

### 1\. Course Title \+ Overview

**Title**: A clear, learner-facing course name

**Overview**: A short, motivational, learner-friendly paragraph that explains:

* What this course is about  
* What the learner will gain  
* How it is structured

 Use modern, practical, easy-to-understand language.

---

### 2\. Introduction Сhapter (REQUIRED)

**Chapter title**: *Introduction*

*Include one lesson:*

* ***Lesson title**: What this course is about*

**Lesson Description:** One-sentence learning goal that answers “What will the learner be able to do?”

If the source document includes introductory context, motivation, or a note on importance — integrate it into the learner-facing framing.

❗ This chapter is **mandatory** and must be included in **every course structure**.

---

### 3\. Core Chapters

Each chapter must include:

* **Chapter Title** (based on a meaningful theme or concept from the document)  
* **2 to 6 instructionally relevant lessons** (depending on actual content)  
* **One Quiz Lesson** per chapter:   
  **Lesson title**: Quiz: \[Chapter Title\]


For each lesson:

* **Lesson Title**: Short, clear, actionable  
* **Lesson description**: One-sentence learning goal that answers “What will the learner be able to do?”  
* Each lesson should be focused on **one realistic learning point** (based strictly on the source)

❌ Do NOT invent lessons just to match structure  
✅ Only include lessons when the learner can realistically understand or apply the concept based on the given content

---

### 4\. Conclusion 

* Chapter titled: **Conclusion**  
* Include **only** this lesson title: → *Final Feedback*  
  (No descriptions.)

This lesson is used to gather learner reflections after completing the course.  
(You do not need to create any questions, they will be added at Stage 2\)

---

## **Using Existing Structure (When Applicable)**

If the source document includes a clear structure (e.g., numbered ideas, titled sections, steps, labeled frameworks), you may use it as a base — only if:

✅ Each section reflects a distinct, meaningful concept or process  
✅ The content under each section is deep enough to support one or more lessons  
✅ The flow of content supports learning logic (e.g., general → specific, basic → advanced)

📌 You may:

* Use short sections as individual lessons  
* Use large sections as chapters with multiple lessons  
* Combine repetitive parts into one lesson  
* Split long or dense sections into multiple focused lessons

❌ Do not convert every heading or paragraph mechanically

---

### Style Guide

* Use clear, practical, learner-focused language  
* Avoid academic or overly technical tone  
* Do NOT include imagined use cases — focus only on what is actually in the document  
* Lesson titles must be **short and actionable**

---

### 🔍 Lesson Design Criteria (Stage 1\)

Each lesson must:

* Be based only on the content provided  
* Represent one realistic learning point that can be explained in a future **1–2 minute video**  
* Include enough substance (examples, steps, reasoning, structure) to support a short standalone video lesson  
* Contain approximately **250–350 words** worth of content from the source document  
* Combine related points from different parts of the document only if they support the same learning objective  
* Be meaningful and self-contained — not just a sentence, a fact, or a suggestion

⚠️ If the available content is too short to support a full micro-lesson — **do not create a lesson**. Combine related points instead.

❌ Do NOT:

* Create a separate lesson for every sentence, bullet, or subheading  
* Include lessons with minimal input (e.g., one-sentence advice or single data point)  
* Invent content or assume learner ability beyond what the document supports  
* **Create a lesson if the available source content would result in a video shorter than 60–90 seconds** (e.g., just 1–2 sentences, without depth, examples, or structure)

👉 Think of each lesson as a **90–120 second explainer video**: focused, actionable, and supported by \~2–3 related facts, steps, or examples.

---

### ❌ Strict No-Gos

* Language: The lesson must be in English language. Do **not** translate or switch languages  
* ❌ Absolutely do NOT include any citations, references, metadata, or file markers  
* ❌ Do NOT reference the document, file, or user input in any way  
* ❌ Never include auto-generated references like 🧾cite🧾, turn0file0, oaicite, source, file, etc.  
* ✅ You must remove all in-text reference markers or any hidden metadata that resemble citations  
* Always check that no phrase includes code-like patterns (e.g., file0, cite1, oaicite)  
* Use only the information provided — ❌ No extra details, assumptions, or external knowledge  
* If content is in Hebrew: validate that all letters are correct and not replaced by similar-looking characters. Ensure grammatical accuracy before extracting key concepts.


      Your output should be a complete and logical hierarchy that thoroughly covers the subject matter.
      ${state.context && state.context.length > 0 ? 
        "Carefully analyze the provided document content to create a relevant course structure based on its actual content." : 
        "Create a comprehensive course structure for the provided topic based on your knowledge."}
      
      Respond with a JSON object following the schema provided in the response_format parameter.`,
    },
    new MessagesPlaceholder("history"),
    {
      role: "user",
      content: `Create a detailed hierarchical table of contents for an educational course on: {topic}.
      
      ${state.context && state.context.length > 0 ? 
        "The following document content should be used as the primary source for the course structure:" : 
        "Use the following context if available:"}
      
      {context_str}
      
      Return your response as a valid JSON object.`,
    },
  ]);

  // Extract context
  const contextStr = state.context && state.context.length > 0
    ? state.context
        .map((doc: { pageContent: string }) => doc.pageContent)
        .join("\n\n")
    : "";
  
  console.log("Context length for TOC generation:", contextStr.length);
  console.log("Context sample (first 200 chars):", contextStr.substring(0, 200));

  // Create a sequence for TOC generation with context
  const tocChain = RunnableSequence.from([
    RunnablePassthrough.assign({
      // Explicitly preserve all state properties
      topic: (state: any) => state.topic || "",
      context: (state: any) => state.context || [],
      memory: (state: any) => state.memory || {},
      history: (state: any) => state.history ? state.history : [],
      mainTopic: (state: any) => state.mainTopic,
      description: (state: any) => state.description,
      toc: (state: any) => state.toc,
      currentSubtopic: (state: any) => state.currentSubtopic,
      currentChapter: (state: any) => state.currentChapter,
      generatedContent: (state: any) => state.generatedContent,
      // Add context_str for the prompt
      context_str: (state: any) => {
        console.log("Inside tocChain - context state:", 
          state && state.context ? 
            (Array.isArray(state.context) ? state.context.length : "not an array") : 
            "undefined"
        );
        
        // First check if context exists in state passed directly to the function
        if (state && state.context && Array.isArray(state.context) && state.context.length > 0) {
          const contextStr = state.context
            .map((doc: { pageContent: string }) => doc.pageContent || "")
            .join("\n\n")
            .substring(0, 10000);
          console.log("Prepared context from state param (first 200 chars):", contextStr.substring(0, 200));
          return contextStr;
        }
        
        // Fallback to the surrounding scope's state as a backup
        if (Array.isArray(state?.context) && state.context.length > 0) {
          const contextStr = state.context
            .map((doc: { pageContent: string }) => doc.pageContent || "")
            .join("\n\n")
            .substring(0, 10000);
          console.log("Prepared context from surrounding state (first 200 chars):", contextStr.substring(0, 200));
          return contextStr;
        }
        
        console.log("No context found in either parameter or surrounding state");
        return "";
      },
    }),
    tocPrompt,
    model.bind({ 
      response_format: { 
        type: "json_schema",
        json_schema: {
          name: "toc_schema",
          schema: tocJsonSchema
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
  console.log("Before invoking tocChain - state context:", 
    state.context ? `${state.context.length} items` : "undefined");
  
  let tocData;
  try {
    tocData = await tocChain.invoke(state);
    console.log("TOC generation result:", JSON.stringify(tocData).substring(0, 200) + "...");
  } catch (error: any) {
    console.error("Error in TOC generation:", error);
    return {
      ...state,
      error: `Failed to generate TOC: ${error.message}`,
    };
  }
  
  // Use Zod to validate and normalize the TOC data
  let normalizedTocData;
  
  try {
    // First try parsing with our standard schema
    const parsed = TocSchema.safeParse(tocData);
    if (parsed.success) {
      normalizedTocData = parsed.data;
      console.log("Successfully parsed TOC data with standard schema");
    } else {
      // If that fails, try parsing with the alternative schema
      console.log("Standard schema validation failed, trying alternative schema");
      const alternativeParsed = AlternativeTocSchema.safeParse(tocData);
      
      if (alternativeParsed.success) {
        // Convert from alternative format to our standard format
        const data = alternativeParsed.data;
        
        // Determine the main topic
        let mainTopic = data.mainTopic;
        let description = data.description || data.Description;
        let subTopics: Array<{
          title: string;
          description: string;
          chapters: Array<{
            title: string;
            description: string;
            lessons: string[];
          }>;
        }> = [];
        
        // Handle "MainTopic" object format
        if (data.MainTopic) {
          mainTopic = data.MainTopic.Title;
          description = data.MainTopic.Description;
          
          if (Array.isArray(data.MainTopic.Subtopics)) {
            subTopics = data.MainTopic.Subtopics.map(st => ({
              title: st.Title,
              description: st.Description,
              chapters: Array.isArray(st.Chapters) ? st.Chapters.map(ch => ({
                title: ch.Title,
                description: ch.Description,
                lessons: Array.isArray(ch.Lessons) ? ch.Lessons : []
              })) : []
            }));
          }
        }
        // Handle "Main Topic" object format
        else if (data["Main Topic"]) {
          mainTopic = data["Main Topic"].Title;
          description = data["Main Topic"].Description;
          
          if (Array.isArray(data["Main Topic"].Subtopics)) {
            subTopics = data["Main Topic"].Subtopics.map(st => ({
              title: st.Title,
              description: st.Description,
              chapters: Array.isArray(st.Chapters) ? st.Chapters.map(ch => ({
                title: ch.Title,
                description: ch.Description,
                lessons: Array.isArray(ch.Lessons) ? ch.Lessons : []
              })) : []
            }));
          }
        }
        // Handle "Course Title" format
        else if (data["Course Title"] || data["course title"] || data.courseTitle) {
          mainTopic = data["Course Title"] || data["course title"] || data.courseTitle;
          description = data["Course Description"] || data["course description"] || data.courseDescription || 
                      `Educational content about ${state.topic}`;
          
          // Look for subtopics with various names
          const subtopicsArray = data.subtopics || data.Subtopics || data.topics || data.Topics || 
                              data["Sub-Topics"] || data["sub-topics"] || [];
          
          if (Array.isArray(subtopicsArray) && subtopicsArray.length > 0) {
            subTopics = subtopicsArray.map(st => {
              // Find title and description with various naming conventions
              const title = st.title || st.Title || st.name || st.Name || '';
              const description = st.description || st.Description || st.desc || st.summary || '';
              
              // Find chapters with various naming conventions
              const chaptersArray = st.chapters || st.Chapters || st.sections || st.Sections || [];
              const chapters = Array.isArray(chaptersArray) ? chaptersArray.map(ch => {
                const chTitle = ch.title || ch.Title || ch.name || ch.Name || '';
                const chDesc = ch.description || ch.Description || ch.desc || ch.summary || '';
                const lessons = ch.lessons || ch.Lessons || [];
                
                return {
                  title: chTitle,
                  description: chDesc,
                  lessons: Array.isArray(lessons) ? lessons : []
                };
              }) : [];
              
              return {
                title,
                description,
                chapters
              };
            });
          }
        }
        // Handle standard format but with capitalized keys
        else if (data.subTopics) {
          // Need to convert the potentially mixed lesson arrays to string arrays
          subTopics = data.subTopics.map(st => ({
            title: st.title,
            description: st.description,
            chapters: st.chapters.map(ch => ({
              title: ch.title,
              description: ch.description,
              lessons: ch.lessons.map(lesson => 
                typeof lesson === 'string' ? lesson : lesson.title
              )
            }))
          }));
        }
        
        // Create the normalized structure
        normalizedTocData = {
          mainTopic: mainTopic || state.topic,
          description: description || `Educational content about ${state.topic}`,
          subTopics: subTopics
        };
        
        // Validate the transformed data again with our standard schema
        const validatedFinal = TocSchema.safeParse(normalizedTocData);
        if (!validatedFinal.success) {
          console.error("Failed to convert alternative format to standard format:", validatedFinal.error);
          throw new Error("TOC data validation failed after transformation");
        }
      } else {
        console.error("Alternative schema validation failed:", alternativeParsed.error);
        throw new Error("TOC data validation failed");
      }
    }
  } catch (error) {
    console.error("Error normalizing TOC data:", error);
    // Create a minimal valid structure to continue
    normalizedTocData = {
      mainTopic: state.topic,
      description: `Educational content about ${state.topic}`,
      subTopics: [{
        title: "Introduction",
        description: `Introduction to ${state.topic}`,
        chapters: [{
          title: "What This Course Is About",
          description: `Overview of ${state.topic}`,
          lessons: ["What This Course Is About"]
        }]
      },
      {
        title: `Understanding ${state.topic}`,
        description: `Learn about ${state.topic}`,
        chapters: [{
          title: "Introduction",
          description: `Basic introduction to ${state.topic}`,
          lessons: ["What is it?", "Why is it important?", "Key concepts"]
        }]
      }]
    };
  }
  
  console.log("Normalized TOC data:", JSON.stringify({
    mainTopic: normalizedTocData.mainTopic,
    description: normalizedTocData.description,
    subTopicsCount: normalizedTocData.subTopics.length
  }));
  
  // Check if normalized TOC data has the expected structure
  if (!normalizedTocData.mainTopic || !normalizedTocData.subTopics || !Array.isArray(normalizedTocData.subTopics)) {
    console.error("Invalid normalized TOC data structure:", normalizedTocData);
    return { 
      ...state,
      error: "Invalid TOC data structure. API response format may have changed."
    };
  }

  // Store in memory
  await memory.saveContext(
    { input: `TOC for ${state.topic}` },
    { output: JSON.stringify(normalizedTocData) }
  );

  // Update state
  const updatedState = {
    ...state,
    mainTopic: normalizedTocData.mainTopic,
    description: normalizedTocData.description,
    toc: normalizedTocData,
    history: [
      ...(state.history || []),
      new HumanMessage(`Generate TOC for ${state.topic}`),
      new AIMessage(JSON.stringify(normalizedTocData)),
    ],
  };
  
  console.log("Finished TOC generation. State now has keys:", Object.keys(updatedState));
  console.log("TOC data is present:", !!updatedState.toc);
  
  return updatedState;
} 