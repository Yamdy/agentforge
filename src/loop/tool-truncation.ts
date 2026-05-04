/**
 * Tool Result Truncation
 *
 * Automatic truncation of tool outputs to prevent context overflow.
 * Referencing OpenCode's Truncate.output() pattern: every tool result
 * is automatically truncated to a safe maximum length before being
 * fed back to the LLM.
 */

export interface TruncateOptions {
  maxLength?: number;
  headLines?: number;
  tailLines?: number;
}

export interface TruncateResult {
  content: string;
  truncated: boolean;
  originalLength: number;
}

const DEFAULT_MAX_LENGTH = 15_000;
const DEFAULT_HEAD_LINES = 100;
const DEFAULT_TAIL_LINES = 20;

export function truncateOutput(output: string, options?: TruncateOptions): TruncateResult {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const headLines = options?.headLines ?? DEFAULT_HEAD_LINES;
  const tailLines = options?.tailLines ?? DEFAULT_TAIL_LINES;
  const originalLength = output.length;

  if (originalLength <= maxLength) {
    return { content: output, truncated: false, originalLength };
  }

  const lines = output.split('\n');

  // If we can fit all lines within head+tail, use line-based truncation
  if (lines.length > headLines + tailLines) {
    const head = lines.slice(0, headLines).join('\n');
    const tail = lines.slice(-tailLines).join('\n');
    const marker = `\n... [truncated ${originalLength - head.length - tail.length} chars, ${lines.length - headLines - tailLines} lines] ...\n`;
    const content = head + marker + tail;

    // If line-based truncation still exceeds maxLength, fall through to char-based
    if (content.length <= maxLength * 1.2) {
      return { content, truncated: true, originalLength };
    }
  }

  // Character-based truncation: keep head and tail code-points
  const chars = [...output];
  const headChars = Math.floor(maxLength * 0.8);
  const tailChars = Math.floor(maxLength * 0.15);
  const head = chars.slice(0, headChars).join('');
  const tail = chars.slice(-tailChars).join('');
  const removed = chars.length - headChars - tailChars;
  const marker = `\n... [truncated ${Math.max(0, removed)} chars] ...\n`;

  return {
    content: head + marker + tail,
    truncated: true,
    originalLength,
  };
}
