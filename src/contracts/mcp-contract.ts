/**
 * MCP Response Contract - Tier 1 Validation
 *
 * Validates MCP (Model Context Protocol) responses with graceful degradation.
 * MCP servers are external processes - their responses are UNTRUSTED.
 * Never throws - always returns a usable MCPToolResponse.
 *
 */

import { z } from 'zod';

// ============================================================
// Schema
// ============================================================

/**
 * Zod schema for MCP tool response contract.
 * Validates structure of MCP server responses at the adapter boundary.
 */
export const MCPToolResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.enum(['text', 'image', 'resource']),
      text: z.string().optional(),
      data: z.string().optional(),
      mimeType: z.string().optional(),
    })
  ),
  isError: z.boolean().default(false),
});

/**
 * Inferred MCPToolResponse type from the contract schema.
 */
export type MCPToolResponse = z.infer<typeof MCPToolResponseSchema>;

// ============================================================
// Validate MCP Response
// ============================================================

/**
 * Validate an MCP tool response with graceful degradation.
 *
 * Tier 1 validation: MCP responses are UNTRUSTED external data.
 * - Try strict schema validation first (safeParse)
 * - On failure: wrap any value as text content, NEVER crash
 *
 * @param raw - Untrusted MCP response data
 * @returns Valid MCPToolResponse (either fully validated or gracefully degraded)
 */
export function validateMCPResponse(raw: unknown): MCPToolResponse {
  const result = MCPToolResponseSchema.safeParse(raw);
  if (result.success) return result.data;

  // Degradation: wrap any value as text content
  // Note: JSON.stringify(undefined) returns undefined (not a string),
  // so we fall back to String() for values that JSON can't serialize.
  const text = typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? String(raw));

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    isError: false,
  };
}
