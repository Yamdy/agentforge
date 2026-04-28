/**
 * AgentForge Tool Output Validation Contract
 *
 * Tier 1 validation for tool execution outputs.
 * Uses safeParse + graceful degradation, never crashes.
 *
 * @see docs/design/01-CORE-TYPES.md - Tool Output Validation section
 */

import { z } from 'zod';
import type { ToolDefinition } from '../core/interfaces.js';

// ============================================================
// Types
// ============================================================

/**
 * Validated tool output result
 */
export interface ValidatedToolOutput<T = unknown> {
  /** Raw string output from tool execution */
  raw: string;
  /** Structured output (if outputSchema defined and parse succeeded) */
  structured?: T;
  /** Whether validation passed */
  isValid: boolean;
  /** Validation error message (if validation failed) */
  validationError?: string;
}

// ============================================================
// Validation Function
// ============================================================

/**
 * Validate tool output against its outputSchema (Tier 1)
 *
 * Tool execution output is external untrusted data.
 * Uses safeParse + graceful degradation, never crashes.
 *
 * @param rawResult - Raw string output from tool execution
 * @param tool - Tool definition with optional outputSchema
 * @returns Validated output with structured data or error info
 */
export function validateToolOutput<T>(
  rawResult: string,
  tool: ToolDefinition<unknown, z.ZodType<T>>
): ValidatedToolOutput<T> {
  // No outputSchema → keep raw string only
  if (!tool.outputSchema) {
    return { raw: rawResult, isValid: true };
  }

  // Try JSON parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResult);
  } catch {
    return {
      raw: rawResult,
      isValid: false,
      validationError: 'Output is not valid JSON',
    };
  }

  // Zod schema validation
  const result = (tool.outputSchema as z.ZodType).safeParse(parsed);
  if (result.success) {
    return { raw: rawResult, structured: result.data as T, isValid: true };
  }

  // Graceful degradation: keep raw string, mark validation failed
  return {
    raw: rawResult,
    isValid: false,
    validationError: result.error.message,
  };
}

/**
 * Validate tool output and return validation metadata
 *
 * Convenience function that returns metadata suitable for tool.result event.
 *
 * @param rawResult - Raw string output from tool execution
 * @param tool - Tool definition with optional outputSchema
 * @returns Object with structuredOutput, isValid, validationError fields
 */
export function validateToolOutputForEvent(
  rawResult: string,
  tool: ToolDefinition
): {
  structuredOutput: unknown;
  isValid: boolean | undefined;
  validationError: string | undefined;
} {
  if (!tool.outputSchema) {
    return {
      structuredOutput: undefined,
      isValid: undefined,
      validationError: undefined,
    };
  }

  // Cast to satisfy validateToolOutput signature - safeParse handles runtime validation
  const validated = validateToolOutput(rawResult, tool as ToolDefinition<unknown, z.ZodType>);
  return {
    structuredOutput: validated.structured,
    isValid: validated.isValid,
    validationError: validated.validationError,
  };
}
