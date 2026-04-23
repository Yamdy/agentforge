// ========== Tool Result Types ==========

import type { Attachment } from './attachment';

/**
 * Tool execution result.
 *
 * Provides structured output with:
 * - Short title for UI display
 * - Full output content
 * - Optional metadata
 * - Optional file attachments
 * - Truncation info (for large outputs)
 *
 * @template M - Metadata type
 */
export interface ToolResult<M = unknown> {
  /** Short title for UI display (max ~50 chars) */
  title: string;

  /** Full output content */
  output: string;

  /** Structured metadata */
  metadata?: M;

  /** File attachments (images, PDFs, etc.) */
  attachments?: Attachment[];

  /** Whether output was truncated (Truncate system) */
  truncated?: boolean;

  /** If truncated, path to full content file */
  outputPath?: string;
}

/**
 * Create a simple text result.
 *
 * @param output - Output text
 * @param title - Optional title (defaults to first 50 chars of output)
 * @returns ToolResult
 */
export function textResult(output: string, title?: string): ToolResult {
  return {
    title: title ?? output.slice(0, 50),
    output,
  };
}

/**
 * Create a truncated result with file reference.
 *
 * Used when output exceeds limits and is saved to a temp file.
 *
 * @param output - Truncated output (with notice)
 * @param fullPath - Path to full content file
 * @param title - Optional title
 * @returns ToolResult with truncation info
 */
export function truncatedResult(
  output: string,
  fullPath: string,
  title?: string
): ToolResult<{ truncated: true; fullPath: string }> {
  return {
    title: title ?? output.slice(0, 50),
    output,
    truncated: true,
    outputPath: fullPath,
    metadata: {
      truncated: true,
      fullPath,
    },
  };
}

/**
 * Create a result with attachments.
 *
 * @param output - Output text
 * @param attachments - File attachments
 * @param title - Optional title
 * @returns ToolResult with attachments
 */
export function resultWithAttachments(
  output: string,
  attachments: Attachment[],
  title?: string
): ToolResult {
  return {
    title: title ?? output.slice(0, 50),
    output,
    attachments,
  };
}

/**
 * Create an error result.
 *
 * @param error - Error message
 * @returns ToolResult with error info
 */
export function errorResult(error: string): ToolResult<{ error: true }> {
  return {
    title: 'Error',
    output: `Error: ${error}`,
    metadata: { error: true },
  };
}