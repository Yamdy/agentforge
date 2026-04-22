import { Effect } from "effect";
import { type ZodType } from "zod";

export interface Tool<Params extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: ZodType<Params>;
  execute: (params: Params) => Effect.Effect<string, unknown, never>;
  category?: string;
  tags?: string[];
  examples?: ToolExample[];
  deprecated?: boolean;
  deprecationMessage?: string;
}

export interface ToolExample {
  input: Record<string, unknown>;
  output: unknown;
  description?: string;
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

export class ToolError extends Error {
  readonly _tag = "ToolError";
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class RegistryError extends Error {
  readonly _tag = "RegistryError";
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class ExecutorError extends Error {
  readonly _tag = "ExecutorError";
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export const TOOL_CATEGORIES = {
  FILESYSTEM: "filesystem",
  NETWORK: "network",
  SHELL: "shell",
  SEARCH: "search",
  CODE: "code",
  CUSTOM: "custom",
} as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[keyof typeof TOOL_CATEGORIES];
