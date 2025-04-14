import { BaseMemory } from "langchain/memory";
import { supabaseAdmin } from "./supabase";
import { v4 as uuidv4 } from "uuid";

/**
 * Класс для хранения памяти в Supabase
 */
export class SupabaseVectorStoreMemory extends BaseMemory {
  sessionId: string;
  memoryCache: Record<string, string> = {};

  constructor(sessionId?: string) {
    super();
    this.sessionId = sessionId || uuidv4();
  }

  /**
   * Возвращает ключи, используемые в памяти
   */
  get memoryKeys(): string[] {
    return ["history"];
  }

  /**
   * Получает переменные из памяти по ключу
   */
  async loadMemoryVariables(values: Record<string, any>): Promise<Record<string, any>> {
    const input = values.input || '';
    
    if (!input) {
      return { history: "" };
    }

    const key = this.getMemoryKey(input);
    return { history: this.memoryCache[key] || "" };
  }

  /**
   * Сохраняет контекст в память
   */
  async saveContext(
    inputValues: Record<string, any>,
    outputValues: Record<string, any>
  ): Promise<void> {
    const input = inputValues.input || '';
    const output = outputValues.output || '';
    
    if (!input || !output) {
      return;
    }

    const key = this.getMemoryKey(input);
    this.memoryCache[key] = output;
  }

  /**
   * Очищает память для текущей сессии
   */
  async clear(): Promise<void> {
    this.memoryCache = {};
  }

  /**
   * Создает ключ памяти на основе ввода
   */
  private getMemoryKey(input: string): string {
    return `${this.sessionId}:${input}`;
  }

  // Method to get memory variables
  async loadMemoryVariablesFromSupabase(values: Record<string, any>) {
    // Get the input from the values
    const input = values.input || '';
    
    // If there's no input, return empty
    if (!input) {
      return { history: "" };
    }

    try {
      // Query the memory table for the input and session
      const { data, error } = await supabaseAdmin
        .from('memory_store')
        .select('output')
        .eq('input_hash', this.hashInput(input))
        .eq('session_id', this.sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error("Error loading from memory store:", error);
        return { history: "" };
      }

      // Return the output if found
      return { history: data?.output || "" };
    } catch (error: any) {
      console.error("Error in loadMemoryVariables:", error);
      // Check if table exists
      if (error.code === "42P01") {
        // Create table if doesn't exist
        this.createMemoryTable();
      }
      return { history: "" };
    }
  }

  // Method to save context to memory
  async saveContextToSupabase(
    inputValues: Record<string, any>,
    outputValues: Record<string, any>
  ): Promise<void> {
    // Get input and output
    const input = inputValues.input || '';
    const output = outputValues.output || '';
    
    if (!input || !output) {
      return;
    }

    try {
      // Store in the memory table
      const { error } = await supabaseAdmin
        .from('memory_store')
        .insert({
          id: uuidv4(),
          session_id: this.sessionId,
          input: input,
          input_hash: this.hashInput(input),
          output: output,
          created_at: new Date().toISOString()
        });

      if (error) {
        console.error("Error saving to memory store:", error);
        // Check if table exists
        if (error.code === "42P01") {
          // Create table if doesn't exist
          await this.createMemoryTable();
          // Try again
          await this.saveContextToSupabase(inputValues, outputValues);
        }
      }
    } catch (error) {
      console.error("Error in saveContext:", error);
    }
  }

  // Simple hash function for input
  private hashInput(input: string): string {
    // Create a consistent hash for the input
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  // Create memory table if it doesn't exist
  private async createMemoryTable() {
    try {
      // Create the memory table SQL
      const createTableSQL = `
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
      `;
      
      // Run SQL directly through Supabase
      await supabaseAdmin.from('_pgrpc').select('*').limit(0);
      await supabaseAdmin.rpc('exec', { sql: createTableSQL });
    } catch (error) {
      console.error("Error creating memory table:", error);
    }
  }
} 