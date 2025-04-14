import { StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { SupabaseVectorStoreMemory } from "./supabase-memory";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";

import { addDocumentsToVectorStore, searchVectorStore, textToDocuments } from "./vector-store";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { RunnablePassthrough } from "@langchain/core/runnables";

import { 
  TocSchema,
  AlternativeTocSchema,
  LessonContentSchema,
  AlternativeLessonContentSchema
} from "./schemas/education-graph";

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
      description: "3-5 major subtopics that cover different aspects of the main topic",
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
                  description: "3-5 lesson titles per chapter",
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

// Sample TOC JSON structure for reference
const tocJsonExample = {
  "mainTopic": "Introduction to JavaScript",
  "description": "A comprehensive course covering JavaScript basics to advanced concepts",
  "subTopics": [
    {
      "title": "JavaScript Fundamentals",
      "description": "Core concepts and syntax of JavaScript",
      "chapters": [
        {
          "title": "Variables and Data Types",
          "description": "Understanding variables, primitives, and complex data types",
          "lessons": [
            "Declaring Variables with let, const, and var",
            "Working with Numbers and Strings",
            "Boolean, null, and undefined",
            "Objects and Arrays Basics"
          ]
        }
      ]
    }
  ]
};

// State interface - исправим на более гибкий тип
interface EducationState {
  topic: string;
  context: any[]; // Document[] с гибким типом
  mainTopic?: string;
  description?: string;
  toc?: any;
  currentSubtopic?: any;
  currentChapter?: any;
  generatedContent?: any;
  memory: Record<string, any>;
  history: any[]; // (HumanMessage | AIMessage)[] с гибким типом
  [key: string]: any; // Дополнительные поля
}

// Initialize OpenAI chat model
const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.7,
});

// Initialize SupabaseVectorStoreMemory
const memory = new SupabaseVectorStoreMemory();

// Define the education graph
export async function createEducationGraph() {
  // Create the graph with proper type definitions
  const builder = new StateGraph<EducationState>({
    channels: {
      topic: {
        value: (state: EducationState) => state.topic,
      },
      context: {
        value: (state: EducationState) => state.context,
      },
      memory: {
        value: (state: EducationState) => state.memory,
      },
      history: {
        value: (state: EducationState) => state.history,
      },
    }
  });

  // Add a node to retrieve context from vector store
  builder.addNode("retrieveContext", async (state: EducationState) => {
    try {
      console.log("Starting retrieveContext with state keys:", Object.keys(state));
      console.log("Context present:", state.context ? state.context.length > 0 : false);
      
      // If context is already provided (e.g. from document upload), use it directly
      if (state.context && state.context.length > 0) {
        console.log("Using provided document context for generation");
        return state;
      }

      // Otherwise search for relevant documents based on topic
      console.log("Searching for relevant documents for topic:", state.topic);
      const documents = await searchVectorStore(state.topic, 5)
        .catch(error => {
          console.error("Error searching vector store:", error);
          return [];
        });
      return { ...state, context: documents };
    } catch (error) {
      console.error("Error retrieving context:", error);
      // Return state with empty context to avoid breaking the chain
      return { ...state, context: [] };
    }
  });

  // Add a node to generate TOC
  builder.addNode(
    "generateTOC",
    async (state: EducationState) => {
      console.log("State:", state);
      console.log("Starting TOC generation with state keys:", Object.keys(state));
      
      // Create a context-aware prompt for TOC generation
      const tocPrompt = ChatPromptTemplate.fromMessages([
        {
          role: "system",
          content: `You are an expert educator tasked with creating a comprehensive and hierarchical educational course structure. 
          Given the topic or document, create a well-structured hierarchical table of contents with:
          1. Main topic with description
          2. 3-5 major subtopics with descriptions
          3. 2-4 chapters per subtopic with descriptions
          4. 3-5 lesson titles per chapter

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
            .substring(0, 10000)
        : "";
      
      console.log("Context length for TOC generation:", contextStr.length);
      console.log("Context sample (first 200 chars):", contextStr.substring(0, 200));

      // Create a sequence for TOC generation with context
      const tocChain = RunnableSequence.from([
        RunnablePassthrough.assign({
          // Explicitly preserve all state properties
          topic: (state: any) => state.topic,
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
      const tocData = await tocChain.invoke(state);

      console.log("TOC generation result:", JSON.stringify(tocData).substring(0, 200) + "...");
      
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
  );


  // Add a node to generate content for each chapter
  builder.addNode(
    "generateChapterContent",
    async (state: EducationState) => {
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
  });

  // Define edges with error handling
  try {
    // Try the standard approach first
    builder.addEdge("__start__", "retrieveContext");
    builder.addEdge("retrieveContext", "generateTOC");
    builder.addEdge("generateTOC", "generateChapterContent");
    builder.addEdge("generateChapterContent", "__end__");
  } catch (error) {
    console.warn("Standard edge configuration failed, trying alternative approach:", error);
    
    try {
      // Alternative approach for newer versions
      builder.setEntryPoint("retrieveContext");
      builder.addEdge("retrieveContext", "generateTOC");
      builder.addEdge("generateTOC", "generateChapterContent");
      builder.setFinishPoint("generateChapterContent");
    } catch (error) {
      console.error("Both edge configuration approaches failed:", error);
      console.warn("Graph will be compiled without edges. Manual sequencing may be required.");
    }
  }
  
  // Compile the graph with error handling
  try {
    return builder.compile();
  } catch (error) {
    console.error("Error compiling graph:", error);
    
    // In case of compilation error, return a fallback approach
    // That returns a simple runnable that can process the steps manually
    return {
      invoke: async (input: EducationState | Record<string, any> | undefined) => {
        console.log("Using fallback sequential processing due to graph compilation error");
        
        // Get state from input or create a minimal viable state
        const state = input || {
          topic: "",
          context: [],
          memory: {},
          history: []
        };
        
        // Manually execute each step in sequence with safer node access
        try {
          // Capture the individual node functions from the builder
          // Use a workaround to access nodes from the builder
          const retrieveContextFn = (builder as any).nodeMap?.get("retrieveContext") || 
                                    (builder as any)._nodes?.get("retrieveContext");
          const generateTOCFn = (builder as any).nodeMap?.get("generateTOC") || 
                               (builder as any)._nodes?.get("generateTOC");
          const generateChapterContentFn = (builder as any).nodeMap?.get("generateChapterContent") || 
                                          (builder as any)._nodes?.get("generateChapterContent");
          
          if (!retrieveContextFn || !generateTOCFn || !generateChapterContentFn) {
            throw new Error("Required node functions are not available");
          }
          
          // Execute steps in sequence, ensuring state is preserved between each step
          console.log("Starting sequential execution with input state keys:", Object.keys(state));
          
          // Step 1: Retrieve context
          const contextState = await retrieveContextFn.invoke(state);
          console.log("After retrieveContext, state keys:", Object.keys(contextState));
          
          // Step 2: Generate TOC - make sure to pass all state from previous step
          const tocState = await generateTOCFn.invoke(contextState);
          console.log("After generateTOC, state keys:", Object.keys(tocState));
          console.log("TOC present in state:", !!tocState.toc);
          
          // Step 3: Generate chapter content - make sure to pass all state from previous step
          // Critical fix: ensure all TOC data is passed to chapter generation
          if (!tocState.toc) {
            console.error("TOC data is missing after TOC generation step");
            return {
              ...tocState,
              error: "TOC data was not generated properly"
            };
          }
          
          const contentState = await generateChapterContentFn.invoke(tocState);
          console.log("After generateChapterContent, state keys:", Object.keys(contentState));
          console.log("Generated content present:", !!contentState.generatedContent);
          
          return contentState;
        } catch (error) {
          console.error("Error in fallback processing:", error);
          return {
            ...state,
            error: "Failed to process content in fallback mode: " + String(error)
          };
        }
      }
    };
  }
}

// Function to store document in vector store
export async function storeDocumentInVectorStore(
  text: string,
  metadata: Record<string, any>
) {
  const documents = textToDocuments(text, metadata);
  return await addDocumentsToVectorStore(documents, metadata);
} 