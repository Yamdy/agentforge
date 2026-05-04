/**
 * Doom Loop Detector Tests (TDD — RED phase)
 *
 * Tests for detection of infinite tool-call loops where the agent
 * repeatedly calls the same tool with identical arguments.
 * Reference: OpenCode's doom_loop permission detection
 * (3 consecutive identical tool calls triggers intervention).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createDoomLoopDetector, type DoomLoopDetector } from '../../src/loop/doom-loop-detector.js';

describe('createDoomLoopDetector', () => {
  let detector: DoomLoopDetector;

  beforeEach(() => {
    detector = createDoomLoopDetector();
  });

  it('returns isDoomLoop=false when no tool calls recorded', () => {
    expect(detector.isDoomLoop()).toBe(false);
  });

  it('returns isDoomLoop=false for a single tool call', () => {
    detector.record('read_file', { path: '/foo' });
    expect(detector.isDoomLoop()).toBe(false);
  });

  it('returns isDoomLoop=false for two identical calls', () => {
    detector.record('read_file', { path: '/foo' });
    detector.record('read_file', { path: '/foo' });
    expect(detector.isDoomLoop()).toBe(false);
  });

  it('returns isDoomLoop=true for three identical calls', () => {
    detector.record('read_file', { path: '/foo' });
    detector.record('read_file', { path: '/foo' });
    detector.record('read_file', { path: '/foo' });
    expect(detector.isDoomLoop()).toBe(true);
  });

  it('resets when a different tool is called', () => {
    detector.record('read_file', { path: '/foo' });
    detector.record('read_file', { path: '/foo' });
    detector.record('write_file', { path: '/bar', content: 'x' });
    expect(detector.isDoomLoop()).toBe(false);
  });

  it('resets when same tool is called with different args', () => {
    detector.record('read_file', { path: '/foo' });
    detector.record('read_file', { path: '/foo' });
    detector.record('read_file', { path: '/baz' });
    expect(detector.isDoomLoop()).toBe(false);
  });

  it('reset() clears all history', () => {
    detector.record('read_file', { path: '/foo' });
    detector.record('read_file', { path: '/foo' });
    detector.record('read_file', { path: '/foo' });
    expect(detector.isDoomLoop()).toBe(true);
    detector.reset();
    expect(detector.isDoomLoop()).toBe(false);
  });

  it('detects loop after non-identical calls interrupt the pattern', () => {
    detector.record('read_file', { path: '/foo' });
    detector.record('read_file', { path: '/foo' });
    // Different call resets
    detector.record('bash', { command: 'ls' });
    expect(detector.isDoomLoop()).toBe(false);
    // Start new pattern
    detector.record('bash', { command: 'ls' });
    detector.record('bash', { command: 'ls' });
    detector.record('bash', { command: 'ls' });
    expect(detector.isDoomLoop()).toBe(true);
  });

  it('provides loop details via getDetails()', () => {
    detector.record('bash', { command: 'ls -la' });
    detector.record('bash', { command: 'ls -la' });
    detector.record('bash', { command: 'ls -la' });

    const details = detector.getDetails();
    expect(details).not.toBeNull();
    expect(details!.toolName).toBe('bash');
    expect(details!.repeatCount).toBe(3);
  });

  it('returns null details when no loop detected', () => {
    detector.record('bash', { command: 'ls' });
    expect(detector.getDetails()).toBeNull();
  });
});
