// ========== Truncate Output System ==========

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { saveTruncatedOutput, DEFAULT_TRUNCATE_DIR } from './storage.js';

// ========== Types ==========

/**
 * Options for the truncate function.
 */
export interface TruncateOptions {
  /** Maximum number of lines to keep (default: 2000) */
  maxLines?: number;
  /** Maximum output size in bytes (default: 50000) */
  maxBytes?: number;
  /** Which end to keep: 'head' keeps the beginning, 'tail' keeps the end (default: 'head') */
  direction?: 'head' | 'tail';
  /** Custom temp directory for storing full output files */
  tempDir?: string;
  /** File name prefix for the saved full output */
  prefix?: string;
}

/**
 * Result of the truncate operation.
 */
export interface TruncateResult {
  /** The (possibly truncated) output */
  output: string;
  /** Whether the output was truncated */
  truncated: boolean;
  /** Path to the file containing the full output (only set if truncated) */
  outputPath?: string;
  /** Original line count */
  originalLines: number;
  /** Original byte size */
  originalBytes: number;
  /** Resulting line count (after truncation) */
  resultLines: number;
  /** Resulting byte size (after truncation) */
  resultBytes: number;
}

// ========== Default Configuration ==========

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50000;
const DEFAULT_DIRECTION = 'head';

// ========== Internal Helpers ==========

/**
 * Find the maximum number of characters that fit within a byte budget.
 *
 * Since UTF-8 characters can be 1-4 bytes, we can't simply slice at
 * maxBytes. This function walks backward from the byte limit to find
 * a safe character boundary.
 */
function findCharBudget(content: string, byteBudget: number): number {
  // Fast path for ASCII-only content
  if (Buffer.byteLength(content, 'utf-8') === content.length) {
    return Math.max(0, byteBudget);
  }

  // Binary search for the right character count
  let lo = 0;
  let hi = content.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(content.slice(0, mid), 'utf-8') <= byteBudget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(0, lo);
}

// ========== Core Truncate Logic ==========

/**
 * Truncate content if it exceeds line or byte limits.
 *
 * This is a synchronous function that only performs truncation.
 * To also save the full content to a temp file, use `truncateAndSave`.
 *
 * @param content - The output content to potentially truncate
 * @param options - Truncation options
 * @returns TruncateResult with truncated output and metadata
 */
export function truncate(content: string, options: TruncateOptions = {}): TruncateResult {
  const { maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES, direction = DEFAULT_DIRECTION } = options;

  const lines = content.split('\n');
  const originalLines = lines.length;
  const originalBytes = Buffer.byteLength(content, 'utf-8');

  // No truncation needed
  if (originalLines <= maxLines && originalBytes <= maxBytes) {
    return {
      output: content,
      truncated: false,
      originalLines,
      originalBytes,
      resultLines: originalLines,
      resultBytes: originalBytes,
    };
  }

  // Apply line limit
  let resultLines: string[];
  let removedCount: number;

  if (originalLines > maxLines) {
    if (direction === 'head') {
      resultLines = lines.slice(0, maxLines);
    } else {
      resultLines = lines.slice(-maxLines);
    }
    removedCount = originalLines - maxLines;
  } else {
    resultLines = [...lines];
    removedCount = 0;
  }

  // Apply byte limit — remove lines until within budget
  let result = resultLines.join('\n');
  while (Buffer.byteLength(result, 'utf-8') > maxBytes && resultLines.length > 1) {
    if (direction === 'head') {
      resultLines.pop();
    } else {
      resultLines.shift();
    }
    result = resultLines.join('\n');
    removedCount++;
  }

  // Character-level truncation for single very long line
  if (Buffer.byteLength(result, 'utf-8') > maxBytes && resultLines.length === 1) {
    // Reserve space for notice; binary-search for safe slice point
    const notice = `\n\n... [截断内容，完整输出见文件]`;
    const noticeBytes = Buffer.byteLength(notice, 'utf-8');
    const charBudget = findCharBudget(result, maxBytes - noticeBytes);

    if (direction === 'head') {
      result = result.slice(0, charBudget);
    } else {
      result = result.slice(result.length - charBudget);
    }
    result += notice;

    return {
      output: result,
      truncated: true,
      originalLines,
      originalBytes,
      resultLines: 1,
      resultBytes: Buffer.byteLength(result, 'utf-8'),
    };
  }

  // Append truncation notice
  const notice = `\n\n... [截断 ${removedCount} 行，完整输出见文件]`;
  const noticeBytes = Buffer.byteLength(notice, 'utf-8');
  const budget = maxBytes - noticeBytes;

  // Ensure result fits within byte budget including notice
  while (Buffer.byteLength(result, 'utf-8') > budget && resultLines.length > 1) {
    if (direction === 'head') {
      resultLines.pop();
    } else {
      resultLines.shift();
    }
    result = resultLines.join('\n');
  }

  result += notice;

  return {
    output: result,
    truncated: true,
    originalLines,
    originalBytes,
    resultLines: resultLines.length,
    resultBytes: Buffer.byteLength(result, 'utf-8'),
  };
}

/**
 * Truncate content and save the full output to a temp file.
 *
 * If the content does not exceed limits, no file is written.
 * If truncated, the full content is saved to a temp file and
 * the path is returned in `outputPath`.
 *
 * @param content - The output content to potentially truncate
 * @param options - Truncation options
 * @returns TruncateResult with truncated output, metadata, and optional file path
 */
export async function truncateAndSave(content: string, options: TruncateOptions = {}): Promise<TruncateResult> {
  const result = truncate(content, options);

  if (!result.truncated) {
    return result;
  }

  // Save full content to temp file
  const tempDir = options.tempDir ?? DEFAULT_TRUNCATE_DIR;
  const fileName = `${options.prefix ?? 'tool'}_${Date.now()}_${randomUUID().slice(0, 8)}.txt`;
  const outputPath = await saveTruncatedOutput(content, tempDir, fileName);

  return { ...result, outputPath };
}

// ========== Convenience Aliases ==========

/**
 * Synchronous truncate check — truncates in-memory, no file I/O.
 *
 * Alias for `truncate()`. Use when you only need in-memory truncation
 * without saving the full content to disk.
 */
export const truncateIfNeeded = truncate;

/**
 * Async truncate with file save — truncates and saves full content.
 *
 * Alias for `truncateAndSave()`. Use in tool execute() methods where
 * truncated output should be persisted to a temp file for later retrieval.
 */
export const truncateIfNeededAsync = truncateAndSave;

// Re-export storage utilities
export { saveTruncatedOutput, DEFAULT_TRUNCATE_DIR } from './storage.js';
export { cleanupOldFiles, DEFAULT_MAX_AGE_DAYS } from './cleanup.js';
