import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { Message } from "@agentforge/core";
import type { Session } from "@agentforge/core";
import { SessionError } from "@agentforge/core";
import type { Memory, CompressionConfig } from "./types";

export class InMemorySession implements Session {
  constructor(
    public readonly id: string,
    public messages: Message[],
    public systemPrompt?: string,
    public metadata?: Record<string, unknown>,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {}

  updateMessages(messages: Message[]): void {
    this.messages = messages;
    this.updatedAt = new Date();
  }

  addMessage(message: Message): void {
    this.messages.push({
      ...message,
      createdAt: new Date(),
    });
    this.updatedAt = new Date();
  }
}

export class InMemorySessionManager implements Memory<InMemorySession, string> {
  private sessions: Map<string, InMemorySession> = new Map();

  create(options: { 
    systemPrompt?: string; 
    initialMessages?: Message[];
    metadata?: Record<string, unknown>;
  } = {}): Effect.Effect<InMemorySession, never> {
    return Effect.sync(() => {
      const id = randomUUID();
      const session = new InMemorySession(
        id, 
        options.initialMessages || [], 
        options.systemPrompt,
        options.metadata
      );
      this.sessions.set(id, session);
      return session;
    });
  }

  get(id: string): Effect.Effect<InMemorySession | undefined, never> {
    return Effect.sync(() => this.sessions.get(id));
  }

  addMessage(sessionId: string, message: Message): Effect.Effect<InMemorySession, SessionError> {
    return Effect.sync(() => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new SessionError(`Session "${sessionId}" not found`);
      }
      session.addMessage(message);
      return session;
    });
  }

  delete(id: string): Effect.Effect<void, SessionError> {
    return Effect.sync(() => {
      if (!this.sessions.has(id)) {
        throw new SessionError(`Session "${id}" not found`);
      }
      this.sessions.delete(id);
    });
  }

  list(): Effect.Effect<InMemorySession[], never> {
    return Effect.sync(() => Array.from(this.sessions.values()));
  }

  /**
   * Default token estimator: ~4 chars = 1 token (GPT tokenization approx)
   */
  private defaultEstimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  trim(
    sessionId: string, 
    options?: { 
      maxMessages?: number; 
      maxTokens?: number;
      tokenizer?: (text: string) => number;
      compression?: CompressionConfig;
    }
  ): Effect.Effect<InMemorySession, SessionError, never> {
    return Effect.gen(function*(this: InMemorySessionManager) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new SessionError(`Session "${sessionId}" not found`);
      }

      const { 
        maxMessages, 
        maxTokens, 
        tokenizer = this.defaultEstimateTokens,
        compression,
      } = options || {};

      // If no constraints, no trimming needed
      if (!maxMessages && !maxTokens && !compression) {
        return session;
      }

      let { messages } = session;
      const originalSystemPrompt = session.systemPrompt;

      // First trim by message count if needed
      if (maxMessages && messages.length > maxMessages) {
        const keepCount = Math.min(maxMessages, messages.length);
        const startIdx = messages.length - keepCount;
        messages = messages.slice(startIdx);
      }

      // Calculate current total tokens
      let totalTokens = 0;
      for (const msg of messages) {
        totalTokens += tokenizer(msg.content);
      }

      // If we have compression configured and we're over threshold (or still over maxTokens after trimming)
      if (compression && (
        (compression.thresholdTokens && totalTokens > compression.thresholdTokens) ||
        (maxTokens && totalTokens > maxTokens)
      )) {
        // Use compression function to summarize messages
        const compressed: Message[] = yield compression.compress(messages);
        // If we have system prompt, keep it separate
        if (originalSystemPrompt) {
          session.systemPrompt = originalSystemPrompt;
        }
        session.updateMessages(compressed);
        return session;
      }

      // If no compression or already under limit after message trimming, just token trim
      if (maxTokens) {
        // Start from the end and accumulate until we hit maxTokens
        let totalTokens = 0;
        let keepFromIndex = 0;

        // Work backwards from the end to keep most recent messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const msgTokens = tokenizer(messages[i].content);
          if (totalTokens + msgTokens > maxTokens) {
            break;
          }
          totalTokens += msgTokens;
          keepFromIndex = i;
        }

        // Keep all messages from keepFromIndex onwards
        messages = messages.slice(keepFromIndex);
      }

      session.updateMessages(messages);
      return session;
    }.bind(this));
  }

  clear(): Effect.Effect<void, never> {
    return Effect.sync(() => {
      this.sessions.clear();
    });
  }
}