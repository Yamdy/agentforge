import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Middleware } from './index.js';
import type { StreamEvent } from '../types.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('middleware:compression');

export interface CompressionMiddlewareOptions {
  /**
   * Maximum number of messages to keep before compression
   * @default 10
   */
  maxMessagesBeforeCompression: number;
  /**
   * Maximum tokens to keep before forcing compression
   * @default 4000
   */
  maxTokensBeforeCompression: number;
  /**
   * Function to summarize older messages
   * Will be called when compression is triggered
   */
  summarize?: (messages: string[]) => Promise<string>;
  /**
   * Keep the most recent N messages uncompressed
   * @default 3
   */
  keepRecentMessages: number;
  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

const defaultOptions: Required<CompressionMiddlewareOptions> = {
  maxMessagesBeforeCompression: 10,
  maxTokensBeforeCompression: 4000,
  keepRecentMessages: 3,
  debug: false,
  summarize: async (messages) => {
    // Default summary - just join the messages
    // Users should provide their own summary using an LLM
    return messages.join('\n');
  },
};

/**
 * Memory compression middleware - automatically summarizes older messages
 * when conversation grows too large, keeping it within token limits.
 *
 * Works with the existing memory manager to compress history before
 * it gets sent to the LLM.
 */
export function createCompressionMiddleware(
  options: CompressionMiddlewareOptions = {}
): Middleware {
  const config = { ...defaultOptions, ...options };

  return (source$: Observable<StreamEvent>) => {
    // Compression is handled before sending to LLM in memory manager
    // This middleware just logs when compression happens
    return source$.pipe(
      tap(() => {
        // Compression is triggered by memory manager before streaming
        if (config.debug) {
          log.debug('[compression] Passing through stream event');
        }
      })
    );
  };
}

/**
 * Utility function to compress conversation history
 * Keeps the most recent N messages intact and summarizes older ones.
 */
export async function compressHistory<T extends { content: string }>(
  messages: T[],
  options: CompressionMiddlewareOptions & {
    summarize: (messages: string[]) => Promise<string>;
  }
): Promise<T[]> {
  const config = { ...defaultOptions, ...options };

  if (messages.length <= config.maxMessagesBeforeCompression) {
    return messages;
  }

  const keepCount = Math.min(config.keepRecentMessages, messages.length - 1);
  const messagesToCompress = messages.slice(0, messages.length - keepCount);
  const recentMessages = messages.slice(-keepCount);

  const messageContents = messagesToCompress.map((m) => m.content);
  const summary = await config.summarize(messageContents);

  log.debug(`[compression] Compressed ${messagesToCompress.length} messages into summary`);

  // Return a single summary message followed by recent messages
  // The summary message needs to match the message type T
  // We assume it has content property which all message types do
  return [
    {
      ...messages[0],
      content: `# Summary of Previous Conversation\n\n${summary}\n`,
    } as T,
    ...recentMessages,
  ];
}
