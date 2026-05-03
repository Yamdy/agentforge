/**
 * Unit tests for src/core/content-utils.ts
 *
 * Tests extractText, hasImages, isContentArray, and MessageSchema
 * backward compatibility with multimodal ContentPart[] support.
 */

import { describe, it, expect } from 'vitest';
import { extractText, hasImages, isContentArray } from '../../src/core/content-utils.js';
import type { ContentPart, MessageContent } from '../../src/core/content-utils.js';
import { MessageSchema } from '../../src/core/events.js';

// ============================================================
// extractText
// ============================================================

describe('extractText', () => {
  it('should return string content as-is (backward compat)', () => {
    expect(extractText('Hello world')).toBe('Hello world');
  });

  it('should return empty string for empty string content', () => {
    expect(extractText('')).toBe('');
  });

  it('should concat text-only array parts with space separator', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'world' },
    ];
    expect(extractText(content)).toBe('Hello world');
  });

  it('should skip image_url parts and only return text', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'Look at this:' },
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      { type: 'text', text: 'What do you see?' },
    ];
    expect(extractText(content)).toBe('Look at this: What do you see?');
  });

  it('should return empty string for image-only array', () => {
    const content: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
      { type: 'image_url', image_url: { url: 'https://example.com/b.png', detail: 'high' } },
    ];
    expect(extractText(content)).toBe('');
  });

  it('should handle empty array', () => {
    expect(extractText([])).toBe('');
  });
});

// ============================================================
// hasImages
// ============================================================

describe('hasImages', () => {
  it('should return false for string content', () => {
    expect(hasImages('Hello world')).toBe(false);
  });

  it('should return false for text-only ContentPart[]', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'world' },
    ];
    expect(hasImages(content)).toBe(false);
  });

  it('should return true for image-only ContentPart[]', () => {
    const content: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
    ];
    expect(hasImages(content)).toBe(true);
  });

  it('should return true for mixed ContentPart[] with image', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'See this:' },
      { type: 'image_url', image_url: { url: 'https://example.com/img.png', detail: 'auto' } },
    ];
    expect(hasImages(content)).toBe(true);
  });

  it('should return false for empty array', () => {
    expect(hasImages([])).toBe(false);
  });
});

// ============================================================
// isContentArray
// ============================================================

describe('isContentArray', () => {
  it('should return true for ContentPart[]', () => {
    const content: MessageContent = [
      { type: 'text', text: 'Hello' },
    ];
    expect(isContentArray(content)).toBe(true);
  });

  it('should return false for string content', () => {
    expect(isContentArray('hello')).toBe(false);
  });

  it('should return true for empty array', () => {
    expect(isContentArray([])).toBe(true);
  });

  it('should correctly narrow type when used in branch', () => {
    const content: MessageContent = 'hello';
    if (isContentArray(content)) {
      // content narrowed to ContentPart[]
      const text = content.map(p => (p.type === 'text' ? p.text : '')).join('');
      expect(text).toBe('');
    } else {
      // content narrowed to string
      expect(content).toBe('hello');
    }
  });
});

// ============================================================
// MessageSchema Backward Compatibility
// ============================================================

describe('MessageSchema backward compatibility', () => {
  it('should validate messages with string content (backward compat)', () => {
    const msg = {
      role: 'user',
      content: 'Hello world',
    };
    const result = MessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('Hello world');
    }
  });

  it('should validate messages with ContentPart[] content', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text' as const, text: 'Look at this image:' },
        { type: 'image_url' as const, image_url: { url: 'https://example.com/img.png', detail: 'auto' as const } },
      ],
    };
    const result = MessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should reject ContentPart with invalid type', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'invalid_type', text: 'Hello' },
      ],
    };
    const result = MessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('should reject ContentPart missing required fields', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'image_url' }, // missing image_url.url
      ],
    };
    const result = MessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('should validate assistant message with string content', () => {
    const msg = {
      role: 'assistant',
      content: 'I am an AI assistant.',
    };
    const result = MessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should validate tool message with string content', () => {
    const msg = {
      role: 'tool',
      content: 'Execution completed successfully.',
      toolCallId: 'tc-123',
      name: 'bash',
    };
    const result = MessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should validate ContentPart with image_url and high detail', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text' as const, text: 'Analyze this image' },
        {
          type: 'image_url' as const,
          image_url: {
            url: 'https://example.com/highres.png',
            detail: 'high' as const,
          },
        },
      ],
    };
    const result = MessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should reject ContentPart with invalid detail value', () => {
    const msg = {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/img.png',
            detail: 'ultra', // invalid — must be auto|low|high
          },
        },
      ],
    };
    const result = MessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });
});
