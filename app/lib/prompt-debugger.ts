import fs from 'fs';
import path from 'path';

/**
 * Utility to help debug prompt templates with syntax errors
 */
export function debugPromptTemplates() {
  // Read the education-graph.ts file
  const filePath = path.join(process.cwd(), 'lib', 'education-graph.ts');
  const content = fs.readFileSync(filePath, 'utf-8');

  // Find all template strings in the file
  const templateRegex = /`([\s\S]*?)`/g;
  let match;
  const templates = [];
  let lineNumber = 1;
  let currentPos = 0;

  // Count lines to get accurate line numbers
  while ((match = templateRegex.exec(content)) !== null) {
    // Count lines up to this match
    const contentUpToMatch = content.substring(currentPos, match.index);
    const linesUpToMatch = contentUpToMatch.split('\n').length - 1;
    lineNumber += linesUpToMatch;
    currentPos = match.index;

    // Check template for unbalanced braces
    const template = match[1];
    const lines = template.split('\n');
    
    // Check for unbalanced braces
    let braceCount = 0;
    let problematicLine = -1;
    let lineText = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') braceCount++;
        if (line[j] === '}') braceCount--;
        
        // If we have a negative count, there's an unbalanced closing brace
        if (braceCount < 0) {
          problematicLine = i;
          lineText = line;
          break;
        }
      }
      if (problematicLine !== -1) break;
    }
    
    // If we end with non-zero count, there's an unbalanced opening brace
    if (braceCount > 0 && problematicLine === -1) {
      problematicLine = lines.length - 1;
      lineText = lines[lines.length - 1];
    }
    
    templates.push({
      startLine: lineNumber,
      endLine: lineNumber + lines.length - 1,
      template,
      hasError: problematicLine !== -1,
      errorLine: problematicLine !== -1 ? lineNumber + problematicLine : -1,
      errorText: lineText,
      braceBalance: braceCount
    });
    
    // Update line number for next search
    lineNumber += lines.length - 1;
  }
  
  return templates.filter(t => t.hasError);
}

// Run this function to find template errors
export function analyzeTemplates() {
  const errors = debugPromptTemplates();
  if (errors.length === 0) {
    console.log('No template errors found');
    return null;
  }
  
  console.log(`Found ${errors.length} templates with potential errors:`);
  errors.forEach((error, i) => {
    console.log(`\nError #${i+1}:`);
    console.log(`Lines ${error.startLine}-${error.endLine}`);
    console.log(`Error on line ${error.errorLine}: ${error.errorText}`);
    console.log(`Brace balance: ${error.braceBalance}`);
    console.log('Template excerpt:');
    const lines = error.template.split('\n');
    const startLine = Math.max(0, error.errorLine - error.startLine - 2);
    const endLine = Math.min(lines.length, error.errorLine - error.startLine + 3);
    
    for (let i = startLine; i < endLine; i++) {
      const indicator = i === (error.errorLine - error.startLine) ? '>>> ' : '    ';
      console.log(`${indicator}${lines[i]}`);
    }
  });
  
  return errors;
} 