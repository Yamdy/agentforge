import { z } from 'zod';
import type { Processor, PipelineContext, ProcessorResult } from '@primo-ai/sdk';

/**
 * Strategy for handling validation failures:
 * - block: abort the pipeline with an error
 * - warn: log a warning but continue
 * - fix: attempt to strip unknown properties and retry
 */
export type ValidationStrategy = 'block' | 'warn' | 'fix';

export interface OutputValidationConfig {
  /** Validation engine to use. */
  type: 'json-schema' | 'zod';
  /**
   * The schema to validate against.
   * For `json-schema` type: a JSON Schema object.
   * For `zod` type: a Zod schema (z.ZodType).
   */
  schema: unknown;
  /** How to handle validation failures. Defaults to 'block'. */
  strategy?: ValidationStrategy;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a JSON value against a JSON Schema.
 * Uses recursive structural checking — no external validator dependency.
 */
function validateJsonSchema(value: unknown, schema: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Check type
  if (schema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    const expected = schema.type as string;
    if (expected === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`Expected integer, got ${actualType}`);
      }
    } else if (expected === 'object' && (value === null || Array.isArray(value))) {
      errors.push(`Expected object, got ${actualType}`);
    } else if (expected === 'array' && !Array.isArray(value)) {
      errors.push(`Expected array, got ${actualType}`);
    } else if (expected !== 'object' && expected !== 'array' && actualType !== expected) {
      errors.push(`Expected ${expected}, got ${actualType}`);
    }
  }

  // Check required properties
  if (schema.required && Array.isArray(schema.required) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const prop of schema.required as string[]) {
      if (!(prop in (value as Record<string, unknown>))) {
        errors.push(`Missing required property: ${prop}`);
      }
    }
  }

  // Check property schemas recursively
  if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const obj = value as Record<string, unknown>;
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in obj && obj[key] !== undefined) {
        const subResult = validateJsonSchema(obj[key], propSchema);
        errors.push(...subResult.errors.map((e) => `.${key}: ${e}`));
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Attempt to fix a value by keeping only properties defined in the schema.
 * Only works for object-typed schemas with `properties`.
 */
function attemptFix(value: unknown, schema: Record<string, unknown>): unknown {
  if (
    schema.type === 'object' &&
    schema.properties &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const props = schema.properties as Record<string, unknown>;
    const obj = value as Record<string, unknown>;
    const fixed: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
      if (key in obj) {
        fixed[key] = obj[key];
      }
    }
    return fixed;
  }
  return value;
}

const OutputValidationConfigSchema = z.object({
  type: z.enum(['json-schema', 'zod']),
  schema: z.unknown(),
  strategy: z.enum(['block', 'warn', 'fix']).optional(),
});

export function createOutputValidationProcessor(config: OutputValidationConfig): Processor {
  OutputValidationConfigSchema.parse(config);
  const strategy = config.strategy ?? 'block';

  return {
    stage: 'processOutput',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      const response = ctx.iteration.response;
      if (!response) return ctx;

      // Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(response);
      } catch {
        return handleInvalid(ctx, 'Response is not valid JSON', strategy);
      }

      // Validate
      let result: ValidationResult;
      if (config.type === 'json-schema') {
        result = validateJsonSchema(parsed, config.schema as Record<string, unknown>);
      } else {
        // Zod
        const zodSchema = config.schema as { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ message: string }> } } };
        const zodResult = zodSchema.safeParse(parsed);
        if (zodResult.success) {
          return ctx;
        }
        result = {
          valid: false,
          errors: zodResult.error?.issues?.map((i) => i.message) ?? ['Zod validation failed'],
        };
      }

      if (result.valid) return ctx;

      // Try fix strategy
      if (strategy === 'fix') {
        if (config.type === 'json-schema') {
          const fixed = attemptFix(parsed, config.schema as Record<string, unknown>);
          const fixResult = validateJsonSchema(fixed, config.schema as Record<string, unknown>);
          if (fixResult.valid) {
            return {
              ...ctx,
              iteration: {
                ...ctx.iteration,
                response: JSON.stringify(fixed),
              },
            };
          }
        }
        // Fix failed — fall through to block
        return {
          type: 'abort',
          reason: `Output validation failed (fix attempt unsuccessful): ${result.errors.join('; ')}`,
        };
      }

      return handleInvalid(ctx, result.errors.join('; '), strategy);
    },
  };
}

function handleInvalid(
  ctx: PipelineContext,
  errorDetail: string,
  strategy: ValidationStrategy,
): ProcessorResult {
  const message = `Output validation failed: ${errorDetail}`;

  if (strategy === 'warn') {
    console.warn(`[output-validation] ${message}`);
    return ctx;
  }

  // block
  return { type: 'abort', reason: message };
}
