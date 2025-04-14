# Supabase Setup for Education API

This document provides instructions for setting up Supabase to work with the Education API.

## Environment Variables

Add the following environment variables to your `.env.local` file:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
OPENAI_API_KEY=your_openai_api_key
```

You can find these values in your Supabase dashboard under Project Settings > API.

## PDF Processing Setup

The education API includes PDF processing capabilities for document upload and analysis. 

1. **Install Dependencies**:
   ```bash
   # Add the required packages using yarn
   yarn add pdfjs-dist pdf-parse
   ```

2. **Node.js Environment Support**:
   - The PDF parser is configured with two approaches:
     - Primary: Uses `pdf-parse` for reliable server-side text extraction
     - Fallback: Uses `pdfjs-dist` with browser API polyfills
   - This dual approach ensures maximum compatibility

## Vector Embeddings Setup

1. **Enable pgvector Extension**:
   - Go to the SQL Editor in your Supabase dashboard
   - Run: `CREATE EXTENSION IF NOT EXISTS vector;`
   - This enables vector similarity search capabilities

2. **Create Vector Tables**:
   - Run the SQL from `supabase/migrations/tables.sql` to create all required tables, including:
     - `document_embeddings` for storing vector embeddings
     - `memory_store` for storing LangGraph memory
     - The `match_documents` function for similarity searches

## Regular Database Setup

1. **Create Storage Bucket**:
   - Go to Storage in your Supabase dashboard
   - Create a new bucket named `education-documents`
   - Set the bucket to public or configure appropriate RLS policies

2. **Create Database Tables**:
   - Go to SQL Editor in your Supabase dashboard
   - Run both:
     - `supabase/migrations/tables.sql` (for document storage and vectors)
     - `supabase/migrations/memory_functions.sql` (for LangGraph memory functions)

## Testing Vector Search

To test that your vector search is working:

1. Upload a document and confirm it's stored in the vector store
2. Execute a test query using pgvector's similarity search:

```sql
SELECT * FROM match_documents(
  '[0.1, 0.2, ...]'::vector(1536),
  0.5,
  5,
  '{}'::jsonb
);
```

## Troubleshooting

If you encounter errors:

1. **Vector Extension Issues**:
   - Ensure the `pgvector` extension is properly installed
   - Check that your Supabase plan supports extensions

2. **Database Permission Errors**:
   - Ensure your service role key has sufficient permissions
   - Check RLS policies are correctly configured

3. **Memory Storage Issues**:
   - Run the functions in `memory_functions.sql` to create necessary SQL functions
   - Check for SQL errors in the server logs

4. **PDF Processing Issues**:
   - Check the server logs for detailed error messages
   - The parser includes fallback mechanisms if text extraction fails

The application includes enhanced error handling that will log detailed information about configuration issues. 