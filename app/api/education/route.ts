import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";
import { createEducationGraph, storeDocumentInVectorStore } from "@/lib/education-graph";
import { EducationContentSchema } from "@/lib/schemas/education";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Payload schema for request validation
const PayloadSchema = z.object({
  topic: z.string().optional(),
  documentContent: z.string().optional(),
  pdfData: z.string().optional(),
  pdfFileInfo: z
    .object({
      name: z.string(),
      type: z.string(),
      size: z.number(),
      extractedText: z.string().optional(),
      preview: z.string().optional(),
      openaiFileId: z.string().optional(),
      storageUrl: z.string().optional(),
      storagePath: z.string().optional(),
      documentId: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const payload = await req.json();
    const validatedPayload = PayloadSchema.parse(payload);

    // Debug - use a simple topic for testing
    const debugMode = req.headers.get('x-debug-mode') === 'true';
    if (debugMode) {
      // Override payload for debugging
      validatedPayload.topic = "Test Topic";
      validatedPayload.pdfFileInfo = undefined;
    }

    // Set content source based on input
    let contentSource = "";
    let contentType = "";
    let documentReference = null;

    if (validatedPayload.pdfFileInfo?.extractedText) {
      contentSource = validatedPayload.pdfFileInfo.extractedText;
      contentType = "document";
      documentReference = {
        name: validatedPayload.pdfFileInfo.name,
        storageUrl: validatedPayload.pdfFileInfo.storageUrl,
        storagePath: validatedPayload.pdfFileInfo.storagePath,
        documentId: validatedPayload.pdfFileInfo.documentId
      };
    } else if (validatedPayload.pdfFileInfo?.preview) {
      contentSource = validatedPayload.pdfFileInfo.preview;
      contentType = "preview";
      documentReference = {
        name: validatedPayload.pdfFileInfo.name,
        storageUrl: validatedPayload.pdfFileInfo.storageUrl,
        storagePath: validatedPayload.pdfFileInfo.storagePath,
        documentId: validatedPayload.pdfFileInfo.documentId
      };
    } else if (validatedPayload.documentContent) {
      contentSource = validatedPayload.documentContent;
      contentType = "document";
    } else if (validatedPayload.topic) {
      contentSource = validatedPayload.topic;
      contentType = "topic";
    } else {
      return NextResponse.json(
        { error: "No topic or document content provided" },
        { status: 400 }
      );
    }

    // Store document in vector store if we have document content
    if ((contentType === "document" || contentType === "preview") && documentReference) {
      try {
        console.log("Storing document in vector store...");
        await storeDocumentInVectorStore(contentSource, {
          documentId: documentReference.documentId,
          documentName: documentReference.name,
          documentUrl: documentReference.storageUrl
        });
        console.log("Document stored in vector store successfully");
      } catch (vectorError) {
        console.error("Error storing document in vector store:", vectorError);
        // Continue anyway since we can still generate content
      }
    }

    // Create session ID for this run
    const sessionId = uuidv4();

    // Create and run the education graph
    console.log("Creating education graph...");
    const graph = await createEducationGraph();
    
    // Run the graph with topic and context
    console.log("Running education graph with topic:", 
      contentType === "topic" ? contentSource : "Document analysis");
    
    // Initialize empty history messages and memory
    const initialHistory: any[] = [];
    const initialMemory: Record<string, any> = {};
    
    try {
      const context = contentType === "topic" ? [] : [{
        pageContent: contentSource,
        metadata: documentReference ? {
          documentId: documentReference.documentId,
          documentName: documentReference.name,
          documentUrl: documentReference.storageUrl 
        } : { source: "direct input" }
      }];

      // Log the input to the education graph for debugging
      console.log("Education graph input:", JSON.stringify({
        topic: contentType === "topic" ? contentSource : 
          validatedPayload.pdfFileInfo?.name || "Document analysis",
        contextLength: context.length,
        contextSample: context.length > 0 ? context[0].pageContent.substring(0, 100) + "..." : "None"
      }));

      const result = await graph.invoke({
        topic: contentType === "topic" ? contentSource : 
          validatedPayload.pdfFileInfo?.name || "Document analysis",
        context,
        memory: initialMemory,
        history: initialHistory
      });

      console.log("Graph execution completed. Result keys:", Object.keys(result));
      console.log("Has generatedContent:", result.generatedContent ? "yes" : "no");
      
      if (!result.generatedContent) {
        console.error("Generated content is missing from result:", 
          result.error ? `Error: ${result.error}` : JSON.stringify(result, null, 2).substring(0, 500));
        if (result.error) {
          return NextResponse.json(
            { error: result.error },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: "Failed to generate educational content. The response structure was invalid." },
          { status: 500 }
        );
      }

      // Store content in Supabase if configured and we have a document reference
      let contentMetadata = null;
      if (isSupabaseConfigured() && documentReference && result.generatedContent) {
        try {
          console.log("Attempting to store education content in Supabase...");
          const { data, error } = await supabaseAdmin
            .from('education_content')
            .insert({
              id: uuidv4(),
              main_topic: result.generatedContent.mainTopic,
              document_id: documentReference.documentId,
              document_name: documentReference.name,
              document_url: documentReference.storageUrl,
              content: result.generatedContent,
              created_at: new Date().toISOString(),
              session_id: sessionId
            })
            .select()
            .single();

          if (!error) {
            contentMetadata = {
              id: data.id,
              created_at: data.created_at,
              session_id: sessionId
            };
            console.log("Education content successfully stored in database");
          } else {
            console.error("Error storing content in Supabase:", error);
            // Check for table not existing
            if (error.code === "42P01") { // PostgreSQL code for undefined_table
              console.warn("Table 'education_content' doesn't exist. Skipping database storage.");
            }
          }
        } catch (dbError) {
          console.error("Error storing content in database:", dbError);
          // Continue anyway since we have the content generated
        }
      }

      // Validate and return the content
      try {
        const validatedContent = result.generatedContent ? 
          EducationContentSchema.parse(result.generatedContent) : null;
        
        return NextResponse.json({
          ...(validatedContent || {}),
          metadata: contentMetadata
        });
      } catch (validationError) {
        console.error("Error validating content structure:", validationError);
        
        // Return the raw result if validation fails
        return NextResponse.json({
          ...result.generatedContent,
          metadata: contentMetadata,
          validationError: "Content structure validation failed"
        });
      }
    } catch (error: any) {
      console.error("Error executing education graph:", error);
      if (error.stack) {
        console.error("Error stack trace:", error.stack);
      }
      
      // Check for template errors
      if (error.message && error.message.includes("template")) {
        return NextResponse.json(
          { error: "Template error in prompt: " + error.message },
          { status: 500 }
        );
      }
      
      return NextResponse.json(
        { error: error.message || "Failed to execute education graph" },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Error generating education content:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate content" },
      { status: 500 }
    );
  }
}