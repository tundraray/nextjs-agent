import { StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { SupabaseVectorStoreMemory } from "./supabase-memory";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { Document } from "@langchain/core/documents";
import { addDocumentsToVectorStore, searchVectorStore, textToDocuments } from "./vector-store";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { RunnablePassthrough } from "@langchain/core/runnables";

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

          Your output should be a complete and logical hierarchy that thoroughly covers the subject matter.`,
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
      
      // Normalize TOC data structure - handle different possible formats from the API
      let normalizedTocData = {};
      
      // Handle case where response has MainTopic as an object with Title/Description
      if (tocData.MainTopic && typeof tocData.MainTopic === 'object') {
        normalizedTocData = {
          mainTopic: tocData.MainTopic.Title,
          description: tocData.MainTopic.Description,
          subTopics: Array.isArray(tocData.MainTopic.Subtopics) ? 
            tocData.MainTopic.Subtopics.map(subtopic => ({
              title: subtopic.Title,
              description: subtopic.Description,
              chapters: Array.isArray(subtopic.Chapters) ? 
                subtopic.Chapters.map(chapter => ({
                  title: chapter.Title,
                  description: chapter.Description,
                  lessons: Array.isArray(chapter.Lessons) ?
                    chapter.Lessons.map(lesson => lesson) : 
                    []
                })) : 
                []
            })) : 
            []
        };
      } 
      // Handle case where response has mainTopic/subTopics directly at root level (our expected format)
      else if (tocData.mainTopic && tocData.subTopics) {
        normalizedTocData = tocData;
      }
      // Handle other possible formats
      else {
        // Try to determine format and normalize as best as possible
        const possibleMainTopicKeys = ['mainTopic', 'MainTopic', 'main_topic', 'topic', 'title', 'Title'];
        const possibleDescKeys = ['description', 'Description', 'desc', 'summary', 'Summary'];
        const possibleSubtopicsKeys = ['subTopics', 'Subtopics', 'subtopics', 'sub_topics', 'topics', 'sections'];
        
        // Find main topic
        let mainTopic = null;
        for (const key of possibleMainTopicKeys) {
          if (tocData[key]) {
            mainTopic = tocData[key];
            break;
          }
        }
        
        // Find description
        let description = null;
        for (const key of possibleDescKeys) {
          if (tocData[key]) {
            description = tocData[key];
            break;
          }
        }
        
        // Find subtopics
        let subTopics = [];
        for (const key of possibleSubtopicsKeys) {
          if (Array.isArray(tocData[key])) {
            subTopics = tocData[key];
            break;
          }
        }
        
        normalizedTocData = {
          mainTopic: mainTopic || state.topic,
          description: description || `Educational content about ${state.topic}`,
          subTopics: subTopics
        };
      }
      
      console.log("Normalized TOC data:", JSON.stringify({
        mainTopic: normalizedTocData.mainTopic,
        description: normalizedTocData.description,
        subTopicsCount: normalizedTocData.subTopics?.length || 0
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
                Each quiz question should have 4 options with one correct answer (indicated by the index 0-3).`,
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
            
            // Check if the chapter data has the expected structure
            if (!chapterData.lessons || !Array.isArray(chapterData.lessons)) {
              console.error("Invalid chapter data structure:", chapterData);
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
            } else {
              // Create processed chapter
              processedChapter = {
                title: chapter.title,
                description: chapter.description,
                lessons: chapterData.lessons,
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