# Education Content Generator

This feature allows you to automatically generate educational content from a topic or PDF document. The system will analyze the topic or document, break it down into subtopics, and generate lessons and quizzes for each subtopic.

## Features

- Generate educational content from a text topic
- Upload and analyze PDF documents to create educational content
- Direct integration with OpenAI for PDF analysis
- Create structured courses with:
  - Main topic description
  - Subtopics
  - Lessons for each subtopic
  - Quiz questions for each lesson
- Responsive UI for viewing generated content

## Setup

1. Make sure you have an OpenAI API key set in your `.env.local` file:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

2. Install the required dependencies:
   ```
   yarn install
   ```

3. Run the development server:
   ```
   yarn dev
   ```

4. Navigate to `/education` in your browser to access the education generator.

## Usage

### Text Topic

1. Enter a topic in the text area (e.g., "Introduction to Machine Learning")
2. Click "Generate Content"
3. Wait for the content to be generated (may take 1-2 minutes depending on topic complexity)
4. View and use the generated educational content

### PDF Document

1. Click "Choose PDF" to upload a PDF document
2. The system will upload the PDF to OpenAI for analysis
3. You can edit the auto-generated topic name if needed
4. Click "Generate Content"
5. Wait for the content to be generated
6. View and use the generated educational content

## How It Works

The Education Generator uses a sophisticated multi-step process to create educational content:

1. **PDF Upload and Processing**: When a PDF is uploaded, the system:
   - Sends the PDF directly to OpenAI's API
   - If OpenAI API integration is successful, uses OpenAI's Vision AI to analyze the document content
   - Falls back to base64 preview processing if OpenAI integration fails

2. **Analysis Stage**: The system analyzes the provided topic or PDF to determine the main topic and identify logical subtopics.

3. **Content Generation Stage**: For each identified subtopic, the system creates multiple lessons with educational content.

4. **Quiz Generation Stage**: For each lesson, the system creates quiz questions with multiple-choice answers.

5. **Assembly Stage**: All generated content is assembled into a structured course format for display.

## Technical Implementation

The feature is implemented using:

- Next.js for the frontend and API routes
- LangChain for structured content generation
- OpenAI GPT-4 Vision API for PDF analysis
- OpenAI's API for direct file upload and processing
- Zod for schema validation and type safety
- TypeScript for strong typing

The implementation uses a hybrid approach:
1. Tries to analyze PDFs directly with OpenAI's advanced models
2. Falls back to base64 preview analysis if OpenAI integration fails
3. Uses LangChain for structured content generation in all cases

## Limitations

- PDF processing is limited by OpenAI's file size restrictions (typically 20MB)
- The quality of generated content depends on the quality of the input topic/document
- Large or complex PDFs may result in simplified analysis

## Future Improvements

- Enhanced PDF extraction and processing capabilities
- Support for more document formats (DOCX, PPTX, etc.)
- Implementation of a document chunking system for large PDFs
- Interactive quiz features with scoring
- Content saving and management
- Support for different educational styles and formats 