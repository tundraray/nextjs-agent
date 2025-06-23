import { z } from "zod";

// Define schemas for structured output
export const QuizQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  correctAnswer: z.number(),
});

// More flexible memory card schema - allows either direct string values or objects with properties
export const MemoryCardSchema = z.union([
  // Full object form with title and description
  z.object({
    title: z.string(),
    description: z.string(),
    situation: z.string().optional(),
    response: z.string().optional(),
  }),
  // Simplified object form with just content
  z.object({
    content: z.string(),
  })
]).transform(card => {
  // Normalize the card structure
  if ('content' in card) {
    return {
      title: 'Content',
      description: card.content
    };
  }
  return card;
});

export const OpenEndedQuestionSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
});

export const LessonSchema = z.object({
  lessonInfo: z.object({
    title: z.string(),
    description: z.string(),
  }),
  videoScript: z.object({
    title: z.string(),
    description: z.string(),
  }),
  memoryCards: z.array(MemoryCardSchema).optional(),
  quizCards: z.array(QuizQuestionSchema).optional(),
  openEndedQuestion: OpenEndedQuestionSchema.optional(),
  openEndedQuestions: z.array(OpenEndedQuestionSchema).optional(),
});

// Updated schema with nested chapters
export const ChapterSchema = z.object({
  title: z.string(),
  description: z.string(),
  lessons: z.array(LessonSchema),
});

export const SubTopicSchema = z.object({
  title: z.string(),
  description: z.string(),
  chapters: z.array(ChapterSchema),
});

export const EducationContentSchema = z.object({
  mainTopic: z.string(),
  description: z.string(),
  subTopics: z.array(SubTopicSchema),
}); 