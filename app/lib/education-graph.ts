import { addDocumentsToVectorStore, textToDocuments } from "./vector-store";
import { EducationState } from "./types/education";
import { retrieveContext, generateTOC, generateChapterContent } from "./education-nodes";

/**
 * Create an educational content generation pipeline.
 * 
 * This function returns a callable object that processes the educational content
 * generation pipeline using a sequential execution model rather than a graph.
 * 
 * This approach is more robust against API changes in the StateGraph library.
 */
export async function createEducationGraph() {
  // Return a simple runnable that processes the steps sequentially
  return {
    invoke: async (input: Partial<EducationState> | Record<string, any> | undefined) => {
      console.log("Using sequential processing for education pipeline");
      
      // Get state from input or create a minimal viable state
      // Ensure the state object conforms to EducationState interface
      const state: EducationState = {
        topic: input?.topic || "",
        context: input?.context || [],
        memory: input?.memory || {},
        history: input?.history || [],
        ...(input || {})
      };
      
      try {
        console.log("Starting sequential execution with input state keys:", Object.keys(state));
        
        // Step 1: Retrieve context
        const contextState = await retrieveContext(state);
        console.log("After retrieveContext, state keys:", Object.keys(contextState));
        
        // Step 2: Generate TOC
        const tocState = await generateTOC(contextState);
        console.log("After generateTOC, state keys:", Object.keys(tocState));
        console.log("TOC present in state:", !!tocState.toc);
        
        // Validate that TOC was created
        if (!tocState.toc) {
          console.error("TOC data is missing after TOC generation step");
          return {
            ...tocState,
            error: "TOC data was not generated properly"
          };
        }
        
        // Step 3: Generate chapter content
        const contentState = await generateChapterContent(tocState);
        console.log("After generateChapterContent, state keys:", Object.keys(contentState));
        console.log("Generated content present:", !!contentState.generatedContent);
        
        return contentState;
      } catch (error) {
        console.error("Error in education pipeline processing:", error);
        return {
          ...state,
          error: "Failed to process educational content: " + String(error)
        };
      }
    }
  };
}

/**
 * Function to store document in vector store
 */
export async function storeDocumentInVectorStore(
  text: string,
  metadata: Record<string, any>
) {
  const documents = textToDocuments(text, metadata);
  return await addDocumentsToVectorStore(documents, metadata);
} 