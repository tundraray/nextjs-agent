import { retrieveContext, generateTOC, generateChapterContent } from './index';
import { EducationState } from '../types/education';

/**
 * Creates an adapter for node functions to be compatible with the StateGraph API
 * @param fn The node function to adapt
 * @returns A function compatible with StateGraph
 */
function createNodeAdapter<T extends EducationState>(
  fn: (state: T) => Promise<T>
) {
  return async (state: T) => {
    const result = await fn(state);
    return { state: result };
  };
}

// Adapted node functions for StateGraph
export const retrieveContextNode = createNodeAdapter(retrieveContext);
export const generateTOCNode = createNodeAdapter(generateTOC);
export const generateChapterContentNode = createNodeAdapter(generateChapterContent); 