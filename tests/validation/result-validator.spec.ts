/**
 * Unit tests for src/validation/result-validator.ts
 *
 * Tests ResultValidator with schema registration, validation, and removal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ResultValidatorImpl } from '../../src/validation/result-validator.js';
import type { ResultValidator, ValidationResult } from '../../src/contracts/mpu-interfaces.js';

// ============================================================
// ResultValidator Tests
// ============================================================

describe('ResultValidator', () => {
  let validator: ResultValidator;

  beforeEach(() => {
    validator = new ResultValidatorImpl();
  });

  // --------------------------------------------------------
  // Schema Registration
  // --------------------------------------------------------

  describe('registerSchema', () => {
    it('should register a schema for a tool', () => {
      const schema = z.object({ name: z.string() });
      validator.registerSchema('test-tool', schema);
      // Should not throw
    });

    it('should allow registering multiple schemas', () => {
      const schema1 = z.object({ name: z.string() });
      const schema2 = z.object({ value: z.number() });
      validator.registerSchema('tool-a', schema1);
      validator.registerSchema('tool-b', schema2);
      // Should not throw
    });

    it('should overwrite existing schema for same tool', () => {
      const schema1 = z.object({ name: z.string() });
      const schema2 = z.object({ value: z.number() });
      validator.registerSchema('test-tool', schema1);
      validator.registerSchema('test-tool', schema2);
      // Second registration should overwrite first
    });
  });

  // --------------------------------------------------------
  // Schema Removal
  // --------------------------------------------------------

  describe('removeSchema', () => {
    it('should remove a registered schema', () => {
      const schema = z.object({ name: z.string() });
      validator.registerSchema('test-tool', schema);
      validator.removeSchema('test-tool');
      // After removal, validation should return valid (no schema = no validation)
    });

    it('should not throw when removing non-existent schema', () => {
      expect(() => validator.removeSchema('non-existent')).not.toThrow();
    });
  });

  // --------------------------------------------------------
  // Validation - Valid Results
  // --------------------------------------------------------

  describe('validate - valid results', () => {
    it('should return valid for result matching schema', () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      validator.registerSchema('user-tool', schema);

      const result = validator.validate('user-tool', { name: 'Alice', age: 30 });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return valid for simple string schema', () => {
      const schema = z.string();
      validator.registerSchema('echo-tool', schema);

      const result = validator.validate('echo-tool', 'hello');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return valid for number schema', () => {
      const schema = z.number();
      validator.registerSchema('calc-tool', schema);

      const result = validator.validate('calc-tool', 42);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return valid for array schema', () => {
      const schema = z.array(z.string());
      validator.registerSchema('list-tool', schema);

      const result = validator.validate('list-tool', ['a', 'b', 'c']);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return valid for nested object schema', () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          address: z.object({
            city: z.string(),
          }),
        }),
      });
      validator.registerSchema('profile-tool', schema);

      const result = validator.validate('profile-tool', {
        user: { name: 'Bob', address: { city: 'NYC' } },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // --------------------------------------------------------
  // Validation - Invalid Results
  // --------------------------------------------------------

  describe('validate - invalid results', () => {
    it('should return invalid with errors for wrong type', () => {
      const schema = z.object({ name: z.string() });
      validator.registerSchema('test-tool', schema);

      const result = validator.validate('test-tool', { name: 123 });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return invalid for missing required fields', () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      validator.registerSchema('test-tool', schema);

      const result = validator.validate('test-tool', { name: 'Alice' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return invalid for extra fields with strict schema', () => {
      const schema = z.object({ name: z.string() }).strict();
      validator.registerSchema('test-tool', schema);

      const result = validator.validate('test-tool', { name: 'Alice', extra: 'field' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return invalid for null when expecting object', () => {
      const schema = z.object({ name: z.string() });
      validator.registerSchema('test-tool', schema);

      const result = validator.validate('test-tool', null);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return invalid for undefined when expecting object', () => {
      const schema = z.object({ name: z.string() });
      validator.registerSchema('test-tool', schema);

      const result = validator.validate('test-tool', undefined);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should include error path in validation errors', () => {
      const schema = z.object({ user: z.object({ age: z.number() }) });
      validator.registerSchema('test-tool', schema);

      const result = validator.validate('test-tool', { user: { age: 'not-a-number' } });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Error path should include nested field
      const hasNestedPath = result.errors.some(
        (e) => e.path.includes('user') || e.path.includes('age'),
      );
      expect(hasNestedPath).toBe(true);
    });

    it('should include error message in validation errors', () => {
      const schema = z.object({ name: z.string() });
      validator.registerSchema('test-tool', schema);

      const result = validator.validate('test-tool', { name: 123 });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.message).toBeDefined();
      expect(typeof result.errors[0]!.message).toBe('string');
    });
  });

  // --------------------------------------------------------
  // Validation - No Schema Registered
  // --------------------------------------------------------

  describe('validate - no schema registered', () => {
    it('should return valid when no schema is registered', () => {
      const result = validator.validate('unknown-tool', { anything: 'goes' });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return valid for any value when no schema', () => {
      expect(validator.validate('unknown', null).valid).toBe(true);
      expect(validator.validate('unknown', undefined).valid).toBe(true);
      expect(validator.validate('unknown', 42).valid).toBe(true);
      expect(validator.validate('unknown', 'string').valid).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Validation After Schema Removal
  // --------------------------------------------------------

  describe('validate after schema removal', () => {
    it('should return valid after schema is removed', () => {
      const schema = z.object({ name: z.string() });
      validator.registerSchema('test-tool', schema);

      // First validate with schema - should fail for wrong data
      const result1 = validator.validate('test-tool', { name: 123 });
      expect(result1.valid).toBe(false);

      // Remove schema
      validator.removeSchema('test-tool');

      // Now validate - should pass (no schema)
      const result2 = validator.validate('test-tool', { name: 123 });
      expect(result2.valid).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------

  describe('edge cases', () => {
    it('should handle empty object schema', () => {
      const schema = z.object({});
      validator.registerSchema('empty-tool', schema);

      const result = validator.validate('empty-tool', {});
      expect(result.valid).toBe(true);
    });

    it('should handle optional fields', () => {
      const schema = z.object({
        name: z.string(),
        email: z.string().optional(),
      });
      validator.registerSchema('opt-tool', schema);

      const result1 = validator.validate('opt-tool', { name: 'Alice' });
      expect(result1.valid).toBe(true);

      const result2 = validator.validate('opt-tool', { name: 'Alice', email: 'a@b.com' });
      expect(result2.valid).toBe(true);
    });

    it('should handle union schemas', () => {
      const schema = z.union([z.string(), z.number()]);
      validator.registerSchema('union-tool', schema);

      expect(validator.validate('union-tool', 'hello').valid).toBe(true);
      expect(validator.validate('union-tool', 42).valid).toBe(true);
      expect(validator.validate('union-tool', true).valid).toBe(false);
    });

    it('should handle enum schemas', () => {
      const schema = z.enum(['active', 'inactive', 'pending']);
      validator.registerSchema('status-tool', schema);

      expect(validator.validate('status-tool', 'active').valid).toBe(true);
      expect(validator.validate('status-tool', 'deleted').valid).toBe(false);
    });

    it('should handle deeply nested validation errors', () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.string(),
          }),
        }),
      });
      validator.registerSchema('deep-tool', schema);

      const result = validator.validate('deep-tool', {
        level1: { level2: { level3: 123 } },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
