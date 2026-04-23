/**
 * Code Quality Analysis Tool
 * 
 * Analyzes code quality including:
 * - Complexity metrics (cyclomatic complexity hints)
 * - Code smells (long functions, deep nesting)
 * - TypeScript anti-patterns (any types, empty catches)
 * - Best practices violations
 */

import type { LegacyTool as Tool } from '../../../src/types.js';
import * as fs from 'fs';
import * as path from 'path';

interface QualityIssue {
  file: string;
  line: number;
  severity: 'critical' | 'warning' | 'info';
  type: string;
  message: string;
}

interface QualityAnalysis {
  filesScanned: number;
  issues: QualityIssue[];
  summary: {
    critical: number;
    warning: number;
    info: number;
  };
}

// Patterns to detect code quality issues
const QUALITY_PATTERNS = [
  // Critical issues
  { 
    pattern: /:\s*any\b/g, 
    type: 'any-type', 
    severity: 'warning' as const,
    message: 'Usage of "any" type reduces type safety' 
  },
  { 
    pattern: /@ts-ignore/g, 
    type: 'ts-ignore', 
    severity: 'warning' as const,
    message: '@ts-ignore suppresses TypeScript errors - fix the underlying issue' 
  },
  { 
    pattern: /@ts-expect-error/g, 
    type: 'ts-expect-error', 
    severity: 'info' as const,
    message: '@ts-expect-error used - ensure this is intentional' 
  },
  { 
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g, 
    type: 'empty-catch', 
    severity: 'critical' as const,
    message: 'Empty catch block silently swallows errors' 
  },
  { 
    pattern: /console\.log\(/g, 
    type: 'console-log', 
    severity: 'info' as const,
    message: 'console.log found - remove before production' 
  },
  { 
    pattern: /debugger;?/g, 
    type: 'debugger', 
    severity: 'warning' as const,
    message: 'debugger statement found - remove before production' 
  },
  { 
    pattern: /eval\s*\(/g, 
    type: 'eval-usage', 
    severity: 'critical' as const,
    message: 'eval() is dangerous and should be avoided' 
  },
  { 
    pattern: /var\s+\w+/g, 
    type: 'var-usage', 
    severity: 'warning' as const,
    message: 'Use "const" or "let" instead of "var"' 
  },
  { 
    pattern: /==\s*[^=]/g, 
    type: 'loose-equality', 
    severity: 'warning' as const,
    message: 'Use === for strict equality comparison' 
  },
  { 
    pattern: /!=\s*[^=]/g, 
    type: 'loose-inequality', 
    severity: 'warning' as const,
    message: 'Use !== for strict inequality comparison' 
  },
];

function analyzeFile(filePath: string, basePath: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const ext = path.extname(filePath);
  
  // Only analyze TypeScript/JavaScript files
  if (!['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
    return issues;
  }
  
  // Skip test files and config
  if (filePath.includes('.test.') || 
      filePath.includes('.spec.') || 
      filePath.includes('vitest.config') ||
      filePath.includes('jest.config')) {
    return issues;
  }
  
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return issues;
  }
  
  const lines = content.split('\n');
  const relativePath = path.relative(basePath, filePath);
  
  for (const { pattern, type, severity, message } of QUALITY_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(content)) !== null) {
      // Find line number
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;
      
      issues.push({
        file: relativePath,
        line: lineNumber,
        severity,
        type,
        message,
      });
    }
  }
  
  // Check for long functions (simple heuristic)
  const functionMatches = content.matchAll(/(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>|async\s+function\s+\w+)\s*\([^)]*\)\s*\{/g);
  for (const match of Array.from(functionMatches)) {
    const startLine = content.substring(0, match.index).split('\n').length;
    // Find matching closing brace (simplified)
    let braceCount = 1;
    let endPos = match.index + match[0].length;
    while (braceCount > 0 && endPos < content.length) {
      if (content[endPos] === '{') braceCount++;
      if (content[endPos] === '}') braceCount--;
      endPos++;
    }
    const functionLength = content.substring(match.index, endPos).split('\n').length;
    
    if (functionLength > 50) {
      issues.push({
        file: relativePath,
        line: startLine,
        severity: 'warning',
        type: 'long-function',
        message: `Function is ${functionLength} lines long. Consider breaking it into smaller functions.`,
      });
    }
  }
  
  // Check for deep nesting (simplified)
  const nestingMatches = content.matchAll(/^(\s{20,})[^\s]/gm);
  for (const match of Array.from(nestingMatches)) {
    const lineNumber = content.substring(0, match.index).split('\n').length;
    const indent = match[1].length;
    const nestingLevel = Math.floor(indent / 2);
    
    if (nestingLevel > 4) {
      issues.push({
        file: relativePath,
        line: lineNumber,
        severity: 'warning',
        type: 'deep-nesting',
        message: `Deep nesting detected (${nestingLevel} levels). Consider extracting logic.`,
      });
    }
  }
  
  return issues;
}

function analyzeDirectory(dirPath: string, basePath: string, analysis: QualityAnalysis): void {
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
      analyzeDirectory(fullPath, basePath, analysis);
    } else if (entry.isFile()) {
      const issues = analyzeFile(fullPath, basePath);
      if (issues.length > 0) {
        analysis.issues.push(...issues);
      }
      analysis.filesScanned++;
    }
  }
}

export const AnalyzeQualityTool: Tool = {
  name: 'analyze_quality',
  description: `Analyze code quality in a project.
Scans TypeScript/JavaScript files for code smells, anti-patterns, and best practices violations.
Returns a detailed report with file locations and severity ratings.`,
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
    
    const analysis: QualityAnalysis = {
      filesScanned: 0,
      issues: [],
      summary: { critical: 0, warning: 0, info: 0 },
    };
    
    try {
      analyzeDirectory(projectPath, projectPath, analysis);
      
      // Calculate summary
      for (const issue of analysis.issues) {
        analysis.summary[issue.severity]++;
      }
      
      // Sort by severity then file
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      analysis.issues.sort((a, b) => {
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return a.file.localeCompare(b.file);
      });
      
      // Format output
      const lines: string[] = [
        '# Code Quality Analysis',
        '',
        `**Path:** ${projectPath}`,
        `**Files Scanned:** ${analysis.filesScanned}`,
        '',
        '## Summary',
        '',
        `| Severity | Count |`,
        `|----------|-------|`,
        `| 🔴 Critical | ${analysis.summary.critical} |`,
        `| 🟡 Warning | ${analysis.summary.warning} |`,
        `| 🟢 Info | ${analysis.summary.info} |`,
        '',
        '## Issues',
        '',
      ];
      
      if (analysis.issues.length === 0) {
        lines.push('No issues found. Great job! 🎉');
      } else {
        // Group by file for readability
        const byFile = new Map<string, QualityIssue[]>();
        for (const issue of analysis.issues) {
          const existing = byFile.get(issue.file) || [];
          existing.push(issue);
          byFile.set(issue.file, existing);
        }
        
        for (const file of Array.from(byFile.keys())) {
          const fileIssues = byFile.get(file)!;
          lines.push(`### ${file}`);
          lines.push('');
          for (const issue of fileIssues) {
            const icon = issue.severity === 'critical' ? '🔴' : 
                         issue.severity === 'warning' ? '🟡' : '🟢';
            lines.push(`- ${icon} **Line ${issue.line}** [${issue.type}]: ${issue.message}`);
          }
          lines.push('');
        }
      }
      
      return lines.join('\n');
    } catch (err) {
      return `Error analyzing quality: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
