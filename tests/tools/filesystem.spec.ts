/**
 * Filesystem Tools Tests
 *
 * Tests for the 6 filesystem tools: read_file, write_file, edit_file, ls, glob, grep
 * Security: path traversal prevention via resolveSafePath + isWithinRoot
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import {
  createFilesystemTools,
  resolveSafePath,
  isWithinRoot,
  type FilesystemToolsConfig,
} from '../../src/tools/filesystem.js';
import type { ToolDefinition } from '../../src/core/interfaces.js';

// ============================================================
// Test Helpers
// ============================================================

const TEST_ROOT = resolve(join(__dirname, '..', '..', '.tmp', 'fs-tools-test'));

async function setupTestDir(): Promise<void> {
  await mkdir(TEST_ROOT, { recursive: true });
  // Create test files
  await writeFile(join(TEST_ROOT, 'hello.txt'), 'Hello, World!\nLine 2\nLine 3\n');
  await writeFile(join(TEST_ROOT, 'data.json'), JSON.stringify({ name: 'test', value: 42 }, null, 2));
  await mkdir(join(TEST_ROOT, 'subdir'), { recursive: true });
  await writeFile(join(TEST_ROOT, 'subdir', 'nested.txt'), 'Nested file content\n');
  await writeFile(join(TEST_ROOT, 'subdir', 'info.md'), '# Info\nSome info here\n');
  await mkdir(join(TEST_ROOT, 'empty-dir'), { recursive: true });
}

async function cleanupTestDir(): Promise<void> {
  await rm(TEST_ROOT, { recursive: true, force: true });
}

function getConfig(overrides?: Partial<FilesystemToolsConfig>): FilesystemToolsConfig {
  return {
    rootDir: TEST_ROOT,
    writable: true,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    ...overrides,
  };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

// ============================================================
// Security Helpers
// ============================================================

describe('resolveSafePath', () => {
  it('should resolve relative paths against rootDir', () => {
    const result = resolveSafePath('/sandbox', 'src/index.ts');
    expect(result).toBe(resolve('/sandbox', 'src/index.ts'));
  });

  it('should resolve absolute paths as-is', () => {
    const result = resolveSafePath('/sandbox', '/etc/passwd');
    expect(result).toBe(resolve('/etc/passwd'));
  });

  it('should normalize path separators', () => {
    const result = resolveSafePath('/sandbox', 'subdir/../file.txt');
    expect(result).toBe(resolve('/sandbox/file.txt'));
  });
});

describe('isWithinRoot', () => {
  it('should return true for paths within root', () => {
    expect(isWithinRoot('/sandbox', '/sandbox/file.txt')).toBe(true);
    expect(isWithinRoot('/sandbox', '/sandbox/subdir/nested.txt')).toBe(true);
  });

  it('should return false for paths outside root', () => {
    expect(isWithinRoot('/sandbox', '/etc/passwd')).toBe(false);
    expect(isWithinRoot('/sandbox', '/sandbox/../etc/passwd')).toBe(false);
  });

  it('should handle normalized traversal paths', () => {
    // resolve normalizes /sandbox/../etc/passwd to /etc/passwd
    expect(isWithinRoot('/sandbox', resolve('/sandbox/../etc/passwd'))).toBe(false);
  });
});

// ============================================================
// read_file Tool
// ============================================================

describe('read_file tool', () => {
  let tools: ToolDefinition[];
  let readFileTool: ToolDefinition;

  beforeEach(async () => {
    await setupTestDir();
    tools = createFilesystemTools(getConfig());
    readFileTool = getTool(tools, 'read_file');
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should read a file and return contents with line numbers', async () => {
    const result = await readFileTool.execute({ path: 'hello.txt' });
    expect(result).toContain('1:');
    expect(result).toContain('Hello, World!');
  });

  it('should read a file from a subdirectory', async () => {
    const result = await readFileTool.execute({ path: 'subdir/nested.txt' });
    expect(result).toContain('Nested file content');
  });

  it('should reject path traversal attempts', async () => {
    const result = await readFileTool.execute({ path: '../../../etc/passwd' });
    expect(result).toContain('Error');
    expect(result).toMatch(/denied|outside|traversal|forbidden/i);
  });

  it('should reject absolute paths outside root', async () => {
    const result = await readFileTool.execute({ path: '/etc/passwd' });
    expect(result).toContain('Error');
    expect(result).toMatch(/denied|outside|forbidden/i);
  });

  it('should return error for non-existent files', async () => {
    const result = await readFileTool.execute({ path: 'nonexistent.txt' });
    expect(result).toContain('Error');
  });

  it('should support offset and limit parameters', async () => {
    const result = await readFileTool.execute({ path: 'hello.txt', offset: 2, limit: 1 });
    expect(result).toContain('Line 2');
    expect(result).not.toContain('Hello, World!');
  });
});

// ============================================================
// write_file Tool
// ============================================================

describe('write_file tool', () => {
  let tools: ToolDefinition[];
  let writeFileTool: ToolDefinition;

  beforeEach(async () => {
    await setupTestDir();
    tools = createFilesystemTools(getConfig());
    writeFileTool = getTool(tools, 'write_file');
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should write content to a new file', async () => {
    const result = await writeFileTool.execute({
      path: 'new-file.txt',
      content: 'New file content',
    });
    expect(result).toMatch(/success|wrote|created/i);

    // Verify file was actually written
    const content = await readFile(join(TEST_ROOT, 'new-file.txt'), 'utf-8');
    expect(content).toBe('New file content');
  });

  it('should overwrite an existing file', async () => {
    const result = await writeFileTool.execute({
      path: 'hello.txt',
      content: 'Overwritten content',
    });
    expect(result).toMatch(/success|wrote/i);

    const content = await readFile(join(TEST_ROOT, 'hello.txt'), 'utf-8');
    expect(content).toBe('Overwritten content');
  });

  it('should create parent directories if needed', async () => {
    const result = await writeFileTool.execute({
      path: 'deep/nested/dir/file.txt',
      content: 'Deep nested file',
    });
    expect(result).toMatch(/success|wrote|created/i);

    const content = await readFile(join(TEST_ROOT, 'deep', 'nested', 'dir', 'file.txt'), 'utf-8');
    expect(content).toBe('Deep nested file');
  });

  it('should reject path traversal attempts', async () => {
    const result = await writeFileTool.execute({
      path: '../../../tmp/evil.txt',
      content: 'evil',
    });
    expect(result).toContain('Error');
    expect(result).toMatch(/denied|outside|traversal|forbidden/i);
  });

  it('should reject writes when writable=false', async () => {
    const readOnlyTools = createFilesystemTools(getConfig({ writable: false }));
    const readOnlyWriteTool = getTool(readOnlyTools, 'write_file');

    const result = await readOnlyWriteTool.execute({
      path: 'new-file.txt',
      content: 'Should fail',
    });
    expect(result).toContain('Error');
    expect(result).toMatch(/read.only|not.allowed|writable/i);
  });

  it('should reject files exceeding maxFileSize', async () => {
    const smallLimitTools = createFilesystemTools(getConfig({ maxFileSize: 10 }));
    const smallLimitWriteTool = getTool(smallLimitTools, 'write_file');

    const result = await smallLimitWriteTool.execute({
      path: 'big-file.txt',
      content: 'A'.repeat(100),
    });
    expect(result).toContain('Error');
    expect(result).toMatch(/too.large|size|exceeds/i);
  });
});

// ============================================================
// edit_file Tool
// ============================================================

describe('edit_file tool', () => {
  let tools: ToolDefinition[];
  let editFileTool: ToolDefinition;

  beforeEach(async () => {
    await setupTestDir();
    tools = createFilesystemTools(getConfig());
    editFileTool = getTool(tools, 'edit_file');
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should replace text in a file', async () => {
    const result = await editFileTool.execute({
      path: 'hello.txt',
      search: 'Hello, World!',
      replace: 'Hi, Earth!',
    });
    expect(result).toMatch(/success|replaced/i);

    const content = await readFile(join(TEST_ROOT, 'hello.txt'), 'utf-8');
    expect(content).toContain('Hi, Earth!');
    expect(content).not.toContain('Hello, World!');
  });

  it('should return error when search text not found', async () => {
    const result = await editFileTool.execute({
      path: 'hello.txt',
      search: 'nonexistent text',
      replace: 'replacement',
    });
    expect(result).toContain('Error');
    expect(result).toMatch(/not.found|no.match/i);
  });

  it('should reject path traversal attempts', async () => {
    const result = await editFileTool.execute({
      path: '../../../etc/hosts',
      search: 'localhost',
      replace: 'evilhost',
    });
    expect(result).toContain('Error');
    expect(result).toMatch(/denied|outside|traversal|forbidden/i);
  });

  it('should reject edits when writable=false', async () => {
    const readOnlyTools = createFilesystemTools(getConfig({ writable: false }));
    const readOnlyEditTool = getTool(readOnlyTools, 'edit_file');

    const result = await readOnlyEditTool.execute({
      path: 'hello.txt',
      search: 'Hello',
      replace: 'Hi',
    });
    expect(result).toContain('Error');
    expect(result).toMatch(/read.only|not.allowed|writable/i);
  });

  it('should replace all occurrences when replaceAll is true', async () => {
    await writeFile(join(TEST_ROOT, 'multi.txt'), 'aaa bbb aaa ccc aaa\n');
    const result = await editFileTool.execute({
      path: 'multi.txt',
      search: 'aaa',
      replace: 'xxx',
      replaceAll: true,
    });
    expect(result).toMatch(/success|replaced/i);

    const content = await readFile(join(TEST_ROOT, 'multi.txt'), 'utf-8');
    expect(content).toBe('xxx bbb xxx ccc xxx\n');
  });
});

// ============================================================
// ls Tool
// ============================================================

describe('ls tool', () => {
  let tools: ToolDefinition[];
  let lsTool: ToolDefinition;

  beforeEach(async () => {
    await setupTestDir();
    tools = createFilesystemTools(getConfig());
    lsTool = getTool(tools, 'ls');
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should list directory contents', async () => {
    const result = await lsTool.execute({ path: '.' });
    expect(result).toContain('hello.txt');
    expect(result).toContain('data.json');
    expect(result).toContain('subdir');
  });

  it('should list subdirectory contents', async () => {
    const result = await lsTool.execute({ path: 'subdir' });
    expect(result).toContain('nested.txt');
    expect(result).toContain('info.md');
  });

  it('should reject path traversal attempts', async () => {
    const result = await lsTool.execute({ path: '../../..' });
    expect(result).toContain('Error');
    expect(result).toMatch(/denied|outside|traversal|forbidden/i);
  });

  it('should return error for non-existent directory', async () => {
    const result = await lsTool.execute({ path: 'nonexistent-dir' });
    expect(result).toContain('Error');
  });

  it('should distinguish files and directories', async () => {
    const result = await lsTool.execute({ path: '.' });
    // Directories should be marked (e.g., with trailing / or [DIR])
    expect(result).toMatch(/subdir[\/\\]|\[DIR\]|subdir.*dir/i);
  });
});

// ============================================================
// glob Tool
// ============================================================

describe('glob tool', () => {
  let tools: ToolDefinition[];
  let globTool: ToolDefinition;

  beforeEach(async () => {
    await setupTestDir();
    tools = createFilesystemTools(getConfig());
    globTool = getTool(tools, 'glob');
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should find files matching a pattern', async () => {
    const result = await globTool.execute({ pattern: '**/*.txt' });
    expect(result).toContain('hello.txt');
    expect(result).toContain('nested.txt');
  });

  it('should find files with specific extension', async () => {
    const result = await globTool.execute({ pattern: '**/*.json' });
    expect(result).toContain('data.json');
    expect(result).not.toContain('hello.txt');
  });

  it('should respect exclude patterns', async () => {
    const result = await globTool.execute({
      pattern: '**/*',
      excludePatterns: ['**/*.json'],
    });
    expect(result).not.toContain('data.json');
  });

  it('should reject path traversal in pattern', async () => {
    const result = await globTool.execute({ pattern: '../../../etc/**/*.conf' });
    expect(result).toContain('Error');
    expect(result).toMatch(/denied|outside|traversal|forbidden/i);
  });
});

// ============================================================
// grep Tool
// ============================================================

describe('grep tool', () => {
  let tools: ToolDefinition[];
  let grepTool: ToolDefinition;

  beforeEach(async () => {
    await setupTestDir();
    tools = createFilesystemTools(getConfig());
    grepTool = getTool(tools, 'grep');
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should find matching lines in files', async () => {
    const result = await grepTool.execute({
      pattern: 'Hello',
      path: '.',
    });
    expect(result).toContain('Hello, World!');
  });

  it('should search in subdirectories recursively', async () => {
    const result = await grepTool.execute({
      pattern: 'Nested',
      path: '.',
    });
    expect(result).toContain('Nested file content');
  });

  it('should support regex patterns', async () => {
    const result = await grepTool.execute({
      pattern: 'Line \\d+',
      path: '.',
    });
    expect(result).toContain('Line 2');
    expect(result).toContain('Line 3');
  });

  it('should reject path traversal attempts', async () => {
    const result = await grepTool.execute({
      pattern: 'root',
      path: '../../..',
    });
    expect(result).toContain('Error');
    expect(result).toMatch(/denied|outside|traversal|forbidden/i);
  });

  it('should return appropriate message when no matches found', async () => {
    const result = await grepTool.execute({
      pattern: 'zzzzz_nonexistent_pattern',
      path: '.',
    });
    expect(result).toMatch(/no.match|not.found|0.match/i);
  });

  it('should support file pattern filtering', async () => {
    const result = await grepTool.execute({
      pattern: 'content',
      path: '.',
      includePatterns: ['*.txt'],
    });
    expect(result).toContain('nested.txt');
    expect(result).not.toContain('info.md');
  });
});

// ============================================================
// createFilesystemTools
// ============================================================

describe('createFilesystemTools', () => {
  it('should return all 6 tools', () => {
    const tools = createFilesystemTools(getConfig());
    expect(tools).toHaveLength(6);

    const names = tools.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('ls');
    expect(names).toContain('glob');
    expect(names).toContain('grep');
  });

  it('should have Zod schemas for parameters', () => {
    const tools = createFilesystemTools(getConfig());
    for (const tool of tools) {
      expect(tool.parameters).toBeDefined();
      // Zod schemas have parse method
      expect(typeof (tool.parameters as { parse?: unknown }).parse).toBe('function');
    }
  });

  it('should have descriptions for each tool', () => {
    const tools = createFilesystemTools(getConfig());
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('should default writable to true', () => {
    const config: FilesystemToolsConfig = { rootDir: TEST_ROOT };
    const tools = createFilesystemTools(config);
    // write_file should work with default writable=true
    expect(tools.find((t) => t.name === 'write_file')).toBeDefined();
  });
});