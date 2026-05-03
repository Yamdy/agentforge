/**
 * AgentForge Content Utilities
 *
 * Centralized utilities for accessing Message.content now that it supports
 * both plain strings and multimodal ContentPart[] arrays.
 *
 * All code that reads message content should use these utilities instead
 * of accessing `message.content` directly as a string.
 *
 * @module
 */

import { z } from 'zod';

// ============================================================
// ContentPart Schema (mirrors events.ts for dependency isolation)
// ============================================================

const ContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(['auto', 'low', 'high']).optional(),
    }),
  }),
]);

const MessageContentSchema = z.union([z.string(), z.array(ContentPartSchema)]);

// ============================================================
// Types
// ============================================================

/** A single content part (text or image_url) */
export type ContentPart = z.infer<typeof ContentPartSchema>;

/** Message content can be a plain string or an array of ContentParts */
export type MessageContent = z.infer<typeof MessageContentSchema>;

// ============================================================
// Type Guard
// ============================================================

/**
 * Type guard: check if message content is a ContentPart[] array.
 *
 * @example
 * ```typescript
 * if (isContentArray(msg.content)) {
 *   // msg.content is ContentPart[]
 *   for (const part of msg.content) { ... }
 * }
 * ```
 */
export function isContentArray(content: MessageContent): content is ContentPart[] {
  return Array.isArray(content);
}

// ============================================================
// Text Extraction
// ============================================================

/**
 * Extract all text from message content, concatening multiple text parts
 * with a space separator. Image parts are silently skipped.
 *
 * This is the SINGLE utility function for content access — all other code
 * that needs message content as a string should use this function.
 *
 * @param content - Message content (string or ContentPart[])
 * @returns Concatenated text from all text parts
 *
 * @example
 * ```typescript
 * // String content (backward compat)
 * extractText('Hello') // → 'Hello'
 *
 * // Text-only array
 * extractText([{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }]) // → 'A B'
 *
 * // Mixed array (images are skipped)
 * extractText([{ type: 'text', text: 'Hi' }, { type: 'image_url', image_url: { url: 'x' } }]) // → 'Hi'
 * ```
 */
export function extractText(content: MessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join(' ');
}

// ============================================================
// Image Detection
// ============================================================

/**
 * Check if message content contains any image parts.
 *
 * @param content - Message content (string or ContentPart[])
 * @returns true if content is an array with at least one image_url part
 *
 * @example
 * ```typescript
 * hasImages('Hello') // → false
 * hasImages([{ type: 'text', text: 'Hi' }]) // → false
 * hasImages([{ type: 'image_url', image_url: { url: 'x' } }]) // → true
 * hasImages([{ type: 'text', text: 'Hi' }, { type: 'image_url', image_url: { url: 'x' } }]) // → true
 * ```
 */
export function hasImages(content: MessageContent): boolean {
  if (typeof content === 'string') {
    return false;
  }
  return content.some(p => p.type === 'image_url');
}
