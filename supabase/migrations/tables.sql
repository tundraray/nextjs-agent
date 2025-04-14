-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create a table for document metadata
CREATE TABLE IF NOT EXISTS document_metadata (
  id UUID PRIMARY KEY,
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  public_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a table for education content
CREATE TABLE IF NOT EXISTS education_content (
  id UUID PRIMARY KEY,
  main_topic TEXT NOT NULL,
  document_id UUID,
  document_name TEXT,
  document_url TEXT,
  content JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (document_id) REFERENCES document_metadata(id) ON DELETE SET NULL
);

-- Create a table for vector embeddings
CREATE TABLE IF NOT EXISTS document_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  metadata JSONB,
  embedding vector(1536),
  document_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (document_id) REFERENCES document_metadata(id) ON DELETE CASCADE
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_document_metadata_created_at ON document_metadata(created_at);
CREATE INDEX IF NOT EXISTS idx_education_content_main_topic ON education_content(main_topic);
CREATE INDEX IF NOT EXISTS idx_education_content_document_id ON education_content(document_id);
CREATE INDEX IF NOT EXISTS idx_document_embeddings_document_id ON document_embeddings(document_id);

-- Create a vector similarity search function
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold FLOAT,
  match_count INT,
  filter JSONB DEFAULT '{}'
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    document_embeddings.id,
    document_embeddings.content,
    document_embeddings.metadata,
    1 - (document_embeddings.embedding <=> query_embedding) AS similarity
  FROM document_embeddings
  WHERE filter = '{}'::jsonb OR metadata @> filter
  AND 1 - (document_embeddings.embedding <=> query_embedding) > match_threshold
  ORDER BY document_embeddings.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Add RLS (Row Level Security) policies
ALTER TABLE document_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE education_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_embeddings ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Allow authenticated users to read document metadata"
  ON document_metadata FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read education content"
  ON education_content FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read document embeddings"
  ON document_embeddings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Create policies for service role (used by the application)
CREATE POLICY "Allow service role full access to document metadata"
  ON document_metadata FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Allow service role full access to education content"
  ON education_content FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Allow service role full access to document embeddings"
  ON document_embeddings FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role'); 