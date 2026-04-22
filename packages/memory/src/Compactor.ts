import { Effect } from "effect";
import type { Message } from "@agentforge/core";
import { SessionError } from "@agentforge/core";
import type { CompressionConfig } from "./types";
import { 
  createKeepLatestStrategy, 
  createKeepToolResultsStrategy, 
  createSlidingWindowStrategy,
  type KeepLatestStrategyOptions,
  type KeepToolResultsStrategyOptions,
  type SlidingWindowStrategyOptions
} from "./compaction-strategies";

export interface ContextCompactor {
  /**
   * Compress messages to reduce token count
   */
  compress: (messages: Message[]) => Effect.Effect<Message[], SessionError>;
  
  /**
   * Extract key information from messages without full compression
   */
  extract: (messages: Message[]) => Effect.Effect<Message[], SessionError>;
  
  /**
   * Summarize messages into a single summary message
   */
  summarize: (messages: Message[]) => Effect.Effect<Message[], SessionError>;
}

/**
 * Create a ContextCompactor using KeepLatestStrategy
 */
export function createKeepLatestCompactor(
  options: KeepLatestStrategyOptions
): ContextCompactor {
  const strategy = createKeepLatestStrategy(options);

  return {
    compress: strategy,
    extract: strategy,
    summarize: (messages) => strategy(messages),
  };
}

/**
 * Create a ContextCompactor using KeepToolResultsStrategy
 */
export function createKeepToolResultsCompactor(
  options: KeepToolResultsStrategyOptions
): ContextCompactor {
  const strategy = createKeepToolResultsStrategy(options);

  return {
    compress: strategy,
    extract: strategy,
    summarize: (messages) => strategy(messages),
  };
}

/**
 * Create a ContextCompactor using SlidingWindowStrategy
 */
export function createSlidingWindowCompactor(
  options: SlidingWindowStrategyOptions
): ContextCompactor {
  const strategy = createSlidingWindowStrategy(options);

  return {
    compress: strategy,
    extract: strategy,
    summarize: (messages) => strategy(messages),
  };
}

/**
 * Convert a ContextCompactor to CompressionConfig for use with SessionManager.trim()
 */
export function compactorToCompressionConfig(
  compactor: ContextCompactor,
  thresholdTokens?: number
): CompressionConfig {
  return {
    compress: compactor.compress,
    thresholdTokens,
  };
}
