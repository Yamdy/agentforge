/**
 * Unit tests for src/contracts/user-input-contract.ts
 *
 * Tests user input validation with graceful degradation.
 */

import { describe, it, expect } from 'vitest';
import {
  UserInputSchema,
  validateUserInput,
} from '../../src/contracts/user-input-contract.js';

// ============================================================
// Schema Validation
// ============================================================

describe('UserInputSchema', () => {
  it('should validate valid input object', () => {
    const input = { content: 'Hello', metadata: { source: 'cli' } };
    expect(UserInputSchema.safeParse(input).success).toBe(true);
  });

  it('should validate input with minimal content', () => {
    const input = { content: 'Hello' };
    expect(UserInputSchema.safeParse(input).success).toBe(true);
  });

  it('should default metadata to empty object', () => {
    const input = { content: 'Hello' };
    const result = UserInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({});
    }
  });

  it('should reject empty content string', () => {
    const input = { content: '' };
    expect(UserInputSchema.safeParse(input).success).toBe(false);
  });

  it('should reject missing content', () => {
    const input = { metadata: {} };
    expect(UserInputSchema.safeParse(input).success).toBe(false);
  });
});

// ============================================================
// validateUserInput
// ============================================================

describe('validateUserInput', () => {
  describe('valid inputs', () => {
    it('should pass valid string through unchanged', () => {
      const result = validateUserInput('Hello, world!');
      expect(result).toBe('Hello, world!');
    });

    it('should handle string with whitespace', () => {
      const result = validateUserInput('  Hello  ');
      expect(result).toBe('  Hello  ');
    });

    it('should extract content from object with content field', () => {
      const result = validateUserInput({ content: 'Hello from object' });
      expect(result).toBe('Hello from object');
    });

    it('should extract content from object with metadata', () => {
      const result = validateUserInput({ content: 'Hello', metadata: { source: 'cli' } });
      expect(result).toBe('Hello');
    });
  });

  describe('graceful degradation', () => {
    it('should return empty string for empty string input', () => {
      const result = validateUserInput('');
      expect(result).toBe('');
    });

    it('should return empty string for number input', () => {
      const result = validateUserInput(42);
      expect(result).toBe('');
    });

    it('should return empty string for null input', () => {
      const result = validateUserInput(null);
      expect(result).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const result = validateUserInput(undefined);
      expect(result).toBe('');
    });

    it('should return empty string for array input', () => {
      const result = validateUserInput(['Hello', 'World']);
      expect(result).toBe('');
    });

    it('should return empty string for object without content field', () => {
      const result = validateUserInput({ message: 'Hello' });
      expect(result).toBe('');
    });

    it('should return empty string for object with empty content', () => {
      const result = validateUserInput({ content: '' });
      expect(result).toBe('');
    });

    it('should return empty string for object with non-string content', () => {
      const result = validateUserInput({ content: 123 });
      expect(result).toBe('');
    });

    it('should return empty string for boolean input', () => {
      const result = validateUserInput(true);
      expect(result).toBe('');
    });
  });
});
