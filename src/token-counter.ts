/**
 * AgentForge Token Counter
 *
 * Accurate token counting using js-tiktoken (OpenAI's BPE tokenizer).
 * Replaces the crude 3-4 chars/token heuristic with actual tokenization.
 *
 * Features:
 * - Accurate token counting for OpenAI models
 * - Caching for performance
 * - Fallback to heuristic for non-OpenAI models
 * - Support for multiple encodings
 *
 * @module
 */

import { encodingForModel, type TiktokenModel } from 'js-tiktoken';
import type { Message } from './core/events.js';

// ============================================================
// Types
// ============================================================

export type ModelEncoding =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  | 'claude' // Approximation for Claude models
  | 'default';

export interface TokenCounterConfig {
  /** Model to use for encoding */
  model?: ModelEncoding;
  /** Whether to cache encodings */
  cacheEnabled?: boolean;
  /** Maximum cache size */
  cacheSize?: number;
}

// ============================================================
// Token Counter Class
// ============================================================

/**
 * Accurate token counter using BPE tokenization.
 *
 * Uses js-tiktoken for OpenAI models and falls back to
 * a heuristic for other models.
 *
 * @example
 * ```typescript
 * const counter = new TokenCounter({ model: 'gpt-4o' });
 * const tokens = counter.countTokens('Hello, world!');
 * console.log(tokens); // 4
 *
 * const messageTokens = counter.countMessageTokens([
 *   { role: 'user', content: 'Hello' },
 *   { role: 'assistant', content: 'Hi there!' },
 * ]);
 * ```
 */
export class TokenCounter {
  private encoder: ReturnType<typeof encodingForModel> | null = null;
  private readonly model: ModelEncoding;
  private readonly cacheEnabled: boolean;
  private readonly cache: Map<string, number>;
  private readonly cacheSize: number;

  constructor(config: TokenCounterConfig = {}) {
    this.model = config.model ?? 'default';
    this.cacheEnabled = config.cacheEnabled ?? true;
    this.cacheSize = config.cacheSize ?? 1000;
    this.cache = new Map();

    // Initialize encoder for OpenAI models
    if (this.model !== 'default' && this.model !== 'claude') {
      try {
        this.encoder = encodingForModel(this.model as TiktokenModel);
      } catch {
        // Fallback to heuristic if model not supported
        this.encoder = null;
      }
    }
  }

  /**
   * Count tokens in a text string.
   *
   * @param text - Text to count tokens for
   * @returns Number of tokens
   */
  countTokens(text: string): number {
    if (!text) return 0;

    // Check cache
    if (this.cacheEnabled) {
      const cached = this.cache.get(text);
      if (cached !== undefined) return cached;
    }

    let count: number;

    if (this.encoder) {
      // Use accurate BPE tokenization
      count = this.encoder.encode(text).length;
    } else {
      // Fallback heuristic: ~4 chars per token for English, ~2 for Chinese
      count = this.heuristicCount(text);
    }

    // Update cache
    if (this.cacheEnabled) {
      if (this.cache.size >= this.cacheSize) {
        // Remove oldest entry
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
        }
      }
      this.cache.set(text, count);
    }

    return count;
  }

  /**
   * Count tokens in a message.
   *
   * Includes overhead for role and formatting (~4 tokens per message).
   *
   * @param message - Message to count tokens for
   * @returns Number of tokens including overhead
   */
  countMessageTokens(message: Message): number {
    const contentTokens = this.countTokens(message.content);
    // Add overhead for role, formatting, and separators
    const overhead = 4;
    return contentTokens + overhead;
  }

  /**
   * Count total tokens in an array of messages.
   *
   * @param messages - Array of messages
   * @returns Total token count
   */
  countMessagesTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + this.countMessageTokens(m), 0);
  }

  /**
   * Estimate tokens for a text string (alias for countTokens).
   *
   * @param text - Text to estimate
   * @returns Estimated token count
   */
  estimateTokens(text: string): number {
    return this.countTokens(text);
  }

  /**
   * Clear the token cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { size: number; maxSize: number; enabled: boolean } {
    return {
      size: this.cache.size,
      maxSize: this.cacheSize,
      enabled: this.cacheEnabled,
    };
  }

  /**
   * Heuristic token count fallback.
   *
   * Uses different ratios for English (~4 chars/token) and
   * Chinese/CJK characters (~1.5 chars/token).
   */
  private heuristicCount(text: string): number {
    let count = 0;
    let cjkCount = 0;
    let nonCjkCount = 0;

    for (const char of text) {
      if (this.isCJK(char)) {
        cjkCount++;
      } else {
        nonCjkCount++;
      }
    }

    // CJK: ~1.5 chars per token
    count += Math.ceil(cjkCount / 1.5);
    // Non-CJK: ~4 chars per token
    count += Math.ceil(nonCjkCount / 4);

    return count;
  }

  /**
   * Check if a character is CJK (Chinese, Japanese, Korean).
   */
  private isCJK(char: string): boolean {
    const code = char.charCodeAt(0);
    return (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols and Punctuation
      (code >= 0xff00 && code <= 0xffef) // Halfwidth and Fullwidth Forms
    );
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let defaultCounter: TokenCounter | null = null;

/**
 * Get the default token counter instance.
 *
 * @param config - Optional configuration
 * @returns TokenCounter instance
 */
export function getTokenCounter(config?: TokenCounterConfig): TokenCounter {
  if (!defaultCounter || config) {
    defaultCounter = new TokenCounter(config);
  }
  return defaultCounter;
}

/**
 * Convenience function to count tokens in text.
 *
 * @param text - Text to count tokens for
 * @param model - Optional model to use
 * @returns Number of tokens
 */
export function countTokens(text: string, model?: ModelEncoding): number {
  const counter = getTokenCounter(model ? { model } : undefined);
  return counter.countTokens(text);
}

/**
 * Convenience function to count tokens in messages.
 *
 * @param messages - Messages to count tokens for
 * @param model - Optional model to use
 * @returns Total token count
 */
export function countMessagesTokens(messages: Message[], model?: ModelEncoding): number {
  const counter = getTokenCounter(model ? { model } : undefined);
  return counter.countMessagesTokens(messages);
}

// ============================================================
// Backward Compatibility
// ============================================================

/**
 * @deprecated Use countTokens() or TokenCounter instead
 */
export function estimateTokens(messages: Message[]): number {
  return countMessagesTokens(messages);
}

/**
 * @deprecated Use countTokens() or TokenCounter instead
 */
export function estimateMessageTokens(message: Message): number {
  const counter = getTokenCounter();
  return counter.countMessageTokens(message);
}
