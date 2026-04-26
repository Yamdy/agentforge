/**
 * Unit tests for src/resilience/error-classifier.ts
 *
 * Tests error classification rules:
 * - Minor: network timeout, parameter format error
 * - Moderate: tool execution failure, LLM output invalid
 * - Severe: permission violation, sandbox escape, goal deviation
 */

import { describe, it, expect } from 'vitest';
import { DefaultErrorClassifier } from '../../src/resilience/error-classifier.js';
import type { SerializedError } from '../../src/core/events.js';

function makeError(name: string, message: string): SerializedError {
  return { name, message };
}

describe('DefaultErrorClassifier', () => {
  const classifier = new DefaultErrorClassifier();

  // ============================================================
  // Minor errors
  // ============================================================

  describe('minor errors', () => {
    it('should classify network timeout as minor', () => {
      const error = makeError('TimeoutError', 'Network request timed out after 30000ms');
      expect(classifier.classify(error)).toBe('minor');
    });

    it('should classify ETIMEDOUT as minor', () => {
      const error = makeError('Error', 'connect ETIMEDOUT 192.168.1.1:443');
      expect(classifier.classify(error)).toBe('minor');
    });

    it('should classify ECONNRESET as minor', () => {
      const error = makeError('Error', 'read ECONNRESET');
      expect(classifier.classify(error)).toBe('minor');
    });

    it('should classify parameter validation error as minor', () => {
      const error = makeError('ValidationError', 'Invalid parameter format: expected string, got number');
      expect(classifier.classify(error)).toBe('minor');
    });

    it('should classify ZodError as minor', () => {
      const error = makeError('ZodError', 'Expected string, received number at path "name"');
      expect(classifier.classify(error)).toBe('minor');
    });

    it('should classify schema validation error as minor', () => {
      const error = makeError('SchemaError', 'Schema validation failed: missing required field "id"');
      expect(classifier.classify(error)).toBe('minor');
    });
  });

  // ============================================================
  // Moderate errors
  // ============================================================

  describe('moderate errors', () => {
    it('should classify tool execution failure as moderate', () => {
      const error = makeError('ToolExecutionError', 'Tool "bash" failed with exit code 1');
      expect(classifier.classify(error)).toBe('moderate');
    });

    it('should classify tool error as moderate', () => {
      const error = makeError('ToolError', 'Failed to execute tool: file not found');
      expect(classifier.classify(error)).toBe('moderate');
    });

    it('should classify LLM output invalid as moderate', () => {
      const error = makeError('LLMOutputError', 'LLM output invalid: expected JSON object');
      expect(classifier.classify(error)).toBe('moderate');
    });

    it('should classify LLM response parse error as moderate', () => {
      const error = makeError('ParseError', 'Failed to parse LLM response: unexpected token');
      expect(classifier.classify(error)).toBe('moderate');
    });

    it('should classify rate limit error as moderate', () => {
      const error = makeError('RateLimitError', 'Rate limit exceeded: 429 Too Many Requests');
      expect(classifier.classify(error)).toBe('moderate');
    });

    it('should classify API error as moderate', () => {
      const error = makeError('APIError', 'API request failed with status 500');
      expect(classifier.classify(error)).toBe('moderate');
    });
  });

  // ============================================================
  // Severe errors
  // ============================================================

  describe('severe errors', () => {
    it('should classify permission violation as severe', () => {
      const error = makeError('PermissionError', 'Permission denied: cannot access /etc/shadow');
      expect(classifier.classify(error)).toBe('severe');
    });

    it('should classify access denied as severe', () => {
      const error = makeError('AccessDeniedError', 'Access denied: insufficient privileges');
      expect(classifier.classify(error)).toBe('severe');
    });

    it('should classify sandbox escape attempt as severe', () => {
      const error = makeError('SandboxViolation', 'Sandbox escape detected: path traversal attempt');
      expect(classifier.classify(error)).toBe('severe');
    });

    it('should classify container escape as severe', () => {
      const error = makeError('SecurityError', 'Container escape attempt: unauthorized syscall detected');
      expect(classifier.classify(error)).toBe('severe');
    });

    it('should classify goal deviation as severe', () => {
      const error = makeError('GoalDeviation', 'Goal deviation: agent action偏离了预设目标');
      expect(classifier.classify(error)).toBe('severe');
    });

    it('should classify injection detected as severe', () => {
      const error = makeError('InjectionDetected', 'Prompt injection detected in user input');
      expect(classifier.classify(error)).toBe('severe');
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================

  describe('edge cases', () => {
    it('should classify unknown error as moderate by default', () => {
      const error = makeError('UnknownError', 'Something went wrong');
      expect(classifier.classify(error)).toBe('moderate');
    });

    it('should handle error with empty message', () => {
      const error = makeError('Error', '');
      expect(classifier.classify(error)).toBe('moderate');
    });

    it('should prioritize severe over other matches', () => {
      // If message matches both moderate and severe patterns, severe wins
      const error = makeError('ToolError', 'Permission denied during tool execution');
      expect(classifier.classify(error)).toBe('severe');
    });
  });
});
