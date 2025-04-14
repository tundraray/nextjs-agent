const fs = require('fs');
const path = require('path');
const { extractTextFromPDF } = require('./lib/pdf-parser');

async function testPdfParser() {
  try {
    // Create a test directory if it doesn't exist
    const testDir = path.join(__dirname, 'test', 'data');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Create a simple test PDF file using a buffer
    // This is a minimal PDF with just text "Hello World"
    const minimalPdf = Buffer.from(
      '%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Hello World) Tj\nET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000247 00000 n\n0000000314 00000 n\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n406\n%%EOF',
      'ascii'
    );
    
    // Write the test PDF to a file
    const testPdfPath = path.join(testDir, 'test.pdf');
    fs.writeFileSync(testPdfPath, minimalPdf);
    console.log(`Created test PDF at ${testPdfPath}`);
    
    // Read the PDF file to an ArrayBuffer
    const pdfData = fs.readFileSync(testPdfPath);
    const arrayBuffer = pdfData.buffer.slice(
      pdfData.byteOffset, 
      pdfData.byteOffset + pdfData.byteLength
    );
    
    // Extract text from the PDF
    console.log('Attempting to extract text from test PDF...');
    const text = await extractTextFromPDF(arrayBuffer);
    
    // Log the result
    console.log('Extracted text:', text);
    
    console.log('PDF parsing test completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testPdfParser().catch(console.error); 