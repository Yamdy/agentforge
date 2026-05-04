/**
 * Tool Result Truncation Tests (TDD — RED phase)
 *
 * Tests for automatic tool output truncation, referencing OpenCode's
 * Truncate.output() pattern.
 */

import { describe, it, expect } from 'vitest';
import { truncateOutput } from '../../src/loop/tool-truncation.js';

describe('truncateOutput', () => {
  it('returns content unchanged when under maxLength', () => {
    const result = truncateOutput('hello world');
    expect(result.content).toBe('hello world');
    expect(result.truncated).toBe(false);
    expect(result.originalLength).toBe(11);
  });

  it('truncates content exceeding default maxLength (15000)', () => {
    const long = 'x'.repeat(20000);
    const result = truncateOutput(long);
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(20000);
    expect(result.content.length).toBeLessThan(20000);
  });

  it('preserves head and tail lines with truncation marker', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const output = lines.join('\n');
    const result = truncateOutput(output, { maxLength: 500, headLines: 10, tailLines: 5 });

    expect(result.truncated).toBe(true);
    expect(result.content).toMatch(/^line 0/);
    expect(result.content).toMatch(/line 199$/m);
    expect(result.content).toMatch(/truncated/i);
  });

  it('returns empty string for empty input', () => {
    const result = truncateOutput('');
    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.originalLength).toBe(0);
  });

  it('handles content exactly at maxLength', () => {
    const exact = 'x'.repeat(100);
    const result = truncateOutput(exact, { maxLength: 100 });
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(exact);
  });

  it('handles content one char over maxLength', () => {
    const over = 'x'.repeat(101);
    const result = truncateOutput(over, { maxLength: 100 });
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThan(150); // head + tail + marker
  });

  it('respects custom maxLength option', () => {
    const text = 'short text';
    const result = truncateOutput(text, { maxLength: 5 });
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(10);
  });

  it('includes originalLength in result metadata', () => {
    const text = 'x'.repeat(30000);
    const result = truncateOutput(text);
    expect(result.originalLength).toBe(30000);
    expect(result.truncated).toBe(true);
  });
});
