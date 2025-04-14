import { searchVectorStore } from "../vector-store";
import { EducationState } from "../types/education";

/**
 * Node function to retrieve relevant context from vector store
 */
export async function retrieveContext(state: EducationState): Promise<EducationState> {
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
} 