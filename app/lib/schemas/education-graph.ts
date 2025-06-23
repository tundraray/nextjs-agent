import { z } from "zod";

// Define Zod schemas for validation
export const LessonSchema = z.object({
  title: z.string(),
  content: z.string().optional(),
  quiz: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      correctAnswer: z.number().int()
    })
  ).optional()
});

export const ChapterSchema = z.object({
  title: z.string(),
  description: z.string(),
  lessons: z.array(z.union([z.string(), LessonSchema]))
});

export const SubTopicSchema = z.object({
  title: z.string(),
  description: z.string(),
  chapters: z.array(ChapterSchema)
});

export const TocSchema = z.object({
  mainTopic: z.string(),
  description: z.string(),
  subTopics: z.array(SubTopicSchema)
});

// Alternative schema for various formats that might be returned by the API
export const AlternativeTocSchema = z.object({
  mainTopic: z.string().optional(),
  MainTopic: z.object({
    Title: z.string(),
    Description: z.string(),
    Subtopics: z.array(z.object({
      Title: z.string(),
      Description: z.string(),
      Chapters: z.array(z.object({
        Title: z.string(),
        Description: z.string(),
        Lessons: z.array(z.string())
      }))
    }))
  }).optional(),
  "Main Topic": z.object({
    Title: z.string(),
    Description: z.string(),
    Subtopics: z.array(z.object({
      Title: z.string(),
      Description: z.string(),
      Chapters: z.array(z.object({
        Title: z.string(),
        Description: z.string(),
        Lessons: z.array(z.string())
      }))
    }))
  }).optional(),
  "Course Title": z.string().optional(),
  "course title": z.string().optional(),
  courseTitle: z.string().optional(),
  "Course Description": z.string().optional(),
  "course description": z.string().optional(),
  courseDescription: z.string().optional(),
  description: z.string().optional(),
  Description: z.string().optional(),
  subTopics: z.array(SubTopicSchema).optional(),
  Subtopics: z.array(z.any()).optional(),
  subtopics: z.array(z.any()).optional(),
  topics: z.array(z.any()).optional(),
  Topics: z.array(z.any()).optional(),
  "Sub-Topics": z.array(z.any()).optional(),
  "sub-topics": z.array(z.any()).optional()
});

// Lesson content response schema
export const LessonContentSchema = z.object({
  lessons: z.array(
    z.object({
      lessonInfo: z.object({
        title: z.string(),
        description: z.string()
      }),
      videoScript: z.object({
        title: z.string(),
        description: z.string()
      }),
      memoryCards: z.array(
        z.object({
          title: z.string(),
          description: z.string(),
          situation: z.string().optional(),
          response: z.string().optional()
        })
      ).optional(),
      quizCards: z.array(
        z.object({
          question: z.string(),
          options: z.array(z.string()),
          correctAnswer: z.number().int()
        })
      ).optional(),
      openEndedQuestion: z.object({
        title: z.string(),
        description: z.string().optional()
      }).optional(),
      openEndedQuestions: z.array(
        z.object({
          title: z.string(),
          description: z.string().optional()
        })
      ).optional()
    })
  )
});

// Alternative lesson content schema
export const AlternativeLessonContentSchema = z.object({
  lessons: z.array(z.any()).optional(),
  Lessons: z.array(z.any()).optional()
}).catchall(z.any()); 