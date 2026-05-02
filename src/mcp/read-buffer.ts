/**
 * Read Buffer for Stdio Transport
 *
 * Line-based buffer for parsing newline-delimited JSON messages.
 * Handles partial reads and message boundaries.
 *
 */

// ============================================================
// Read Buffer
// ============================================================

/**
 * Line buffer for reading newline-delimited JSON messages from a stream.
 *
 * Usage:
 * ```typescript
 * const buffer = new ReadBuffer();
 * stream.on('data', (chunk) => {
 *   buffer.append(chunk);
 *   while (buffer.hasMessage()) {
 *     const message = buffer.readMessage();
 *     if (message) processJson(JSON.parse(message));
 *   }
 * });
 * ```
 */
export class ReadBuffer {
  private buffer = '';

  /**
   * Append data to the buffer.
   * @param chunk - Data chunk (Buffer or string)
   */
  append(chunk: Buffer | string): void {
    const data = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    this.buffer += data;
  }

  /**
   * Check if a complete message is available.
   * @returns True if at least one newline-delimited message is ready
   */
  hasMessage(): boolean {
    return this.buffer.includes('\n');
  }

  /**
   * Read the next complete message from the buffer.
   * @returns The message string (without newline) or null if no complete message
   */
  readMessage(): string | null {
    const newlineIndex = this.buffer.indexOf('\n');
    if (newlineIndex === -1) {
      return null;
    }

    const message = this.buffer.slice(0, newlineIndex);
    this.buffer = this.buffer.slice(newlineIndex + 1);
    return message;
  }

  /**
   * Get current buffer content (for debugging).
   * @returns Current buffer content
   */
  peek(): string {
    return this.buffer;
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.buffer = '';
  }

  /**
   * Get buffer length.
   */
  get length(): number {
    return this.buffer.length;
  }
}
