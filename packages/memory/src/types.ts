import type { Effect } from "effect";
import type { Message } from "@agentforge/core";
import { SessionError } from "@agentforge/core";

/**
 * Configuration for token-based trimming
 */
export interface TokenTrimmingConfig {
  /** Maximum total tokens allowed */
  maxTotalTokens: number;
  /** Tokenizer function that estimates token count from text */
  estimateTokens: (text: string) => number;
  /** Always keep the system prompt separately */
  keepSystemPrompt: boolean;
}

/**
 * Compression configuration for LLM-based summarization
 */
export interface CompressionConfig {
  /**
   * Compression function that takes the old messages and returns compressed messages
   * Use this to summarize long conversation history into fewer tokens
   * Return the compressed array of messages (usually a single summary message)
   */
  compress: (messages: Message[]) => Effect.Effect<Message[], SessionError>;
  /**
   * Only trigger compression when token count exceeds this threshold
   * If not provided, compression will only run when trimming still exceeds maxTokens
   */
  thresholdTokens?: number;
}

/**
 * Checkpointer stores state snapshots for time travel
 * @template TState The state type being checkpointed
 */
export interface Checkpointer<TState> {
  /**
   * Save a checkpoint
   * @param checkpointId Unique identifier for this checkpoint
   * @param state The state to save
   */
  save: (checkpointId: string, state: TState) => Effect.Effect<void, never>;

  /**
   * Get a checkpoint by ID
   * @param checkpointId The checkpoint identifier to retrieve
   */
  get: (checkpointId: string) => Effect.Effect<TState | undefined, never>;

  /**
   * List all checkpoints for a given thread/session
   * @param threadId The thread identifier
   */
  list: (threadId: string) => Effect.Effect<string[], never>;

  /**
   * Delete a checkpoint
   * @param checkpointId The checkpoint identifier to delete
   */
  delete: (checkpointId: string) => Effect.Effect<void, SessionError>;

  /**
   * Clear all checkpoints for a thread
   * @param threadId The thread identifier to clear
   */
  clear: (threadId: string) => Effect.Effect<void, SessionError>;
}

/**
 * Memory interface for agentforge
 * @template TSession Session type
 * @template TId Session identifier type
 */
export interface Memory<TSession, TId = string> {
  /**
   * Create a new session
   */
  create: (options?: { 
    systemPrompt?: string; 
    initialMessages?: Message[];
    metadata?: Record<string, unknown>;
  }) => Effect.Effect<TSession, never>;

  /**
   * Get an existing session by ID
   */
  get: (id: TId) => Effect.Effect<TSession | undefined, never>;

  /**
   * Add a message to a session
   */
  addMessage: (sessionId: TId, message: Message) => Effect.Effect<TSession, SessionError>;

  /**
   * Delete a session
   */
  delete: (id: TId) => Effect.Effect<void, SessionError>;

  /**
   * List all sessions
   */
  list: () => Effect.Effect<TSession[], never>;

  /**
   * Trim conversation history to keep token count under limit
   * Keeps the most recent messages, can optionally use LLM compression when still over limit
   */
  trim: (
    sessionId: TId, 
    options?: { 
      maxMessages?: number; 
      maxTokens?: number;
      tokenizer?: (text: string) => number;
      compression?: CompressionConfig;
    }
  ) => Effect.Effect<TSession, SessionError>;
}