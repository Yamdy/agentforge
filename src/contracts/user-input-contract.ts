/**
 * User Input Contract - Tier 1 Validation
 *
 * Validates user input with graceful degradation.
 * User input is UNTRUSTED external data.
 * Never throws - always returns a valid string.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN.md - Tier 1: External Untrusted Data
 */

import { z } from 'zod';

// ============================================================
// Schema
// ============================================================

/**
 * Zod schema for user input contract.
 * Used for structured validation when input arrives as an object.
 */
export const UserInputSchema = z.object({
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// ============================================================
// Validate User Input
// ============================================================

/**
 * Validate user input with graceful degradation.
 *
 * Tier 1 validation: User input is UNTRUSTED external data.
 * - String and non-empty → return as-is
 * - Object with content string → extract content
 * - Everything else → return empty string (never throw)
 *
 * @param raw - Untrusted user input
 * @returns Validated string (empty string if input is invalid)
 */
export function validateUserInput(raw: unknown): string {
  // Direct string input
  if (typeof raw === 'string' && raw.length > 0) return raw;

  // Object with content field
  if (typeof raw === 'object' && raw !== null && 'content' in raw) {
    const content = (raw as { content: unknown }).content;
    if (typeof content === 'string' && content.length > 0) return content;
  }

  // Fallback: empty string (never throw)
  return '';
}
