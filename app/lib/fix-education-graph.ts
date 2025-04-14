import { StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { SupabaseVectorStoreMemory } from "./supabase-memory";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { Document } from "@langchain/core/documents";
import { addDocumentsToVectorStore, searchVectorStore, textToDocuments } from "./vector-store";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { RunnablePassthrough } from "@langchain/core/runnables";
import { z } from "zod";

// Define Zod schemas for validation
const LessonSchema = z.object({
  title: z.string(),
  content: z.string().optional(),
  quiz: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      correctAnswer: z.number().int().min(0).max(3)
    })
  ).optional().default([])
});

const ChapterSchema = z.object({
  title: z.string(),
  description: z.string(),
  lessons: z.array(z.union([z.string(), LessonSchema]))
});

const SubTopicSchema = z.object({
  title: z.string(),
  description: z.string(),
  chapters: z.array(ChapterSchema)
});

const TocSchema = z.object({
  mainTopic: z.string(),
  description: z.string(),
  subTopics: z.array(SubTopicSchema)
});

// Alternative schema for various formats that might be returned by the API
const AlternativeTocSchema = z.object({
  mainTopic: z.string().optional(),
  MainTopic: z.object({
    Title: z.string(),
    Description: z.string(),
    Subtopics: z.array(z.object({
      Title: z.string(),
      Description: z.string(),
      Chapters: z.array(z.object({
        Title: z.string(),
        Description: z.string(),
        Lessons: z.array(z.string())
      }))
    }))
  }).optional(),
  "Main Topic": z.object({
    Title: z.string(),
    Description: z.string(),
    Subtopics: z.array(z.object({
      Title: z.string(),
      Description: z.string(),
      Chapters: z.array(z.object({
        Title: z.string(),
        Description: z.string(),
        Lessons: z.array(z.string())
      }))
    }))
  }).optional(),
  "Course Title": z.string().optional(),
  "course title": z.string().optional(),
  courseTitle: z.string().optional(),
  "Course Description": z.string().optional(),
  "course description": z.string().optional(),
  courseDescription: z.string().optional(),
  description: z.string().optional(),
  Description: z.string().optional(),
  subTopics: z.array(SubTopicSchema).optional(),
  Subtopics: z.array(z.any()).optional(),
  subtopics: z.array(z.any()).optional(),
  topics: z.array(z.any()).optional(),
  Topics: z.array(z.any()).optional(),
  "Sub-Topics": z.array(z.any()).optional(),
  "sub-topics": z.array(z.any()).optional()
});

// Lesson content response schema
const LessonContentSchema = z.object({
  lessons: z.array(
    z.object({
      title: z.string(),
      content: z.string(),
      quiz: z.array(
        z.object({
          question: z.string(),
          options: z.array(z.string()),
          correctAnswer: z.number().int().min(0).max(3)
        })
      )
    })
  )
});

// Alternative lesson content schema
const AlternativeLessonContentSchema = z.object({
  lessons: z.array(z.any()).optional(),
  Lessons: z.array(z.any()).optional()
}).catchall(z.any());

// Initialize OpenAI chat model
const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.7,
});

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

// Initialize SupabaseVectorStoreMemory
const memory = new SupabaseVectorStoreMemory();

// Define the education graph
export async function createEducationGraph() {
  // Create the graph
  const builder = new StateGraph<EducationState>({
    channels: {
      topic: {
        value: (state) => state.topic,
      },
      context: {
        value: (state) => state.context,
      },
      memory: {
        value: (state) => state.memory,
      },
      history: {
        value: (state) => state.history,
      },
    }
  });

  // Add a node to retrieve context from vector store
  builder.addNode("retrieveContext", async (state) => {
    try {
      if (!state.context || state.context.length === 0) {
        // Search for relevant documents based on topic
        console.log("Searching for relevant documents for topic:", state.topic);
        const documents = await searchVectorStore(state.topic, 5)
          .catch(error => {
            console.error("Error searching vector store:", error);
            return [];
          });
        return { ...state, context: documents };
      }
      return state;
    } catch (error) {
      console.error("Error retrieving context:", error);
      // Return state with empty context to avoid breaking the chain
      return { ...state, context: [] };
    }
  });

  // Add a node to generate TOC
  builder.addNode(
    "generateTOC",
    async (state) => {
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
          
          You MUST use the following JSON format for your response:
          
          {
            "mainTopic": "The main topic title",
            "description": "A comprehensive description of the topic",
            "subTopics": [
              {
                "title": "Subtopic title",
                "description": "Subtopic description",
                "chapters": [
                  {
                    "title": "Chapter title",
                    "description": "Chapter description",
                    "lessons": ["Lesson 1 title", "Lesson 2 title", "Lesson 3 title"]
                  }
                ]
              }
            ]
          }
          
          DO NOT deviate from this schema. Use exactly these field names: "mainTopic", "description", "subTopics", "title", "chapters", and "lessons".
          Ensure all required fields are included with descriptive values. Never use alternative field names.`,
        },
        new MessagesPlaceholder("history"),
        {
          role: "user",
          content: `Create a detailed hierarchical table of contents for an educational course on: {topic}.
          
          Use the following context if available: {context_str}
          
          Return your response as a valid JSON object.`,
        },
      ]);

      // Extract context
      const contextStr = state.context && state.context.length > 0
        ? state.context
            .map((doc) => doc.pageContent)
            .join("\n\n")
            .substring(0, 10000)
        : "";

      // Create a sequence for TOC generation with context
      const tocChain = RunnableSequence.from([
        RunnablePassthrough.assign({
          context_str: () => contextStr,
          history: () => state.history || []
        }),
        tocPrompt,
        model.bind({ response_format: { type: "json_object" } }),
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
      const tocData = await tocChain.invoke({
        topic: state.topic,
        history: state.history || []
      });

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
            let subTopics = [];
            
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
              subTopics = data.subTopics;
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
      return {
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
    }
  );

  // Add a node to generate content for each chapter
  builder.addNode(
    "generateChapterContent",
    async (state) => {
      if (!state.toc) {
        return state;
      }

      // Initialize the full content structure if it doesn't exist
      const fullContent = state.generatedContent || {
        mainTopic: state.mainTopic,
        description: state.description,
        subTopics: [],
      };

      // Process each subtopic
      for (const subtopic of state.toc.subTopics) {
        console.log(`Processing subtopic: ${subtopic.title}`);
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
                
                You MUST use the following JSON format for your response:
                {
                  "lessons": [
                    {
                      "title": "Lesson title",
                      "content": "Comprehensive lesson content...",
                      "quiz": [
                        {
                          "question": "Question text?",
                          "options": ["Option A", "Option B", "Option C", "Option D"],
                          "correctAnswer": 0
                        }
                      ]
                    }
                  ]
                }
                
                DO NOT deviate from this schema. Use exactly these field names: "lessons", "title", "content", "quiz", "question", "options", and "correctAnswer".
                Never use alternative field names.`,
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
                context_str: () => contextStr,
                history: () => state.history || []
              }),
              chapterPrompt,
              model.bind({ response_format: { type: "json_object" } }),
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
            const chapterData = await chapterChain.invoke({
              topic: state.topic,
              history: state.history || [],
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
      }

      // Return updated state
      console.log("Final content structure:", JSON.stringify({
        mainTopic: fullContent.mainTopic,
        description: fullContent.description,
        subTopicsCount: fullContent.subTopics.length
      }));
      return {
        ...state,
        generatedContent: fullContent,
      };
    }
  );

  // Define the edges - правильная последовательность вершин
  builder.addEdge("__start__", "retrieveContext");
  builder.addEdge("retrieveContext", "generateTOC");
  builder.addEdge("generateTOC", "generateChapterContent");
  builder.addEdge("generateChapterContent", "__end__");

  // Compile the graph
  return builder.compile();
}

// Function to store document in vector store
export async function storeDocumentInVectorStore(
  text: string,
  metadata: Record<string, any>
) {
  const documents = textToDocuments(text, metadata);
  return await addDocumentsToVectorStore(documents, metadata);
} 