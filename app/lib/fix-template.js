const fs = require('fs');
const path = require('path');

// Read the file
const filePath = path.join(__dirname, 'education-graph.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Find the problematic line with the educator task and curly brace
const regex = /content: `You are an expert educator tasked with creating a comprehensive and hierarchical educational course structure.*?{/;
const fixedContent = content.replace(regex, 'content: `You are an expert educator tasked with creating a comprehensive and hierarchical educational course structure.');

// Write back to file
fs.writeFileSync(filePath, fixedContent);

console.log('File fixed successfully!'); 