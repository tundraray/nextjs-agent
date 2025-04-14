import { z } from "zod";

// Define schemas for structured output
export const QuizQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  correctAnswer: z.number(),
});

export const LessonSchema = z.object({
  title: z.string(),
  content: z.string(),
  quiz: z.array(QuizQuestionSchema),
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