/**
 * Result Validator
 *
 * Validates tool results against registered Zod schemas.
 * Tier 1 validation: external input → safeParse + graceful degradation.
 *
 * @module
 */

import type { ZodSchema, ZodIssue } from 'zod';
import type {
  ResultValidator,
  ValidationResult,
  ValidationError,
} from '../contracts/mpu-interfaces.js';

/**
 * ResultValidator implementation using Zod schemas.
 *
 * When no schema is registered for a tool, validation passes (permissive default).
 * When a schema is registered, results are validated against it.
 */
export class ResultValidatorImpl implements ResultValidator {
  private readonly schemas = new Map<string, ZodSchema>();

  validate(toolName: string, result: unknown): ValidationResult {
    const schema = this.schemas.get(toolName);
    if (!schema) {
      return { valid: true, errors: [] };
    }

    const parsed = schema.safeParse(result);
    if (parsed.success) {
      return { valid: true, errors: [] };
    }

    const errors: ValidationError[] = parsed.error.issues.map((issue: ZodIssue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    return { valid: false, errors };
  }

  registerSchema(toolName: string, schema: unknown): void {
    this.schemas.set(toolName, schema as ZodSchema);
  }

  removeSchema(toolName: string): void {
    this.schemas.delete(toolName);
  }
}
