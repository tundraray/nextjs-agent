import { supabaseAdmin } from "./supabase";
import { OpenAIEmbeddings } from "@langchain/openai";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { Document } from "@langchain/core/documents";

// Initialize OpenAI embeddings
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-small",
});

// Create a vector store instance
export async function createVectorStore() {
  return await SupabaseVectorStore.fromExistingIndex(embeddings, {
    client: supabaseAdmin,
    tableName: "document_embeddings",
    queryName: "match_documents",
  });
}

// Add documents to the vector store
export async function addDocumentsToVectorStore(
  documents: Document[],
  metadata: Record<string, any> = {}
) {
  const vectorStore = await createVectorStore();
  return await vectorStore.addDocuments(
    documents.map(doc => ({
      ...doc,
      metadata: { ...doc.metadata, ...metadata }
    }))
  );
}

// Search documents in the vector store
export async function searchVectorStore(
  query: string,
  k: number = 5,
  filter?: Record<string, any>
) {
  const vectorStore = await createVectorStore();
  return await vectorStore.similaritySearch(query, k, filter);
}

// Helper to split a text into documents
export function textToDocuments(
  text: string, 
  metadata: Record<string, any> = {},
  chunkSize: number = 1000
): Document[] {
  const chunks = [];
  
  // Simple chunking - in production you might want more sophisticated chunking
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.substring(i, i + chunkSize);
    if (chunk.trim()) {
      chunks.push(new Document({
        pageContent: chunk,
        metadata: { 
          chunk: Math.floor(i / chunkSize),
          ...metadata 
        }
      }));
    }
  }
  
  return chunks;
} 