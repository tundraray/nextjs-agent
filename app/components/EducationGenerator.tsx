"use client";

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
}

interface MemoryCard {
  title: string;
  description: string;
  situation?: string;
  response?: string;
}

interface OpenEndedQuestion {
  title: string;
  description?: string;
}

interface Lesson {
  lessonInfo: {
    title: string;
    description: string;
  };
  videoScript: {
    title: string;
    description: string;
  };
  memoryCards?: MemoryCard[];
  quizCards?: QuizQuestion[];
  openEndedQuestion?: OpenEndedQuestion;
  openEndedQuestions?: OpenEndedQuestion[];
}

interface Chapter {
  title: string;
  description: string;
  lessons: Lesson[];
}

interface SubTopic {
  title: string;
  description: string;
  chapters: Chapter[];
}

interface EducationContent {
  mainTopic: string;
  description: string;
  subTopics: SubTopic[];
  metadata?: any;
}

interface PDFFileInfo {
  name: string;
  type: string;
  size: number;
  openaiFileId?: string;
  preview?: string;
}

export default function EducationGenerator() {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [pdfProcessing, setPdfProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedContent, setGeneratedContent] = useState<EducationContent | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [pdfFileInfo, setPdfFileInfo] = useState<PDFFileInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    
    if (file.type !== 'application/pdf') {
      setError('Only PDF files are supported');
      return;
    }
    
    setUploadedFile(file);
    setError(null);
    setPdfProcessing(true);
    
    try {
      // Create FormData
      const formData = new FormData();
      formData.append('file', file);
      
      // Upload to the backend endpoint
      const response = await fetch('/api/education/pdf-upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process PDF');
      }
      
      const data = await response.json();
      
      // Set the PDF file info
      setPdfFileInfo(data.fileInfo);
      setTopic(data.filename);
      
    } catch (err) {
      console.error('Error processing PDF:', err);
      setError(err instanceof Error ? err.message : 'Failed to process PDF file');
      setUploadedFile(null);
      setPdfFileInfo(null);
    } finally {
      setPdfProcessing(false);
    }
  };
  
  const clearUploadedFile = () => {
    setUploadedFile(null);
    setPdfFileInfo(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!topic.trim() && !pdfFileInfo) {
      setError('Please enter a topic or upload a document');
      return;
    }

    setLoading(true);
    setError(null);
    setGeneratedContent(null);

    try {
      console.log('Sending request to /api/education with topic:', topic);
      
      // Create a payload with proper null handling
      const payload: {
        topic: string;
        pdfFileInfo?: PDFFileInfo | null;
      } = {
        topic: topic.trim()
      };
      
      // Only include pdfFileInfo if it exists and is not null
      if (pdfFileInfo) {
        payload.pdfFileInfo = pdfFileInfo;
      }
      
      console.log('Request payload:', payload);
      
      const response = await fetch('/api/education', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log('Response status:', response.status);
      
      const data = await response.json();
      console.log('Response data:', data);
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate content');
      }

      setGeneratedContent(data);
    } catch (err) {
      console.error('Error generating content:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Education Content Generator</h1>
      
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="flex flex-col space-y-6">
          <div className="flex flex-col space-y-2">
            <label htmlFor="topic" className="font-medium">
              Enter a topic to generate educational content
            </label>
            <textarea
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="border rounded p-2 h-20"
              placeholder="Enter a topic (e.g., 'Introduction to Machine Learning')"
            />
          </div>
          
          <div className="border-t pt-4">
            <p className="mb-2 font-medium">Or upload a PDF document</p>
            
            <div className="flex items-center space-x-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".pdf"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
                disabled={pdfProcessing}
              />
              <label
                htmlFor="file-upload"
                className={`cursor-pointer px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 ${pdfProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {pdfProcessing ? 'Processing...' : 'Choose PDF'}
              </label>
              
              {uploadedFile && !pdfProcessing && (
                <div className="flex items-center">
                  <span className="text-gray-600 mr-2">
                    {uploadedFile.name} ({Math.round(uploadedFile.size / 1024)} KB)
                  </span>
                  <button
                    type="button"
                    onClick={clearUploadedFile}
                    className="text-red-500 hover:text-red-700"
                  >
                    ✕
                  </button>
                </div>
              )}
              
              {pdfProcessing && (
                <div className="flex items-center">
                  <span className="text-gray-600">Processing PDF...</span>
                  <div className="ml-2 w-4 h-4 rounded-full border-2 border-t-blue-500 animate-spin"></div>
                </div>
              )}
            </div>
            
            {pdfFileInfo && !pdfProcessing && (
              <div className="mt-4">
                <p className="font-medium">PDF uploaded successfully!</p>
                {pdfFileInfo.openaiFileId ? (
                  <p className="text-gray-600 text-sm mt-1">
                    The PDF has been uploaded to OpenAI and will be analyzed to generate educational content when you click &quot;Generate Content&quot;.
                  </p>
                ) : (
                  <p className="text-gray-600 text-sm mt-1">
                    A preview of the PDF has been extracted and will be used to generate educational content.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        
        <button 
          type="submit" 
          disabled={loading || pdfProcessing}
          className="mt-6 bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:bg-blue-300"
        >
          {loading ? 'Generating...' : 'Generate Content'}
        </button>
      </form>

      {error && (
        <div className="border border-red-500 bg-red-100 text-red-700 p-4 rounded mb-6">
          {error}
        </div>
      )}

      {loading && (
        <div className="border rounded p-4 mb-6">
          <h2 className="text-xl font-bold mb-2">Generating Content...</h2>
          <p>This may take a minute or two. We&apos;re analyzing your {uploadedFile ? 'document' : 'topic'}, breaking it down into subtopics, and creating lessons with quizzes.</p>
          <div className="mt-4 w-full h-2 bg-gray-200 rounded overflow-hidden">
            <div className="animate-pulse bg-blue-500 h-full"></div>
          </div>
        </div>
      )}

      {generatedContent && (
        <div className="space-y-6">
          <div className="border rounded p-4">
            <h2 className="text-xl font-bold mb-2">{generatedContent.mainTopic}</h2>
            <p className="text-gray-600">{generatedContent.description}</p>
          </div>

          {generatedContent.subTopics && generatedContent.subTopics.map((subTopic, index) => (
            <div key={index} className="border rounded p-4">
              <h3 className="text-lg font-bold mb-2">{subTopic.title}</h3>
              <p className="text-gray-600 mb-4">{subTopic.description}</p>
              
              <div className="space-y-4">
                {subTopic.chapters && subTopic.chapters.map((chapter, chapterIndex) => (
                  <div key={chapterIndex} className="border-l-4 border-blue-500 pl-4 mb-4">
                    <h4 className="font-bold mb-2">{chapter.title}</h4>
                    <p className="mb-4 whitespace-pre-line">{chapter.description}</p>
                    
                    {chapter.lessons && chapter.lessons.map((lesson, lessonIndex) => (
                      <div key={lessonIndex} className="border-l-4 border-blue-500 pl-4 mb-4">
                        <h5 className="font-bold mb-2">{lesson.lessonInfo.title}</h5>
                        <p className="mb-4 whitespace-pre-line">{lesson.lessonInfo.description}</p>
                        
                        {lesson.videoScript && (
                          <div className="bg-gray-50 p-4 rounded">
                            <h6 className="font-bold mb-2">Video Script</h6>
                            <p className="text-gray-600">{lesson.videoScript.title}</p>
                            <p className="text-gray-600">{lesson.videoScript.description}</p>
                          </div>
                        )}

                        {lesson.memoryCards && lesson.memoryCards.length > 0 && (
                          <div className="bg-gray-50 p-4 rounded">
                            <h6 className="font-bold mb-2">Memory Cards</h6>
                            {lesson.memoryCards.map((card, cardIndex) => (
                              <div key={cardIndex} className="mb-4">
                                <p className="font-medium mb-2">{card.title}</p>
                                <p className="text-gray-600">{card.description}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {lesson.quizCards && lesson.quizCards.length > 0 && (
                          <div className="bg-gray-50 p-4 rounded">
                            <h6 className="font-bold mb-2">Quiz</h6>
                            {lesson.quizCards.map((question, qIndex) => (
                              <div key={qIndex} className="mb-4">
                                <p className="font-medium mb-2">{question.question}</p>
                                <div className="space-y-2">
                                  {question.options && question.options.map((option, oIndex) => (
                                    <label key={oIndex} className="flex items-center gap-2">
                                      <input
                                        type="radio"
                                        name={`quiz-${index}-${chapterIndex}-${lessonIndex}-${qIndex}`}
                                        value={oIndex}
                                      />
                                      {option}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {lesson.openEndedQuestion && (
                          <div className="bg-gray-50 p-4 rounded">
                            <h6 className="font-bold mb-2">Open-Ended Question</h6>
                            <p className="font-medium mb-2">{lesson.openEndedQuestion.title}</p>
                            <p className="text-gray-600">{lesson.openEndedQuestion.description}</p>
                          </div>
                        )}

                        {lesson.openEndedQuestions && lesson.openEndedQuestions.length > 0 && (
                          <div className="bg-gray-50 p-4 rounded">
                            <h6 className="font-bold mb-2">Open-Ended Questions</h6>
                            {lesson.openEndedQuestions.map((question, qIndex) => (
                              <div key={qIndex} className="mb-4">
                                <p className="font-medium mb-2">{question.title}</p>
                                <p className="text-gray-600">{question.description}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 