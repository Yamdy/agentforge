/**
 * Code Reviewer Tools - Unit Tests
 * 
 * Tests the custom analysis tools directly (no LLM needed).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { AnalyzeStructureTool } from '../examples/code-reviewer/tools/analyze-structure.js';
import { AnalyzeQualityTool } from '../examples/code-reviewer/tools/analyze-quality.js';
import { AnalyzeSecurityTool } from '../examples/code-reviewer/tools/analyze-security.js';

// Create a temporary test project structure
const TEST_PROJECT_DIR = path.join(__dirname, '__test_project__');

beforeAll(() => {
  // Create test project structure
  if (!fs.existsSync(TEST_PROJECT_DIR)) {
    fs.mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  }
  
  // Create subdirectory
  const srcDir = path.join(TEST_PROJECT_DIR, 'src');
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }
  
  // Create a TypeScript file with quality issues
  fs.writeFileSync(path.join(srcDir, 'app.ts'), `
// Bad code for testing quality tools
var x: any = 1;
var y = 2;

function veryLongFunction() {
  const a = 1;
  const b = 2;
  const c = 3;
  const d = 4;
  const e = 5;
  const f = 6;
  const g = 7;
  const h = 8;
  const i = 9;
  const j = 10;
  const k = 11;
  const l = 12;
  const m = 13;
  const n = 14;
  const o = 15;
  const p = 16;
  const q = 17;
  const r = 18;
  const s = 19;
  const t = 20;
  const u = 21;
  const v = 22;
  const w = 23;
  const xx = 24;
  const yy = 25;
  const zz = 26;
  const aa = 27;
  const bb = 28;
  const cc = 29;
  const dd = 30;
  return a + b + c;
}

try {
  doSomething();
} catch (e) {}

console.log('debug');
`);

  // Create a file with security issues
  fs.writeFileSync(path.join(srcDir, 'config.ts'), `
const apiKey = "sk-1234567890abcdefghijklmnopqrstuvwxyz";
const dbPassword = "super_secret_password_123";
eval("alert(" + userInput + ")");
`);

  // Create a README
  fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'README.md'), '# Test Project');
});

describe('AnalyzeStructureTool', () => {
  it('should have correct tool metadata', () => {
    expect(AnalyzeStructureTool.name).toBe('analyze_structure');
    expect(AnalyzeStructureTool.description).toContain('project structure');
    expect(AnalyzeStructureTool.parameters).toBeDefined();
  });

  it('should analyze project structure', async () => {
    const result = await AnalyzeStructureTool.execute({ path: TEST_PROJECT_DIR });
    
    expect(result).toContain('Project Structure Analysis');
    expect(result).toContain('Total Files');
    expect(result).toContain('.ts');
  });

  it('should report error for non-existent path', async () => {
    const result = await AnalyzeStructureTool.execute({ path: '/non/existent/path' });
    expect(result).toContain('Error');
  });
});

describe('AnalyzeQualityTool', () => {
  it('should have correct tool metadata', () => {
    expect(AnalyzeQualityTool.name).toBe('analyze_quality');
    expect(AnalyzeQualityTool.description).toContain('code quality');
  });

  it('should detect quality issues', async () => {
    const result = await AnalyzeQualityTool.execute({ path: TEST_PROJECT_DIR });
    
    expect(result).toContain('Code Quality Analysis');
    expect(result).toContain('Files Scanned');
  });
});

describe('AnalyzeSecurityTool', () => {
  it('should have correct tool metadata', () => {
    expect(AnalyzeSecurityTool.name).toBe('analyze_security');
    expect(AnalyzeSecurityTool.description).toContain('security');
  });

  it('should analyze security', async () => {
    const result = await AnalyzeSecurityTool.execute({ path: TEST_PROJECT_DIR });
    
    expect(result).toContain('Security Analysis');
    expect(result).toContain('Files Scanned');
  });
});