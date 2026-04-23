import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  truncate,
  truncateAndSave,
  truncateIfNeeded,
  truncateIfNeededAsync,
  type TruncateOptions,
  type TruncateResult,
} from '../../src/truncate/index.js';
import { saveTruncatedOutput, DEFAULT_TRUNCATE_DIR } from '../../src/truncate/storage.js';
import { cleanupOldFiles, DEFAULT_MAX_AGE_DAYS } from '../../src/truncate/cleanup.js';

describe('Truncate System', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentforge-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('truncate()', () => {
    it('should not truncate short content', () => {
      const content = 'Hello World\nThis is a test';
      const result = truncate(content);

      expect(result.truncated).toBe(false);
      expect(result.output).toBe(content);
      expect(result.originalLines).toBe(2);
      expect(result.originalBytes).toBe(Buffer.byteLength(content, 'utf-8'));
    });

    it('should not truncate content within limits', () => {
      const lines = Array(1000).fill('test line');
      const content = lines.join('\n');
      const result = truncate(content);

      expect(result.truncated).toBe(false);
      expect(result.output).toBe(content);
    });

    it('should truncate by lines when exceeding maxLines', () => {
      const lines = Array(3000).fill('test line');
      const content = lines.join('\n');
      const result = truncate(content, { maxLines: 2000 });

      expect(result.truncated).toBe(true);
      expect(result.resultLines).toBeLessThanOrEqual(2000);
      expect(result.resultLines).toBeLessThan(result.originalLines);
      expect(result.output).toContain('截断');
      expect(result.originalLines).toBe(3000);
    });

    it('should truncate by bytes when exceeding maxBytes', () => {
      // Create content that's within line limit but exceeds byte limit
      const lines = Array(100).fill('x'.repeat(600)); // Each line ~600 bytes, total ~60KB
      const content = lines.join('\n');
      const result = truncate(content, { maxBytes: 50000 });

      expect(result.truncated).toBe(true);
      expect(result.resultBytes).toBeLessThanOrEqual(50000);
      expect(result.output).toContain('截断');
    });

    it('should support tail direction (keep end)', () => {
      const lines = Array(3000).fill('').map((_, i) => `Line ${i}`);
      const content = lines.join('\n');
      const result = truncate(content, { maxLines: 100, direction: 'tail' });

      expect(result.truncated).toBe(true);
      // Should keep the last lines
      expect(result.output).toContain('Line 2999');
      expect(result.output).not.toContain('Line 0');
    });

    it('should support head direction (keep beginning)', () => {
      const lines = Array(3000).fill('').map((_, i) => `Line ${i}`);
      const content = lines.join('\n');
      const result = truncate(content, { maxLines: 100, direction: 'head' });

      expect(result.truncated).toBe(true);
      // Should keep the first lines
      expect(result.output).toContain('Line 0');
      expect(result.output).not.toContain('Line 2999');
    });

    it('should add truncation notice at the end', () => {
      const lines = Array(3000).fill('test');
      const content = lines.join('\n');
      const result = truncate(content, { maxLines: 100 });

      expect(result.output).toMatch(/截断.*行/);
    });

    it('should handle empty content', () => {
      const result = truncate('');

      expect(result.truncated).toBe(false);
      expect(result.output).toBe('');
      expect(result.originalLines).toBe(1); // Empty string splits to one empty line
      expect(result.originalBytes).toBe(0);
    });

    it('should handle single line content', () => {
      const content = 'single line content';
      const result = truncate(content);

      expect(result.truncated).toBe(false);
      expect(result.output).toBe(content);
    });
  });

  describe('truncateAndSave()', () => {
    it('should not write file when content is not truncated', async () => {
      const content = 'short content';
      const result = await truncateAndSave(content, { tempDir: testDir });

      expect(result.truncated).toBe(false);
      expect(result.outputPath).toBeUndefined();
    });

    it('should save full content to temp file when truncated', async () => {
      const lines = Array(3000).fill('test line');
      const content = lines.join('\n');
      const result = await truncateAndSave(content, {
        maxLines: 100,
        tempDir: testDir,
        prefix: 'test-prefix',
      });

      expect(result.truncated).toBe(true);
      expect(result.outputPath).toBeDefined();
      expect(result.outputPath).toContain('test-prefix');

      // Verify the file contains the full content
      const savedContent = await readFile(result.outputPath!, 'utf-8');
      expect(savedContent).toBe(content);
    });

    it('should create unique file names with prefix and timestamp', async () => {
      const lines = Array(3000).fill('test');
      const content = lines.join('\n');

      const result1 = await truncateAndSave(content, {
        maxLines: 100,
        tempDir: testDir,
        prefix: 'mytool',
      });

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result2 = await truncateAndSave(content, {
        maxLines: 100,
        tempDir: testDir,
        prefix: 'mytool',
      });

      expect(result1.outputPath).toBeDefined();
      expect(result2.outputPath).toBeDefined();
      expect(result1.outputPath).not.toBe(result2.outputPath);
    });
  });

  describe('truncateIfNeeded() alias', () => {
    it('should be an alias for truncate()', () => {
      const content = 'test content';
      expect(truncateIfNeeded(content)).toEqual(truncate(content));
    });
  });

  describe('truncateIfNeededAsync() alias', () => {
    it('should be an alias for truncateAndSave()', async () => {
      const lines = Array(3000).fill('test');
      const content = lines.join('\n');
      const options: TruncateOptions = { maxLines: 100, tempDir: testDir };

      const result1 = await truncateIfNeededAsync(content, options);
      const result2 = await truncateAndSave(content, options);

      expect(result1.truncated).toBe(result2.truncated);
    });
  });

  describe('saveTruncatedOutput()', () => {
    it('should save content to specified file', async () => {
      const content = 'test output content';
      const fileName = 'test-file.txt';

      const filePath = await saveTruncatedOutput(content, testDir, fileName);

      expect(filePath).toBe(join(testDir, fileName));
      expect(existsSync(filePath)).toBe(true);

      const savedContent = await readFile(filePath, 'utf-8');
      expect(savedContent).toBe(content);
    });

    it('should create directory if it does not exist', async () => {
      const newDir = join(testDir, 'subdir', 'nested');
      const content = 'test';
      const fileName = 'test.txt';

      const filePath = await saveTruncatedOutput(content, newDir, fileName);

      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('cleanupOldFiles()', () => {
    it('should return 0 when directory does not exist', async () => {
      const nonExistentDir = join(tmpdir(), `nonexistent-${Date.now()}`);
      const deleted = await cleanupOldFiles(DEFAULT_MAX_AGE_DAYS, nonExistentDir);

      expect(deleted).toBe(0);
    });

    it('should delete files older than maxAgeDays', async () => {
      // Create a file and manually set its mtime to 8 days ago
      const oldFile = join(testDir, 'old-file.txt');
      await saveTruncatedOutput('old content', testDir, 'old-file.txt');

      // Set mtime to 8 days ago
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const { utimes } = await import('node:fs/promises');
      await utimes(oldFile, new Date(eightDaysAgo), new Date(eightDaysAgo));

      // Create a recent file
      const recentFile = join(testDir, 'recent-file.txt');
      await saveTruncatedOutput('recent content', testDir, 'recent-file.txt');

      const deleted = await cleanupOldFiles(7, testDir);

      expect(deleted).toBe(1);
      expect(existsSync(oldFile)).toBe(false);
      expect(existsSync(recentFile)).toBe(true);
    });

    it('should not delete recent files', async () => {
      const recentFile = join(testDir, 'recent-file.txt');
      await saveTruncatedOutput('recent content', testDir, 'recent-file.txt');

      const deleted = await cleanupOldFiles(7, testDir);

      expect(deleted).toBe(0);
      expect(existsSync(recentFile)).toBe(true);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle unicode content correctly', () => {
      const content = '你好世界\n'.repeat(3000);
      const result = truncate(content, { maxLines: 100 });

      expect(result.truncated).toBe(true);
      expect(result.output).toContain('截断');
      // Verify byte counting works for unicode
      expect(result.originalBytes).toBeGreaterThan(result.resultBytes);
    });

    it('should handle mixed line endings', () => {
      const content = Array(1000).fill('line').join('\r\n');
      // Note: split('\n') treats \r\n as two characters: \r stays on line, \n is separator
      // So 1000 "line" strings joined by \r\n gives 1000 elements after split('\n')
      // With default maxLines=2000, this should NOT be truncated
      const result = truncate(content);

      expect(result.truncated).toBe(false);
      expect(result.output).toBe(content);
    });

    it('should handle very long single lines', () => {
      const content = 'x'.repeat(100000);
      const result = truncate(content, { maxBytes: 50000 });

      expect(result.truncated).toBe(true);
      expect(result.resultBytes).toBeLessThanOrEqual(50000);
    });
  });
});
