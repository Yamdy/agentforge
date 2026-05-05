/**
 * Streaming utilities shared across all LLM adapters.
 *
 * Maps AI SDK v6 fullStream parts to AgentForge LLMChunk for
 * streaming tool execution support (P2-13).
 */

import type { LLMChunk, LLMUsage } from '../core/interfaces.js';

function toLLMUsage(usage: { promptTokens: number; completionTokens: number }): LLMUsage {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  };
}

/** Map AI SDK finish reasons to AgentForge equivalents. */
function mapAIFinishReason(
  reason: string
): 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled' {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool-calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'stop';
  }
}

/**
 * Narrow a fullStream part to a shape with known keys.
 *
 * Uses a type assertion because the AI SDK v6 fullStream parts are
 * discriminated unions on `type` that TypeScript cannot narrow from
 * a generic `{ type: string }` index signature. The cast is safe at
 * runtime because the caller checks `part.type` against known literal
 * values before calling this function.
 */
function asPart<T>(part: { type: string; [key: string]: unknown }): T {
  return part as unknown as T;
}

/**
 * Iterate AI SDK fullStream and yield AgentForge LLMChunk events.
 */
export async function* fullStreamToChunks(
  fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>
): AsyncGenerator<LLMChunk> {
  for await (const part of fullStream) {
    switch (part.type) {
      case 'text-delta':
        yield { text: part.text as string };
        break;
      case 'tool-input-start':
        yield {
          toolCallId: part.id as string,
          toolName: part.toolName as string,
          toolCallStart: true,
        };
        break;
      case 'tool-input-delta':
        yield {
          toolCallId: part.id as string,
          argsDelta: part.delta as string,
        };
        break;
      case 'tool-input-end':
        yield { toolCallId: part.id as string, toolCallEnd: true };
        break;
      case 'tool-call': {
        const tc = asPart<{ toolCallId: string; toolName: string; args: unknown }>(part);
        yield {
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          argsDelta: JSON.stringify(tc.args),
          toolCallEnd: true,
        };
        break;
      }
      case 'finish': {
        const f = asPart<{
          finishReason: string;
          totalUsage: { promptTokens: number; completionTokens: number };
        }>(part);
        yield {
          finishReason: mapAIFinishReason(f.finishReason),
          usage: toLLMUsage(f.totalUsage),
        };
        break;
      }
      case 'finish-step': {
        const fs = asPart<{
          finishReason: string;
          usage: { promptTokens: number; completionTokens: number };
        }>(part);
        yield {
          finishReason: mapAIFinishReason(fs.finishReason),
          usage: toLLMUsage(fs.usage),
        };
        break;
      }
      // Silently skip all other stream part types
    }
  }
}
