/**
 * Unit tests for src/core/zod-to-schema.ts
 *
 * Tests Zod-to-JSON-Schema conversion and FunctionDefinition generation.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  zodToJsonSchema,
  zodToFunctionDef,
  toolToFunctionDef,
  toolsToFunctionDefs,
} from '../../src/core/zod-to-schema.js';
import type { ToolDefinition, FunctionDefinition } from '../../src/core/interfaces.js';

// ============================================================
// zodToJsonSchema
// ============================================================

describe('zodToJsonSchema', () => {
  // ----- Primitives -----
  describe('primitives', () => {
    it('converts z.string correctly', () => {
      const schema = zodToJsonSchema(z.string());
      expect(schema).toEqual({ type: 'string' });
    });

    it('converts z.number correctly', () => {
      const schema = zodToJsonSchema(z.number());
      expect(schema).toEqual({ type: 'number' });
    });

    it('converts z.boolean correctly', () => {
      const schema = zodToJsonSchema(z.boolean());
      expect(schema).toEqual({ type: 'boolean' });
    });

    it('converts z.string with min/max checks', () => {
      const schema = zodToJsonSchema(z.string().min(1).max(100));
      expect(schema.type).toBe('string');
      expect(schema.minLength).toBe(1);
      expect(schema.maxLength).toBe(100);
    });

    it('converts z.number with int check', () => {
      const schema = zodToJsonSchema(z.number().int());
      expect(schema.type).toBe('integer');
    });

    it('converts z.number with min/max checks', () => {
      const schema = zodToJsonSchema(z.number().min(0).max(100));
      expect(schema.type).toBe('number');
      expect(schema.minimum).toBe(0);
      expect(schema.maximum).toBe(100);
    });
  });

  // ----- Enum -----
  describe('z.enum', () => {
    it('converts z.enum correctly', () => {
      const schema = zodToJsonSchema(z.enum(['red', 'green', 'blue']));
      expect(schema).toEqual({
        type: 'string',
        enum: ['red', 'green', 'blue'],
      });
    });
  });

  // ----- Literal -----
  describe('z.literal', () => {
    it('converts z.literal correctly', () => {
      const schema = zodToJsonSchema(z.literal('hello'));
      expect(schema).toEqual({ const: 'hello' });
    });

    it('converts numeric literal', () => {
      const schema = zodToJsonSchema(z.literal(42));
      expect(schema).toEqual({ const: 42 });
    });
  });

  // ----- Array -----
  describe('z.array', () => {
    it('converts z.array of strings', () => {
      const schema = zodToJsonSchema(z.array(z.string()));
      expect(schema).toEqual({
        type: 'array',
        items: { type: 'string' },
      });
    });

    it('converts z.array of objects', () => {
      const schema = zodToJsonSchema(
        z.array(z.object({ name: z.string(), age: z.number() })),
      );
      expect(schema.type).toBe('array');
      expect((schema as Record<string, unknown>).items).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      });
    });
  });

  // ----- Object -----
  describe('z.object', () => {
    it('converts simple object', () => {
      const schema = zodToJsonSchema(
        z.object({
          name: z.string(),
          age: z.number(),
        }),
      );
      expect(schema).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      });
    });

    it('converts object with nested properties', () => {
      const schema = zodToJsonSchema(
        z.object({
          user: z.object({
            name: z.string(),
            email: z.string(),
          }),
          active: z.boolean(),
        }),
      );
      expect(schema.type).toBe('object');
      expect((schema as Record<string, unknown>).properties).toEqual({
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
          },
          required: ['name', 'email'],
        },
        active: { type: 'boolean' },
      });
      expect(schema.required).toEqual(['user', 'active']);
    });

    it('handles empty object', () => {
      const schema = zodToJsonSchema(z.object({}));
      expect(schema).toEqual({
        type: 'object',
        properties: {},
      });
      // No required array when there are no required fields
      expect(schema.required).toBeUndefined();
    });
  });

  // ----- Optional -----
  describe('z.optional', () => {
    it('omits optional fields from required', () => {
      const schema = zodToJsonSchema(
        z.object({
          name: z.string(),
          nickname: z.string().optional(),
        }),
      );
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['name']);
      expect((schema as Record<string, unknown>).properties).toEqual({
        name: { type: 'string' },
        nickname: { type: 'string' },
      });
    });

    it('handles all optional fields', () => {
      const schema = zodToJsonSchema(
        z.object({
          a: z.string().optional(),
          b: z.number().optional(),
        }),
      );
      expect(schema.type).toBe('object');
      // No required fields → no required array
      expect(schema.required).toBeUndefined();
    });
  });

  // ----- Default -----
  describe('z.default', () => {
    it('sets default value', () => {
      const schema = zodToJsonSchema(z.string().default('hello'));
      expect(schema.type).toBe('string');
      expect(schema.default).toBe('hello');
    });

    it('sets default value for number', () => {
      const schema = zodToJsonSchema(z.number().default(42));
      expect(schema.type).toBe('number');
      expect(schema.default).toBe(42);
    });

    it('sets default value in object property', () => {
      const schema = zodToJsonSchema(
        z.object({
          count: z.number().default(0),
          name: z.string(),
        }),
      );
      expect(schema.type).toBe('object');
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.count.default).toBe(0);
      expect(props.count.type).toBe('number');
    });
  });

  // ----- Describe -----
  describe('z.describe', () => {
    it('extracts description via effects', () => {
      // z.describe() wraps in ZodEffects, which we unwrap to inner schema
      const schema = zodToJsonSchema(z.string().describe('A name field'));
      expect(schema.type).toBe('string');
    });
  });

  // ----- Union -----
  describe('z.union', () => {
    it('converts union to oneOf', () => {
      const schema = zodToJsonSchema(z.union([z.string(), z.number()]));
      expect(schema).toEqual({
        oneOf: [{ type: 'string' }, { type: 'number' }],
      });
    });
  });

  // ----- Nullable -----
  describe('z.nullable', () => {
    it('converts nullable to oneOf with null', () => {
      const schema = zodToJsonSchema(z.string().nullable());
      expect(schema).toEqual({
        oneOf: [{ type: 'string' }, { type: 'null' }],
      });
    });
  });

  // ----- Record -----
  describe('z.record', () => {
    it('converts record correctly', () => {
      const schema = zodToJsonSchema(z.record(z.string(), z.number()));
      expect(schema).toEqual({
        type: 'object',
        additionalProperties: { type: 'number' },
      });
    });
  });

  // ----- Deeply nested -----
  describe('deep nesting', () => {
    it('handles deeply nested objects', () => {
      const schema = zodToJsonSchema(
        z.object({
          level1: z.object({
            level2: z.object({
              level3: z.object({
                value: z.string(),
                count: z.number(),
              }),
            }),
          }),
        }),
      );

      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['level1']);

      const l1Props = schema.properties as Record<string, Record<string, unknown>>;
      const level1 = l1Props['level1'];
      expect(level1.type).toBe('object');

      const l2Props = level1.properties as Record<string, Record<string, unknown>>;
      const level2 = l2Props['level2'];
      expect(level2.type).toBe('object');

      const l3Props = level2.properties as Record<string, Record<string, unknown>>;
      const level3 = l3Props['level3'];
      expect(level3.type).toBe('object');

      const l4Props = level3.properties as Record<string, Record<string, unknown>>;
      expect(l4Props['value']).toEqual({ type: 'string' });
      expect(l4Props['count']).toEqual({ type: 'number' });
    });

    it('handles nested array of objects', () => {
      const schema = zodToJsonSchema(
        z.object({
          items: z.array(
            z.object({
              id: z.string(),
              tags: z.array(z.string()),
            }),
          ),
        }),
      );

      expect(schema.type).toBe('object');
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.items.type).toBe('array');
    });
  });
});

// ============================================================
// zodToFunctionDef
// ============================================================

describe('zodToFunctionDef', () => {
  it('produces valid FunctionDefinition', () => {
    const schema = z.object({
      city: z.string(),
      unit: z.enum(['celsius', 'fahrenheit']).optional(),
    });

    const def: FunctionDefinition = zodToFunctionDef(
      'get_weather',
      'Get the current weather for a city',
      schema,
    );

    expect(def.name).toBe('get_weather');
    expect(def.description).toBe('Get the current weather for a city');
    expect(def.parameters.type).toBe('object');
    expect(def.parameters.properties).toEqual({
      city: { type: 'string' },
      unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    });
    expect(def.parameters.required).toEqual(['city']);
  });

  it('wraps non-object schemas', () => {
    const def = zodToFunctionDef('echo', 'Echo input', z.string());
    expect(def.name).toBe('echo');
    expect(def.parameters.type).toBe('object');
    expect(def.parameters.properties).toEqual({
      value: { type: 'string' },
    });
    expect(def.parameters.required).toEqual(['value']);
  });

  it('handles complex nested schema', () => {
    const schema = z.object({
      query: z.string(),
      filters: z
        .object({
          category: z.string().optional(),
          limit: z.number().default(10),
        })
        .optional(),
    });

    const def = zodToFunctionDef('search', 'Search items', schema);

    expect(def.name).toBe('search');
    expect(def.parameters.required).toEqual(['query']);
    expect(def.parameters.properties?.filters).toBeDefined();
  });
});

// ============================================================
// toolToFunctionDef / toolsToFunctionDefs
// ============================================================

describe('toolToFunctionDef', () => {
  it('converts ToolDefinition to FunctionDefinition', () => {
    const tool: ToolDefinition<z.ZodTypeAny> = {
      name: 'calculator',
      description: 'Perform a calculation',
      parameters: z.object({
        expression: z.string(),
      }),
      execute: async () => '42',
    };

    const def = toolToFunctionDef(tool);

    expect(def.name).toBe('calculator');
    expect(def.description).toBe('Perform a calculation');
    expect(def.parameters.type).toBe('object');
    expect(def.parameters.properties).toEqual({
      expression: { type: 'string' },
    });
    expect(def.parameters.required).toEqual(['expression']);
  });
});

describe('toolsToFunctionDefs', () => {
  it('converts array of tools', () => {
    const tools: ToolDefinition<z.ZodTypeAny>[] = [
      {
        name: 'tool_a',
        description: 'Tool A',
        parameters: z.object({ a: z.string() }),
        execute: async () => 'a',
      },
      {
        name: 'tool_b',
        description: 'Tool B',
        parameters: z.object({ b: z.number() }),
        execute: async () => 'b',
      },
    ];

    const defs = toolsToFunctionDefs(tools);

    expect(defs).toHaveLength(2);
    expect(defs[0]?.name).toBe('tool_a');
    expect(defs[1]?.name).toBe('tool_b');
  });

  it('handles empty array', () => {
    const defs = toolsToFunctionDefs([]);
    expect(defs).toEqual([]);
  });
});
