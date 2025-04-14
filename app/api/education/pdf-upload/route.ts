import { NextRequest, NextResponse } from "next/server";

import { extractTextFromPDF } from "@/lib/pdf-parser";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { v4 as uuidv4 } from 'uuid';

export const config = {
  runtime: 'nodejs',
};



export async function POST(req: NextRequest) {
  try {
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    // Check if Supabase is configured
    if (!isSupabaseConfigured()) {
      console.error("Supabase configuration missing:", {
        url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        serviceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        anonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      });
      return NextResponse.json(
        { error: "Supabase is not properly configured" },
        { status: 500 }
      );
    }

    // Parse the FormData
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Check if it's a PDF
    if (!file.type.includes('pdf')) {
      return NextResponse.json(
        { error: "Only PDF files are supported" },
        { status: 400 }
      );
    }

    // Extract file name without extension for topic
    const fileExt = file.name.split('.').pop() || 'pdf';
    const originalName = file.name.replace(`.${fileExt}`, '');

    // Generate a unique file name for storage
    const uniqueFileName = `${uuidv4()}_${file.name}`;
    
    try {
      // First check if the bucket exists
      const { data: buckets, error: bucketError } = await supabaseAdmin
        .storage
        .listBuckets();
      
      const bucketExists = buckets?.some(bucket => bucket.name === 'education-documents');
      
      if (!bucketExists) {
        console.error("Storage bucket 'education-documents' does not exist");
        try {
          // Try to create the bucket
          const { data: createBucket, error: createBucketError } = await supabaseAdmin
            .storage
            .createBucket('education-documents', {
              public: true,
              fileSizeLimit: 52428800 // 50MB
            });
          
          if (createBucketError) {
            console.error("Failed to create bucket:", createBucketError);
            return NextResponse.json(
              { error: `Failed to create storage bucket: ${createBucketError.message}` },
              { status: 500 }
            );
          }
          console.log("Created storage bucket 'education-documents'");
        } catch (bucketCreateError: any) {
          console.error("Error creating bucket:", bucketCreateError);
          return NextResponse.json(
            { error: `Failed to create storage bucket: ${bucketCreateError.message}` },
            { status: 500 }
          );
        }
      }
      
      // Convert file to ArrayBuffer and then to Buffer for Supabase
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Upload file to Supabase Storage
      console.log("Attempting to upload file to Supabase storage...");
      const { data: uploadData, error: uploadError } = await supabaseAdmin
        .storage
        .from('education-documents')
        .upload(uniqueFileName, buffer, {
          contentType: file.type,
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error("Error uploading to Supabase:", uploadError);
        return NextResponse.json(
          { error: `Failed to upload document: ${uploadError.message}` },
          { status: 500 }
        );
      }

      console.log("File successfully uploaded to storage");
      
      // Get public URL for the uploaded file
      const { data: publicUrlData } = supabaseAdmin
        .storage
        .from('education-documents')
        .getPublicUrl(uniqueFileName);

      // Extract text from PDF using the pdf-parser
      try {
        console.log("Starting PDF text extraction...");
        const extractedText = await extractTextFromPDF(arrayBuffer);
        console.log("PDF text extracted successfully, length:", extractedText.length);
        
        // Truncate if too long (to avoid payload size limits)
        const truncatedText = extractedText.substring(0, 100000);
        
        // Store metadata in Supabase database (optional)
        try {
          // Check if the table exists before inserting
          console.log("Attempting to store metadata...");
          // Store metadata in Supabase database
          const { data: metadataData, error: metadataError } = await supabaseAdmin
            .from('document_metadata')
            .insert({
              id: uuidv4(),
              original_name: file.name,
              storage_path: uniqueFileName,
              file_type: file.type,
              file_size: file.size,
              public_url: publicUrlData.publicUrl,
              created_at: new Date().toISOString()
            })
            .select()
            .single();

          if (metadataError) {
            console.error("Error storing metadata:", metadataError);
            // If table doesn't exist, we can still return the file without DB storage
            if (metadataError.code === "42P01") { // PostgreSQL code for undefined_table
              console.warn("Table 'document_metadata' doesn't exist. Skipping metadata storage.");
            }
            // Continue anyway since we have the file uploaded
          } else {
            console.log("Metadata successfully stored");
          }
          
          return NextResponse.json({
            success: true,
            filename: originalName,
            fileInfo: {
              name: file.name,
              type: file.type,
              size: file.size,
              extractedText: truncatedText,
              storageUrl: publicUrlData.publicUrl,
              storagePath: uploadData.path,
              documentId: metadataError ? undefined : metadataData?.id
            }
          });
        } catch (dbError: any) {
          console.error("Database error when storing metadata:", dbError);
          // Continue and return file info without the database metadata
          return NextResponse.json({
            success: true,
            filename: originalName,
            fileInfo: {
              name: file.name,
              type: file.type,
              size: file.size,
              extractedText: truncatedText,
              storageUrl: publicUrlData.publicUrl,
              storagePath: uploadData.path,
              error: `Failed to store metadata: ${dbError.message}`
            }
          });
        }
      } catch (extractionError: any) {
        console.error("Error processing PDF:", extractionError);
        
        // Fallback to sending preview data if text extraction fails
        try {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          // Still try to upload to Supabase even if text extraction failed
          const { data: uploadData, error: uploadError } = await supabaseAdmin
            .storage
            .from('education-documents')
            .upload(uniqueFileName, buffer, {
              contentType: file.type,
              cacheControl: '3600',
              upsert: false
            });

          if (uploadError) {
            console.error("Error uploading to Supabase:", uploadError);
            throw new Error(`Failed to upload document: ${uploadError.message}`);
          }

          // Get public URL for the uploaded file
          const { data: publicUrlData } = supabaseAdmin
            .storage
            .from('education-documents')
            .getPublicUrl(uniqueFileName);
          
          const base64Preview = Buffer.from(arrayBuffer).toString('base64').substring(0, 10000);
          
          return NextResponse.json({
            success: true,
            filename: originalName,
            fileInfo: {
              name: file.name,
              type: file.type,
              size: file.size,
              preview: base64Preview,
              storageUrl: publicUrlData.publicUrl,
              storagePath: uploadData.path
            }
          });
        } catch (fallbackError: any) {
          console.error("Fallback upload failed:", fallbackError);
          return NextResponse.json(
            { error: `Text extraction failed and fallback upload failed: ${fallbackError.message}` },
            { status: 500 }
          );
        }
      }
    } catch (error: any) {
      console.error("Error processing PDF:", error);
      return NextResponse.json(
        { error: error.message || "Failed to process PDF" },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Error processing PDF:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process PDF" },
      { status: 500 }
    );
  }
} 