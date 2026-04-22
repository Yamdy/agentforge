import { Effect } from "effect";
import type { Tool, ToolCall, ToolResult } from "./types";
import { ToolRegistry } from "./ToolRegistry";

export class ExecutorError extends Error {
  readonly _tag = "ExecutorError";
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export interface ToolExecutor {
  execute(
    toolCalls: ToolCall[],
    registry: ToolRegistry
  ): Effect.Effect<ToolResult[], unknown>;
  executeSingle(
    toolCall: ToolCall,
    registry: ToolRegistry
  ): Effect.Effect<ToolResult, unknown>;
}

export class DefaultToolExecutor implements ToolExecutor {
  execute(
    toolCalls: ToolCall[],
    registry: ToolRegistry
  ): Effect.Effect<ToolResult[], unknown> {
    return Effect.all(
      toolCalls.map((tc) => this.executeSingle(tc, registry))
    );
  }

  executeSingle(
    toolCall: ToolCall,
    registry: ToolRegistry
  ): Effect.Effect<ToolResult, unknown> {
    const tool = registry.get(toolCall.name);
    if (!tool) {
      return Effect.fail(new ExecutorError(`Tool not found: ${toolCall.name}`));
    }

    const parameters = toolCall.parameters ?? {};
    return Effect.map(tool.execute(parameters), (content) => ({
      callId: toolCall.id,
      name: toolCall.name,
      content,
      isError: false,
    }));
  }
}

