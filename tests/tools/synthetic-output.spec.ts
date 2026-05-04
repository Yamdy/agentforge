/**
 * SyntheticOutputTool Tests
 *
 * Tests for the synthetic_output tool: enforcing structured output from LLMs
 * by validating JSON output against registered Zod schemas.
 */

import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { z } from 'zod';
import type { ToolDefinition } from '../../src/core/interfaces.js';

// Cached module exports
let createSyntheticOutputTool: (schemas?: Record<string, z.ZodType>) => ToolDefinition;
let SYNTHETIC_OUTPUT_TOOL_NAME: string;
let clearOutputTypes: () => void;
let registerOutputType: (name: string, schema: z.ZodType) => void;
let hasOutputType: (name: string) => boolean;

beforeAll(async () => {
  const mod = await import('../../src/tools/synthetic-output.js');
  createSyntheticOutputTool = mod.createSyntheticOutputTool;
  SYNTHETIC_OUTPUT_TOOL_NAME = mod.SYNTHETIC_OUTPUT_TOOL_NAME;
  clearOutputTypes = mod.clearOutputTypes;
  registerOutputType = mod.registerOutputType;
  hasOutputType = mod.hasOutputType;
});

// ============================================================
// Test Schemas
// ============================================================

const weatherSchema = z.object({
  temperature: z.number(),
  city: z.string(),
  conditions: z.string(),
});

const userSchema = z.object({
  name: z.string(),
  age: z.number().int().positive(),
  email: z.string().email(),
});

const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  zip: z.string(),
  country: z.string().optional(),
});

const nestedSchema = z.object({
  id: z.string(),
  metadata: z.object({
    tags: z.array(z.string()),
    priority: z.enum(['low', 'medium', 'high']),
  }),
  results: z.array(
    z.object({
      score: z.number(),
      label: z.string(),
    })
  ),
});

const primitiveSchema = z.object({
  name: z.string(),
  count: z.number(),
  active: z.boolean(),
});

// ============================================================
// Tool Metadata
// ============================================================

describe('SyntheticOutputTool metadata', () => {
  beforeEach(async () => {
    clearOutputTypes();
  });

  it('should have correct tool name', async () => {

    const tool = createSyntheticOutputTool();

    expect(tool.name).toBe(SYNTHETIC_OUTPUT_TOOL_NAME);
    expect(SYNTHETIC_OUTPUT_TOOL_NAME).toBe('synthetic_output');
  });

  it('should have a description', async () => {

    const tool = createSyntheticOutputTool();

    expect(tool.description).toBeTruthy();
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('should have requiresApproval set to false', async () => {

    const tool = createSyntheticOutputTool();

    expect(tool.requiresApproval).toBe(false);
  });

  it('should have riskLevel set to low', async () => {

    const tool = createSyntheticOutputTool();

    expect(tool.riskLevel).toBe('low');
  });

  it('should have a Zod parameters schema that accepts output field', async () => {

    const tool = createSyntheticOutputTool();

    expect(tool.parameters).toBeDefined();
    const parseResult = (
      tool.parameters as z.ZodObject<{ output: z.ZodAny }>
    ).safeParse({ output: { hello: 'world' } });
    expect(parseResult.success).toBe(true);
  });
});

// ============================================================
// Basic Passthrough (No Schema)
// ============================================================

describe('SyntheticOutputTool basic passthrough', () => {
  let tool: ToolDefinition;

  beforeEach(async () => {
    clearOutputTypes();
    tool = createSyntheticOutputTool();
  });

  it('should accept and echo valid JSON output', async () => {
    const result = await tool.execute({
      output: { hello: 'world', count: 42 },
    });

    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ hello: 'world', count: 42 });
  });

  it('should handle primitives: string', async () => {
    const result = await tool.execute({ output: 'hello world' });

    const parsed = JSON.parse(result);
    expect(parsed).toBe('hello world');
  });

  it('should handle primitives: number', async () => {
    const result = await tool.execute({ output: 42 });

    const parsed = JSON.parse(result);
    expect(parsed).toBe(42);
  });

  it('should handle primitives: boolean', async () => {
    const result = await tool.execute({ output: true });

    const parsed = JSON.parse(result);
    expect(parsed).toBe(true);
  });

  it('should handle arrays', async () => {
    const result = await tool.execute({ output: [1, 2, 3, 'four'] });

    const parsed = JSON.parse(result);
    expect(parsed).toEqual([1, 2, 3, 'four']);
  });

  it('should handle null', async () => {
    const result = await tool.execute({ output: null });

    const parsed = JSON.parse(result);
    expect(parsed).toBeNull();
  });
});

// ============================================================
// Schema Validation — Passing Cases
// ============================================================

describe('SyntheticOutputTool schema validation', () => {
  describe('with single schema', () => {
    let tool: ToolDefinition;

    beforeEach(async () => {
      tool = createSyntheticOutputTool({ weather: weatherSchema });
    });

    it('should validate correct data and pass', async () => {
      const result = await tool.execute({
        output: { temperature: 22, city: 'Tokyo', conditions: 'sunny' },
      });

      const parsed = JSON.parse(result);
      expect(parsed).toEqual({
        temperature: 22,
        city: 'Tokyo',
        conditions: 'sunny',
      });
    });

    it('should reject invalid data with error info', async () => {
      const result = await tool.execute({
        output: { temperature: 'hot', city: 123 },
      });

      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('error');
      expect(parsed).toHaveProperty('issues');
      expect(Array.isArray(parsed.issues)).toBe(true);
      expect(parsed.issues.length).toBeGreaterThan(0);
    });

    it('should include validation issue details in error', async () => {
      const result = await tool.execute({
        output: { temperature: 'not-a-number' },
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Validation');
      expect(parsed.issues[0]).toHaveProperty('path');
      expect(parsed.issues[0]).toHaveProperty('message');
      expect(parsed.issues[0]).toHaveProperty('code');
    });
  });

  describe('with multiple schemas', () => {
    let tool: ToolDefinition;

    beforeEach(async () => {
      tool = createSyntheticOutputTool({
        weather: weatherSchema,
        user: userSchema,
      });
    });

    it('should accept output matching any registered schema', async () => {
      const weatherResult = await tool.execute({
        output: { temperature: 18, city: 'London', conditions: 'cloudy' },
      });

      const weatherParsed = JSON.parse(weatherResult);
      expect(weatherParsed).toHaveProperty('temperature', 18);

      const userResult = await tool.execute({
        output: { name: 'Alice', age: 30, email: 'alice@example.com' },
      });

      const userParsed = JSON.parse(userResult);
      expect(userParsed).toHaveProperty('name', 'Alice');
    });

    it('should fail with error info when output matches no schema', async () => {
      const result = await tool.execute({
        output: { randomField: true },
      });

      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('error');
      expect(parsed).toHaveProperty('issues');
      expect(parsed.issues.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// Complex & Nested Objects
// ============================================================

describe('SyntheticOutputTool complex objects', () => {
  let tool: ToolDefinition;

  beforeEach(async () => {
    tool = createSyntheticOutputTool({ result: nestedSchema });
  });

  it('should handle complex nested objects', async () => {
    const output = {
      id: 'abc-123',
      metadata: {
        tags: ['important', 'urgent'],
        priority: 'high',
      },
      results: [
        { score: 0.95, label: 'cat' },
        { score: 0.03, label: 'dog' },
      ],
    };

    const result = await tool.execute({ output });

    const parsed = JSON.parse(result);
    expect(parsed).toEqual(output);
  });

  it('should reject nested objects with wrong types', async () => {
    const result = await tool.execute({
      output: {
        id: 'abc-123',
        metadata: {
          tags: 'not-an-array',
          priority: 'critical',
        },
        results: [],
      },
    });

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('error');
    expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it('should validate arrays of objects correctly', async () => {
    const output = {
      id: 'x-1',
      metadata: { tags: ['a', 'b'], priority: 'low' },
      results: [{ score: 0.5, label: 'x' }],
    };

    const result = await tool.execute({ output });

    const parsed = JSON.parse(result);
    expect(parsed).toEqual(output);
  });
});

// ============================================================
// Primitive Type Validation
// ============================================================

describe('SyntheticOutputTool primitive validation', () => {
  let tool: ToolDefinition;

  beforeEach(async () => {
    tool = createSyntheticOutputTool({ prim: primitiveSchema });
  });

  it('should validate string fields', async () => {
    const result = await tool.execute({
      output: { name: 'Bob', count: 5, active: false },
    });

    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ name: 'Bob', count: 5, active: false });
  });

  it('should reject wrong primitive types', async () => {
    const result = await tool.execute({
      output: { name: 123, count: 'not-a-number', active: 'yes' },
    });

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('error');
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Zod Parameter Validation
// ============================================================

describe('SyntheticOutputTool parameter validation', () => {
  let tool: ToolDefinition;

  beforeEach(async () => {
    clearOutputTypes();
    tool = createSyntheticOutputTool();
  });

  it('should reject missing args entirely', async () => {
    const result = await tool.execute(undefined as unknown as Record<string, unknown>);

    expect(result).toContain('Error');
    expect(result).toContain('Invalid arguments');
  });

  it('should reject null args', async () => {
    const result = await tool.execute(null as unknown as Record<string, unknown>);

    expect(result).toContain('Error');
  });

  it('should handle undefined output gracefully', async () => {
    // z.any() accepts undefined, so {} with missing output key
    // parses as { output: undefined } — this goes to passthrough
    const result = await tool.execute({});
    // JSON.stringify(undefined) is undefined, but our impl returns 'undefined'
    expect(result).toBe('undefined');
  });

  it('should reject args with wrong types', async () => {
    const result = await tool.execute('not-an-object' as unknown as Record<string, unknown>);

    expect(result).toContain('Error');
  });
});

// ============================================================
// registerOutputType Helper
// ============================================================

describe('registerOutputType', () => {
  beforeEach(async () => {
    clearOutputTypes();
  });

  it('should allow registering a schema after tool creation', async () => {

    const tool = createSyntheticOutputTool();

    // Before registration: passthrough (no validation)
    const beforeResult = await tool.execute({ output: { anything: 'goes' } });
    const beforeParsed = JSON.parse(beforeResult);
    expect(beforeParsed).toEqual({ anything: 'goes' });

    // Register a schema
    registerOutputType('user', userSchema);

    // After registration: should validate
    const validResult = await tool.execute({
      output: { name: 'Alice', age: 30, email: 'alice@example.com' },
    });
    const validParsed = JSON.parse(validResult);
    expect(validParsed).toHaveProperty('name', 'Alice');

    // Invalid should fail
    const invalidResult = await tool.execute({
      output: { name: 'Bob' },
    });
    const invalidParsed = JSON.parse(invalidResult);
    expect(invalidParsed).toHaveProperty('error');
  });

  it('should allow registering multiple schemas', async () => {

    const tool = createSyntheticOutputTool();

    registerOutputType('weather', weatherSchema);
    registerOutputType('address', addressSchema);

    // Weather output should pass
    const weatherResult = await tool.execute({
      output: { temperature: 30, city: 'Miami', conditions: 'hot' },
    });
    const weatherParsed = JSON.parse(weatherResult);
    expect(weatherParsed).toHaveProperty('temperature', 30);

    // Address output should pass
    const addressResult = await tool.execute({
      output: {
        street: '123 Main St',
        city: 'Springfield',
        zip: '12345',
      },
    });
    const addressParsed = JSON.parse(addressResult);
    expect(addressParsed).toHaveProperty('street', '123 Main St');
  });

  it('should warn when overwriting a duplicate output type name', async () => {

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registerOutputType('duplicate', weatherSchema);
    // Second registration with same name should trigger console.warn
    registerOutputType('duplicate', userSchema);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('duplicate')
    );

    warnSpy.mockRestore();
  });

  it('should correctly report whether an output type is registered', async () => {

    expect(hasOutputType('nonexistent')).toBe(false);

    registerOutputType('testType', z.object({ value: z.number() }));
    expect(hasOutputType('testType')).toBe(true);
    expect(hasOutputType('other')).toBe(false);
  });
});
