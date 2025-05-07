import { z } from "zod";

// Define schemas for structured output
export const QuizQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  correctAnswer: z.number(),
});

export const MemoryCardSchema = z.object({
  title: z.string(),
  description: z.string(),
  situation: z.string().optional(),
  response: z.string().optional(),
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