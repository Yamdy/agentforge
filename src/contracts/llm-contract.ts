/**
 * LLM Response Contract - Tier 1 Validation
 *
 * Validates LLM responses (external untrusted data) with graceful degradation.
 * Never throws - always returns a usable LLMResponse.
 *
 */

import { z } from 'zod';
import { generateId } from '../core/events.js';

// ============================================================
// Schema
// ============================================================

/**
 * Zod schema for LLM response contract.
 * Validates structure of LLM API responses at the adapter boundary.
 */
export const LLMResponseContractSchema = z.object({
  content: z.string(),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        args: z.record(z.string(), z.unknown()),
      })
    )
    .optional(),
  finishReason: z.enum(['stop', 'tool_calls', 'length', 'error', 'cancelled']),
  usage: z
    .object({
      promptTokens: z.number(),
      completionTokens: z.number(),
    })
    .optional(),
});

/**
 * Inferred LLMResponse type from the contract schema.
 */
export type LLMResponse = z.infer<typeof LLMResponseContractSchema>;

// ============================================================
// Valid finish reasons (for type-safe extraction)
// ============================================================

const VALID_FINISH_REASONS = ['stop', 'tool_calls', 'length', 'error', 'cancelled'] as const;

function isValidFinishReason(value: string): value is (typeof VALID_FINISH_REASONS)[number] {
  return (VALID_FINISH_REASONS as readonly string[]).includes(value);
}

// ============================================================
// Extract Tool Call (with snake_case support)
// ============================================================

/**
 * Extract a single tool call from untrusted raw data.
 * Handles both camelCase and snake_case field names.
 * Never throws - always returns a valid tool call structure.
 *
 * @param raw - Untrusted tool call data from LLM response
 * @returns Validated tool call with fallback defaults
 */
export function extractToolCall(raw: unknown): {
  id: string;
  name: string;
  args: Record<string, unknown>;
} {
  const obj = (raw ?? {}) as Record<string, unknown>;

  // Extract id (camelCase or snake_case)
  const id =
    typeof obj.id === 'string'
      ? obj.id
      : typeof obj.tool_call_id === 'string'
        ? obj.tool_call_id
        : generateId('tc');

  // Extract name (camelCase, snake_case, or nested function.name)
  let name = 'unknown';
  if (typeof obj.name === 'string') {
    name = obj.name;
  } else if (typeof obj.function_name === 'string') {
    name = obj.function_name;
  } else if (typeof obj.function === 'object' && obj.function !== null) {
    const func = obj.function as Record<string, unknown>;
    if (typeof func.name === 'string') {
      name = func.name;
    }
  }

  // Extract args (camelCase, snake_case/arguments, or nested function.arguments)
  const args = extractToolCallArgs(obj);

  return { id, name, args };
}

/**
 * Extract args from a tool call object, handling multiple formats:
 * - `args` (camelCase)
 * - `arguments` (OpenAI format, may be JSON string)
 * - `function.arguments` (nested OpenAI format)
 */
function extractToolCallArgs(obj: Record<string, unknown>): Record<string, unknown> {
  // Try camelCase `args` first
  if (typeof obj.args === 'object' && obj.args !== null && !Array.isArray(obj.args)) {
    return obj.args as Record<string, unknown>;
  }

  // Try snake_case `arguments` (may be object or JSON string)
  if (
    typeof obj.arguments === 'object' &&
    obj.arguments !== null &&
    !Array.isArray(obj.arguments)
  ) {
    return obj.arguments as Record<string, unknown>;
  }
  if (typeof obj.arguments === 'string') {
    return parseJsonArgs(obj.arguments);
  }

  // Try nested `function.arguments`
  if (typeof obj.function === 'object' && obj.function !== null) {
    const func = obj.function as Record<string, unknown>;
    if (typeof func.arguments === 'string') {
      return parseJsonArgs(func.arguments);
    }
    if (
      typeof func.arguments === 'object' &&
      func.arguments !== null &&
      !Array.isArray(func.arguments)
    ) {
      return func.arguments as Record<string, unknown>;
    }
  }

  return {};
}

/**
 * Parse a JSON string into a Record, returning {} on failure.
 */
function parseJsonArgs(jsonString: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(jsonString);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid JSON - fallback to empty object
  }
  return {};
}

// ============================================================
// Validate LLM Response
// ============================================================

/**
 * Validate an LLM response with graceful degradation.
 *
 * Tier 1 validation: LLM output is UNTRUSTED external data.
 * - Try strict schema validation first (safeParse)
 * - On failure: degrade to usable state, NEVER crash
 * - Extract what we can from the malformed response
 *
 * @param raw - Untrusted LLM response data
 * @returns Valid LLMResponse (either fully validated or gracefully degraded)
 */
export function validateLLMResponse(raw: unknown): LLMResponse {
  const result = LLMResponseContractSchema.safeParse(raw);
  if (result.success) return result.data;

  // Validation failed → graceful degradation
  const obj = (raw ?? {}) as Record<string, unknown>;

  // Extract content
  const content = typeof obj.content === 'string' ? obj.content : '';

  // Extract toolCalls (check both camelCase and snake_case)
  const toolCalls = extractToolCallsField(obj);

  // Extract finishReason (check both camelCase and snake_case)
  const finishReason = extractFinishReasonValue(obj);

  return {
    content,
    toolCalls,
    finishReason,
    usage: undefined,
  };
}

/**
 * Extract toolCalls from a raw object, checking both camelCase and snake_case.
 */
function extractToolCallsField(obj: Record<string, unknown>): LLMResponse['toolCalls'] {
  // Check snake_case first (common in some LLM APIs)
  if (Array.isArray(obj.tool_calls)) {
    const calls = obj.tool_calls.map(extractToolCall);
    return calls.length > 0 ? calls : undefined;
  }
  // Then camelCase
  if (Array.isArray(obj.toolCalls)) {
    const calls = obj.toolCalls.map(extractToolCall);
    return calls.length > 0 ? calls : undefined;
  }
  return undefined;
}

/**
 * Extract finishReason from a raw object, checking both camelCase and snake_case.
 * Falls back to 'stop' if no valid reason is found.
 */
function extractFinishReasonValue(obj: Record<string, unknown>): LLMResponse['finishReason'] {
  // Check snake_case first
  if (typeof obj.finish_reason === 'string' && isValidFinishReason(obj.finish_reason)) {
    return obj.finish_reason;
  }
  // Then camelCase
  if (typeof obj.finishReason === 'string' && isValidFinishReason(obj.finishReason)) {
    return obj.finishReason;
  }
  return 'stop';
}
