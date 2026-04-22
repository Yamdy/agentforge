import { Effect } from "effect";
import type { Message } from "@agentforge/core";
import { SessionError } from "@agentforge/core";

export interface KeepToolResultsStrategyOptions {
  /**
   * Number of regular messages to keep (excluding tool results)
   */
  keepRegularCount: number;
  /**
   * Always keep tool call and tool result message pairs together
   */
  keepToolPairs?: boolean;
  /**
   * Always keep the system prompt
   */
  keepSystemPrompt?: boolean;
}

/**
 * KeepToolResultsStrategy: Keep tool call/result pairs plus latest regular messages
 */
export function createKeepToolResultsStrategy(
  options: KeepToolResultsStrategyOptions
): (messages: Message[]) => Effect.Effect<Message[], SessionError> {
  const { keepRegularCount, keepToolPairs = true, keepSystemPrompt = true } = options;

  return (messages: Message[]): Effect.Effect<Message[], SessionError> => {
    return Effect.sync(() => {
      // First, find all tool-related message pairs
      const toolPairs: Array<{ toolCall: Message; toolResult: Message }> = [];
      const regularMessages: Message[] = [];
      const systemMessage: Message | undefined = keepSystemPrompt 
        ? messages.find(m => m.role === "system") 
        : undefined;

      // Scan messages to separate tool pairs and regular messages
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        
        if (msg.role === "system") {
          continue; // System prompt handled separately
        }
        
        // Check if this is a tool call followed by a tool result
        if (i < messages.length - 1 && 
            msg.role === "assistant" && 
            messages[i + 1].role === "tool") {
          toolPairs.push({
            toolCall: msg,
            toolResult: messages[i + 1]
          });
          i++; // Skip the tool result since we paired it
        } else if (msg.role === "tool" && keepToolPairs) {
          // This is an orphaned tool result, keep it if we're keeping pairs
          regularMessages.push(msg);
        } else {
          regularMessages.push(msg);
        }
      }

      // Build the compressed message list
      const compressedMessages: Message[] = [];

      if (systemMessage) {
        compressedMessages.push(systemMessage);
      }

      // Add all tool pairs
      for (const pair of toolPairs) {
        compressedMessages.push(pair.toolCall);
        compressedMessages.push(pair.toolResult);
      }

      // Add the latest regular messages
      const startIdx = Math.max(0, regularMessages.length - keepRegularCount);
      compressedMessages.push(...regularMessages.slice(startIdx));

      return compressedMessages;
    });
  };
}
