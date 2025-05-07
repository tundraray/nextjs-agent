# Interactive Course Generator

This feature allows users to create educational courses through a chat interface with real-time streaming updates.

## How it Works

1. Users can have a normal chat conversation
2. There are two ways to create a course:
   - Type a command like "create course about [topic]" to generate a course from scratch
   - Upload a PDF document and then type "create course from document" to generate a course based on the document content
3. The system starts generating a course with:
   - Main topic description
   - Subtopics (3-5)
   - Chapters per subtopic (2-4)
   - Lessons per chapter (3-5) with content and quizzes

## PDF Document Support

Users can upload PDF documents through the interface:
- Click the paperclip icon to select a PDF file
- The system processes the document and extracts its content
- Type "create course from document" to generate educational content based on the PDF
- The generated course will be based on the information contained in the document

## Streaming Updates

The course generation provides real-time updates, showing:
- Current processing node/stage in the pipeline
- Progress updates as different parts are completed
- Final course structure when complete

## API Structure

The backend uses a streaming text API that sends specially formatted messages:
- `START:TOPIC` - Beginning of course generation with topic
- `START:NODE` - Start of a processing node in the pipeline
- `END:NODE` - Completion of a processing node
- `START:STAGE` - Beginning of a major generation stage
- `CONTENT:JSON` - Final course content in JSON format
- `ERROR` - Any error messages

## Integration

The course generator uses the education graph from the library, with a streaming interface for real-time updates during the generation process.

## Usage Examples

Try generating courses in various ways:
- "Create course about Introduction to Quantum Computing"
- Upload a research paper and type "create course from document"
- "Generate education on Python Programming for Beginners"
- Upload a textbook and let the system create structured educational content 