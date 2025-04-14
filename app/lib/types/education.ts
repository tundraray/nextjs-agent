/**
 * Interface defining the state structure for the education graph nodes
 */
export interface EducationState {
  topic: string;
  context: any[]; // Document[] with flexible type
  mainTopic?: string;
  description?: string;
  toc?: any;
  currentSubtopic?: any;
  currentChapter?: any;
  generatedContent?: any;
  memory: Record<string, any>;
  history: any[]; // (HumanMessage | AIMessage)[] with flexible type
  [key: string]: any; // Additional fields
} 