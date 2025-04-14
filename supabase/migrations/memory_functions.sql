-- Create a function to execute SQL safely (requires admin privileges)
CREATE OR REPLACE FUNCTION exec(sql text) RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to create memory table if it doesn't exist
CREATE OR REPLACE FUNCTION create_memory_table_if_not_exists() RETURNS void AS $$
BEGIN
  CREATE TABLE IF NOT EXISTS memory_store (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL,
    input TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    output TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_id, input_hash)
  );
  
  CREATE INDEX IF NOT EXISTS idx_memory_store_session_input ON memory_store(session_id, input_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 