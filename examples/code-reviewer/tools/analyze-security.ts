/**
 * Security Analysis Tool
 * 
 * Scans for security vulnerabilities including:
 * - Hardcoded secrets (API keys, passwords, tokens)
 * - Dangerous function calls (eval, Function constructor)
 * - SQL injection patterns
 * - XSS vulnerabilities
 * - Insecure configurations
 */

import type { Tool } from '../../../src/types.js';
import * as fs from 'fs';
import * as path from 'path';

interface SecurityIssue {
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  message: string;
  recommendation: string;
}

interface SecurityAnalysis {
  filesScanned: number;
  issues: SecurityIssue[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

// Security patterns to detect
const SECURITY_PATTERNS = [
  // Critical: Hardcoded secrets
  {
    pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"][^'"]{20,}['"]/gi,
    type: 'hardcoded-api-key',
    severity: 'critical' as const,
    message: 'Hardcoded API key detected',
    recommendation: 'Use environment variables or a secrets manager',
  },
  {
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{8,}['"]/gi,
    type: 'hardcoded-password',
    severity: 'critical' as const,
    message: 'Hardcoded password detected',
    recommendation: 'Use environment variables or secure storage',
  },
  {
    pattern: /(?:secret|token|auth)[_-]?(?:key)?\s*[=:]\s*['"][^'"]{16,}['"]/gi,
    type: 'hardcoded-secret',
    severity: 'critical' as const,
    message: 'Hardcoded secret/token detected',
    recommendation: 'Move to environment variables or secrets manager',
  },
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    type: 'private-key-exposed',
    severity: 'critical' as const,
    message: 'Private key exposed in code',
    recommendation: 'Remove immediately and rotate the key',
  },
  {
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    type: 'openai-api-key',
    severity: 'critical' as const,
    message: 'Possible OpenAI API key detected',
    recommendation: 'Remove and rotate the key',
  },
  {
    pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
    type: 'slack-token',
    severity: 'critical' as const,
    message: 'Possible Slack token detected',
    recommendation: 'Remove and revoke the token',
  },
  
  // High severity
  {
    pattern: /eval\s*\(\s*[^)]*\+/g,
    type: 'eval-with-user-input',
    severity: 'high' as const,
    message: 'eval() with possible dynamic input',
    recommendation: 'Avoid eval() entirely, use safer alternatives',
  },
  {
    pattern: /new\s+Function\s*\(/g,
    type: 'function-constructor',
    severity: 'high' as const,
    message: 'Dynamic code execution via Function constructor',
    recommendation: 'Avoid dynamic code generation',
  },
  {
    pattern: /innerHTML\s*=\s*[^;]*\+/g,
    type: 'xss-innerhtml',
    severity: 'high' as const,
    message: 'Possible XSS via innerHTML assignment',
    recommendation: 'Use textContent or sanitize HTML',
  },
  {
    pattern: /document\.write\s*\(/g,
    type: 'document-write',
    severity: 'high' as const,
    message: 'document.write can lead to XSS',
    recommendation: 'Use DOM manipulation methods instead',
  },
  {
    pattern: /exec\s*\(\s*[^)]*\+/g,
    type: 'command-injection',
    severity: 'high' as const,
    message: 'Possible command injection vulnerability',
    recommendation: 'Use parameterized commands or escape input',
  },
  {
    pattern: /spawn\s*\(\s*[^,]+,\s*[^)]*\+/g,
    type: 'spawn-injection',
    severity: 'high' as const,
    message: 'Possible command injection via spawn',
    recommendation: 'Validate and sanitize all inputs',
  },
  
  // Medium severity
  {
    pattern: /SELECT\s+.*\s+FROM\s+.*\+|INSERT\s+INTO\s+.*\+|UPDATE\s+.*\s+SET\s+.*\+/gi,
    type: 'sql-injection',
    severity: 'medium' as const,
    message: 'Possible SQL injection vulnerability',
    recommendation: 'Use parameterized queries or ORM',
  },
  {
    pattern: /\$\{[^}]*\}\s*\+\s*['"`]/g,
    type: 'template-injection',
    severity: 'medium' as const,
    message: 'Possible template injection',
    recommendation: 'Sanitize template variables',
  },
  {
    pattern: /http:\/\/[^'"\s]+/g,
    type: 'insecure-http',
    severity: 'medium' as const,
    message: 'HTTP URL detected (not HTTPS)',
    recommendation: 'Use HTTPS for secure communication',
  },
  {
    pattern: /disable.*ssl|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/gi,
    type: 'ssl-disabled',
    severity: 'medium' as const,
    message: 'SSL/TLS verification disabled',
    recommendation: 'Enable SSL verification in production',
  },
  {
    pattern: /cors\s*\(\s*\{\s*origin\s*:\s*['"`]\*['"`]/g,
    type: 'cors-wildcard',
    severity: 'medium' as const,
    message: 'CORS wildcard allows all origins',
    recommendation: 'Restrict to specific domains',
  },
  
  // Low severity
  {
    pattern: /TODO.*security|FIXME.*security/gi,
    type: 'security-todo',
    severity: 'low' as const,
    message: 'Security-related TODO/FIXME comment',
    recommendation: 'Address security concerns before production',
  },
  {
    pattern: /\.env\s*(?:\n|$)/g,
    type: 'env-file-reference',
    severity: 'low' as const,
    message: '.env file reference detected',
    recommendation: 'Ensure .env is in .gitignore',
  },
];

const IGNORE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /vitest\.config/,
  /jest\.config/,
  /node_modules/,
  /\.d\.ts$/,
];

function analyzeFile(filePath: string, basePath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const ext = path.extname(filePath);
  
  // Only analyze code files
  if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.env', '.env.example'].includes(ext) &&
      !filePath.endsWith('.env') && !filePath.includes('.env.')) {
    return issues;
  }
  
  // Skip test files and configs
  if (IGNORE_PATTERNS.some(p => p.test(filePath))) {
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
  
  for (const { pattern, type, severity, message, recommendation } of SECURITY_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(content)) !== null) {
      // Skip if it's in a comment
      const lineStart = content.lastIndexOf('\n', match.index) + 1;
      const lineContent = content.substring(lineStart, match.index + match[0].length);
      if (lineContent.trim().startsWith('//') || lineContent.trim().startsWith('*') || lineContent.trim().startsWith('#')) {
        continue;
      }
      
      // Skip if it's an environment variable reference
      if (match[0].includes('${') || match[0].includes('process.env')) {
        continue;
      }
      
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;
      
      // Redact sensitive values in output
      const redactedMatch = match[0].substring(0, 20) + '...';
      
      issues.push({
        file: relativePath,
        line: lineNumber,
        severity,
        type,
        message: `${message}: "${redactedMatch}"`,
        recommendation,
      });
    }
  }
  
  return issues;
}

function analyzeDirectory(dirPath: string, basePath: string, analysis: SecurityAnalysis): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    // Skip hidden directories and common ignore patterns
    if (entry.name.startsWith('.') || 
        entry.name === 'node_modules' || 
        entry.name === 'dist' || 
        entry.name === 'build' ||
        entry.name === 'coverage') {
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

export const AnalyzeSecurityTool: Tool = {
  name: 'analyze_security',
  description: `Scan project for security vulnerabilities.
Detects hardcoded secrets, injection vulnerabilities, insecure configurations, and dangerous code patterns.
Returns a detailed security report with severity ratings and recommendations.`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the project directory to scan',
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
    
    const analysis: SecurityAnalysis = {
      filesScanned: 0,
      issues: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
    };
    
    try {
      analyzeDirectory(projectPath, projectPath, analysis);
      
      // Calculate summary
      for (const issue of analysis.issues) {
        analysis.summary[issue.severity]++;
      }
      
      // Sort by severity
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      analysis.issues.sort((a, b) => {
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return a.file.localeCompare(b.file);
      });
      
      // Format output
      const lines: string[] = [
        '# Security Analysis',
        '',
        `**Path:** ${projectPath}`,
        `**Files Scanned:** ${analysis.filesScanned}`,
        '',
        '## Summary',
        '',
        `| Severity | Count |`,
        `|----------|-------|`,
        `| 🔴 Critical | ${analysis.summary.critical} |`,
        `| 🟠 High | ${analysis.summary.high} |`,
        `| 🟡 Medium | ${analysis.summary.medium} |`,
        `| 🟢 Low | ${analysis.summary.low} |`,
        '',
      ];
      
      if (analysis.issues.length === 0) {
        lines.push('**No security issues found.** 🛡️');
      } else {
        lines.push('## Issues');
        lines.push('');
        
        for (const issue of analysis.issues) {
          const icon = issue.severity === 'critical' ? '🔴' :
                       issue.severity === 'high' ? '🟠' :
                       issue.severity === 'medium' ? '🟡' : '🟢';
          
          lines.push(`### ${icon} ${issue.type.toUpperCase()}`);
          lines.push('');
          lines.push(`**File:** \`${issue.file}:${issue.line}\``);
          lines.push(`**Message:** ${issue.message}`);
          lines.push(`**Recommendation:** ${issue.recommendation}`);
          lines.push('');
        }
      }
      
      return lines.join('\n');
    } catch (err) {
      return `Error analyzing security: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
