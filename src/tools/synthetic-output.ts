/**
 * SyntheticOutputTool — enforces structured JSON output from LLMs.
 *
 * The LLM calls this tool with JSON data that must conform to a registered
 * output schema. The tool validates the output against registered Zod schemas
 * and returns the validated result (or structured validation errors).
 *
 * After the LLM calls this tool, the tool result is included in the next
 * LLM message, allowing the agent to see the validated structured output.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { createSyntheticOutputTool, registerOutputType } from './tools/index.js';
 *
 * const tool = createSyntheticOutputTool({
 *   weather: z.object({ temperature: z.number(), city: z.string() }),
 * });
 *
 * // Later: register more schemas dynamically
 * registerOutputType('stockQuote', z.object({ symbol: z.string(), price: z.number() }));
 * ```
 */

import { z } from 'zod';
import type { ToolDefinition } from '../core/interfaces.js';

// ============================================================
// Constants
// ============================================================

/** Tool name constant — always 'synthetic_output' */
export const SYNTHETIC_OUTPUT_TOOL_NAME = 'synthetic_output';

// ============================================================
// Zod Schema
// ============================================================

const SyntheticOutputArgs = z.object({
  output: z.any(),
});

// ============================================================
// Module-Level Schema Registry
// ============================================================

/**
 * Shared schema registry for synthetic output validation.
 *
 * Schemas registered here are used by ALL synthetic_output tool instances
 * to validate LLM output. This module-level registry enables the
 * `registerOutputType` helper to work without requiring a reference
 * to a specific tool instance.
 */
const outputSchemas = new Map<string, z.ZodTypeAny>();

// ============================================================
// Public API: registerOutputType
// ============================================================

/**
 * Register a named output type schema for structured output validation.
 *
 * After registration, the synthetic_output tool will validate LLM output
 * against this schema. If the output matches, it passes through. Otherwise,
 * a structured validation error is returned.
 *
 * @param name - Unique name for this output type (e.g., 'weatherReport')
 * @param schema - Zod schema to validate output against
 */
export function registerOutputType(name: string, schema: z.ZodTypeAny): void {
  if (outputSchemas.has(name)) {
    console.warn(`[synthetic-output] Output type "${name}" is being overwritten.`);
  }
  outputSchemas.set(name, schema);
}

/**
 * Check whether an output type schema is registered.
 *
 * @param name - The output type name to check
 * @returns true if a schema is registered under the given name
 */
export function hasOutputType(name: string): boolean {
  return outputSchemas.has(name);
}

/**
 * Clear all registered output type schemas.
 *
 * Primarily used in testing to reset state between test suites.
 */
export function clearOutputTypes(): void {
  outputSchemas.clear();
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create the synthetic_output tool.
 *
 * This tool enforces structured output from LLMs by validating JSON output
 * against registered Zod schemas. When the LLM calls this tool with structured
 * data, the tool validates it and returns the validated JSON (or error info).
 *
 * Without registered schemas, the tool acts as a pass-through,
 * echoing `JSON.stringify(output)`.
 *
 * @param schemas - Optional initial map of output type names to Zod schemas
 * @returns ToolDefinition for synthetic_output
 */
export function createSyntheticOutputTool(schemas?: Record<string, z.ZodTypeAny>): ToolDefinition {
  // Register initial schemas into the module-level registry
  if (schemas) {
    for (const [name, schema] of Object.entries(schemas)) {
      outputSchemas.set(name, schema);
    }
  }

  return {
    name: SYNTHETIC_OUTPUT_TOOL_NAME,
    description:
      'Output structured JSON data that conforms to a registered schema. ' +
      'Call this tool with the final structured output of your response. ' +
      'The output will be validated against registered schemas and returned ' +
      'to the agent. If validation fails, structured error details are returned.',
    parameters: SyntheticOutputArgs,
    requiresApproval: false,
    riskLevel: 'low',
    // eslint-disable-next-line @typescript-eslint/require-await
    execute: async (args: unknown): Promise<string> => {
      // Validate args structure first
      const parsed = SyntheticOutputArgs.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { output } = parsed.data;

      // No schemas registered → passthrough
      if (outputSchemas.size === 0) {
        return JSON.stringify(output) ?? 'undefined';
      }

      // Validate against all registered schemas
      const schemas = Array.from(outputSchemas.values());
      const results = schemas.map(s => s.safeParse(output));
      const passed = results.find(r => r.success);

      if (passed) {
        return JSON.stringify(output) ?? 'null';
      }

      // All schemas failed → return structured validation error
      const issues = results
        .filter(r => !r.success)
        .flatMap(r => r.error?.issues ?? [])
        .map(issue => ({
          path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
          message: issue.message,
          code: issue.code,
        }));

      return JSON.stringify({
        error: 'Validation failed',
        issues,
      });
    },
  };
}
