/**
 * Project Structure Analysis Tool
 * 
 * Analyzes project structure including:
 * - File type distribution
 * - Directory depth
 * - Module organization
 * - Dependency structure
 */

import type { Tool } from '../../../src/types.js';
import * as fs from 'fs';
import * as path from 'path';

interface StructureAnalysis {
  totalFiles: number;
  totalDirectories: number;
  maxDepth: number;
  fileTypes: Record<string, number>;
  largestDirectories: Array<{ path: string; fileCount: number }>;
  suggestions: string[];
}

function analyzeDirectory(
  dirPath: string,
  basePath: string,
  depth: number,
  result: StructureAnalysis
): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    // Skip hidden directories and common ignore patterns
    if (entry.name.startsWith('.') || 
        entry.name === 'node_modules' || 
        entry.name === 'dist' || 
        entry.name === 'build') {
      continue;
    }
    
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory()) {
      result.totalDirectories++;
      result.maxDepth = Math.max(result.maxDepth, depth + 1);
      analyzeDirectory(fullPath, basePath, depth + 1, result);
    } else if (entry.isFile()) {
      result.totalFiles++;
      const ext = path.extname(entry.name).toLowerCase() || 'no-extension';
      result.fileTypes[ext] = (result.fileTypes[ext] || 0) + 1;
    }
  }
}

function generateSuggestions(analysis: StructureAnalysis): string[] {
  const suggestions: string[] = [];
  
  // Check directory depth
  if (analysis.maxDepth > 6) {
    suggestions.push(`🟡 Directory nesting is too deep (${analysis.maxDepth} levels). Consider flattening the structure.`);
  }
  
  // Check TypeScript/JavaScript ratio
  const tsCount = analysis.fileTypes['.ts'] || 0;
  const jsCount = analysis.fileTypes['.js'] || 0;
  if (jsCount > tsCount && jsCount > 10) {
    suggestions.push('🟡 More .js files than .ts files. Consider migrating to TypeScript for better type safety.');
  }
  
  // Check for missing common files
  if (!analysis.fileTypes['.md'] || analysis.fileTypes['.md'] < 1) {
    suggestions.push('🟢 No README or documentation files found. Consider adding project documentation.');
  }
  
  // Check test coverage hint
  const testFiles = (analysis.fileTypes['.test.ts'] || 0) + 
                    (analysis.fileTypes['.spec.ts'] || 0) + 
                    (analysis.fileTypes['.test.js'] || 0);
  if (testFiles === 0 && (tsCount + jsCount) > 10) {
    suggestions.push('🟡 No test files found. Consider adding unit tests for better code quality.');
  }
  
  // Check for configuration files
  if (!analysis.fileTypes['.json'] && !analysis.fileTypes['.yaml'] && !analysis.fileTypes['.yml']) {
    suggestions.push('🟢 No configuration files found. Make sure project settings are properly defined.');
  }
  
  return suggestions;
}

export const AnalyzeStructureTool: Tool = {
  name: 'analyze_structure',
  description: `Analyze project structure and organization.
Returns statistics about file types, directory depth, and suggestions for improvement.
Input should be the absolute path to the project root directory.`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the project directory to analyze',
      },
    },
    required: ['path'],
  },
  execute: async (args) => {
    const projectPath = args.path as string;
    
    if (!projectPath) {
      return 'Error: No project path provided';
    }
    
    if (!fs.existsSync(projectPath)) {
      return `Error: Directory does not exist: ${projectPath}`;
    }
    
    if (!fs.statSync(projectPath).isDirectory()) {
      return `Error: Path is not a directory: ${projectPath}`;
    }
    
    const analysis: StructureAnalysis = {
      totalFiles: 0,
      totalDirectories: 0,
      maxDepth: 0,
      fileTypes: {},
      largestDirectories: [],
      suggestions: [],
    };
    
    try {
      analyzeDirectory(projectPath, projectPath, 0, analysis);
      analysis.suggestions = generateSuggestions(analysis);
      
      // Format output
      const lines: string[] = [
        '# Project Structure Analysis',
        '',
        `**Path:** ${projectPath}`,
        '',
        '## Overview',
        '',
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Total Files | ${analysis.totalFiles} |`,
        `| Total Directories | ${analysis.totalDirectories} |`,
        `| Max Depth | ${analysis.maxDepth} levels |`,
        '',
        '## File Type Distribution',
        '',
        '| Extension | Count | Percentage |',
        '|-----------|-------|------------|',
      ];
      
      const sortedTypes = Object.entries(analysis.fileTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
      
      for (const [ext, count] of sortedTypes) {
        const percentage = ((count / analysis.totalFiles) * 100).toFixed(1);
        lines.push(`| ${ext} | ${count} | ${percentage}% |`);
      }
      
      if (analysis.suggestions.length > 0) {
        lines.push('', '## Suggestions', '');
        for (const suggestion of analysis.suggestions) {
          lines.push(`- ${suggestion}`);
        }
      }
      
      return lines.join('\n');
    } catch (err) {
      return `Error analyzing structure: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
