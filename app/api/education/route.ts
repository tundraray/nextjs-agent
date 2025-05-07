import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";
import { createEducationGraph, storeDocumentInVectorStore } from "@/lib/education-graph";
import { EducationContentSchema } from "@/lib/schemas/education";

// Function to clean up and fix data structure issues in generated content
function cleanGeneratedContent(content: any) {
  if (!content) return content;
  
  try {
    // Make a deep copy of the content to avoid mutation issues
    const cleanedContent = JSON.parse(JSON.stringify(content));
    
    // Process subtopics
    if (cleanedContent.subTopics && Array.isArray(cleanedContent.subTopics)) {
      cleanedContent.subTopics.forEach((subtopic: any) => {
        // Process chapters
        if (subtopic.chapters && Array.isArray(subtopic.chapters)) {
          subtopic.chapters.forEach((chapter: any) => {
            // Process lessons
            if (chapter.lessons && Array.isArray(chapter.lessons)) {
              chapter.lessons.forEach((lesson: any) => {
                // Fix memory cards
                if (lesson.memoryCards && Array.isArray(lesson.memoryCards)) {
                  // Filter out memory cards with missing required fields
                  lesson.memoryCards = lesson.memoryCards
                    .filter((card: any) => {
                      // Keep only cards with both title and description
                      return card && typeof card === 'object' && 
                             card.title && typeof card.title === 'string' &&
                             card.description && typeof card.description === 'string';
                    });
                }
                
                // Fix quiz cards
                if (lesson.quizCards && Array.isArray(lesson.quizCards)) {
                  // Filter out quiz cards with missing required fields
                  lesson.quizCards = lesson.quizCards
                    .filter((card: any) => {
                      return card && typeof card === 'object' && 
                             card.question && typeof card.question === 'string' &&
                             card.options && Array.isArray(card.options) &&
                             typeof card.correctAnswer === 'number';
                    });
                }
              });
            }
          });
        }
      });
    }
    
    return cleanedContent;
  } catch (error) {
    console.error("Error cleaning generated content:", error);
    return content; // Return original content if cleaning fails
  }
}

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
    .nullable()
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

    // Parse and validate the payload with better error handling
    let validatedPayload;
    try {
      const payload = await req.json();
      console.log("Received payload:", JSON.stringify({
        hasTopic: !!payload.topic,
        hasDocumentContent: !!payload.documentContent,
        hasPdfData: !!payload.pdfData,
        hasPdfFileInfo: payload.pdfFileInfo !== undefined,
        pdfFileInfoType: payload.pdfFileInfo !== undefined ? typeof payload.pdfFileInfo : "undefined"
      }));
      
      validatedPayload = PayloadSchema.parse(payload);
    } catch (error) {
      console.error("Payload validation error:", error);
      return NextResponse.json(
        { error: "Invalid request format. Check your input data." },
        { status: 400 }
      );
    }

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

      try {
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
          // Clean the content before validation
          const cleanedContent = cleanGeneratedContent(result.generatedContent);
          
          // Validate the cleaned content
          const validatedContent = cleanedContent ? 
            EducationContentSchema.parse(cleanedContent) : null;
          
          return NextResponse.json({
            ...(validatedContent || {}),
            metadata: contentMetadata
          });
        } catch (validationError) {
          console.error("Error validating content structure:", validationError);
          
          // If validation fails, still clean the content and return it
          const cleanedContent = cleanGeneratedContent(result.generatedContent);
          
          // Return the raw result if validation fails
          return NextResponse.json({
            ...cleanedContent,
            metadata: contentMetadata,
            validationError: "Content structure validation failed"
          });
        }
      } catch (graphError: any) {
        console.error("Error executing graph:", graphError);
        
        // Extract nested errors if they exist
        const errorMessage = graphError.cause 
          ? `${graphError.message}: ${graphError.cause.message}` 
          : graphError.message;
          
        return NextResponse.json(
          { 
            error: errorMessage,
            details: graphError.stack
          },
          { status: 500 }
        );
      }
    } catch (error: any) {
      console.error("Error executing education graph:", error);
      if (error.stack) {
        console.error("Error stack trace:", error.stack);
      }
      
      // Check for template errors
      if (error.message && error.message.includes("template")) {
        return NextResponse.json(
          { 
            error: "Template error in prompt: " + error.message,
            details: error.stack
          },
          { status: 500 }
        );
      }
      
      return NextResponse.json(
        { 
          error: error.message || "Failed to execute education graph",
          details: error.stack
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Error generating education content:", error);
    return NextResponse.json(
      { 
        error: error.message || "Failed to generate content",
        details: error.stack
      },
      { status: 500 }
    );
  }
}