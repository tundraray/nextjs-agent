import { ChatOpenAI } from "@langchain/openai";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnablePassthrough } from "@langchain/core/runnables";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { SupabaseVectorStoreMemory } from "../supabase-memory";
import { EducationState } from "../types/education";
import { LessonContentSchema, AlternativeLessonContentSchema, TocSchema } from "../schemas/education-graph";
import { searchVectorStore } from "../vector-store";

// Initialize OpenAI chat model
const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.7,
});

// Initialize memory
const memory = new SupabaseVectorStoreMemory();

// Define JSON schema structure for lesson content
const lessonContentJsonSchema = {
  type: "object",
  properties: {
    lessons: {
      type: "array",
      description: "Array of lesson objects with content and quiz questions",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title of the lesson"
          },
          content: {
            type: "string",
            description: "Comprehensive lesson content (300-500 words)"
          },
          quiz: {
            type: "array",
            description: "2-3 multiple choice questions about the lesson content",
            items: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description: "Quiz question text"
                },
                options: {
                  type: "array",
                  description: "Array of 4 possible answer options",
                  items: {
                    type: "string"
                  }
                },
                correctAnswer: {
                  type: "integer",
                  description: "Index of the correct answer (0-3)"
                }
              },
              required: ["question", "options", "correctAnswer"]
            }
          }
        },
        required: ["title", "content", "quiz"]
      }
    }
  },
  required: ["lessons"]
};

/**
 * Node function to generate content for each chapter
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

  // Process each subtopic
  for (const subtopic of state.toc.subTopics) {
    console.log(`Processing subtopic: ${subtopic.title} with ${subtopic.chapters.length} chapters`);
    const processedSubtopic = {
      title: subtopic.title,
      description: subtopic.description,
      chapters: [],
    };

    // Process each chapter in the subtopic
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
            content: `You are an expert educator creating detailed educational content.
            For each lesson title, create comprehensive lesson content and a quiz with 2-3 multiple-choice questions.
            Make the content engaging, educational, and thorough. Each lesson should be 300-500 words.
            Each quiz question should have 4 options with one correct answer (indicated by the index 0-3).
            
            Respond with a JSON object following the schema provided in the response_format parameter.`,
          },
          new MessagesPlaceholder("history"),
          {
            role: "user",
            content: `Create detailed lessons and quizzes for the chapter "${chapter.title}" 
            which is part of the subtopic "${subtopic.title}" in the course "${state.mainTopic}".
            
            The lesson titles are: ${JSON.stringify(chapter.lessons)}
            
            Use the following context if available: {context_str}
            
            Respond with a valid JSON object containing an array of lessons, each with a title, content, and quiz array.`,
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
            history: (state: any) => state && state.history ? state.history : []
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
                // Handle different property naming conventions
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
                
                return {
                  title,
                  content,
                  quiz: normalizedQuiz
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
              title: "Error generating content",
              content: "There was an error generating the lesson content. The API response format may have changed.",
              quiz: []
            }]
          };
        }

        // Store in memory
        await memory.saveContext(
          { input: memoryKey },
          { output: JSON.stringify(processedChapter) }
        );

        // Update history
        state = {
          ...state,
          history: [
            ...(state.history || []),
            new HumanMessage(`Generate content for chapter ${chapter.title}`),
            new AIMessage(JSON.stringify({ title: chapter.title })),
          ],
        };
      }

      processedSubtopic.chapters.push(processedChapter);
    }

    fullContent.subTopics.push(processedSubtopic);
    
    // Logging after processing each subtopic
    console.log(`Completed processing subtopic: ${subtopic.title}`);
  }

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
  };
} 