import type { Effect } from "effect";
import { type ZodType, type ZodSchema } from "zod";

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export interface Tool<Params extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: ZodType<Params>;
  execute: (params: Params) => Effect.Effect<string, unknown, never>;
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface Session {
  id: string;
  messages: Message[];
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SessionManager {
  create: (options?: CreateSessionOptions) => Effect.Effect<Session, never>;
  get: (id: string) => Effect.Effect<Session | undefined, never>;
  addMessage: (sessionId: string, message: Message) => Effect.Effect<Session, SessionError>;
}

export interface CreateSessionOptions {
  systemPrompt?: string;
  initialMessages?: Message[];
  metadata?: Record<string, unknown>;
}

export class SessionError {
  readonly _tag = "SessionError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}
