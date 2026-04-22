import { Effect } from "effect";
import type { Message } from "@agentforge/core";
import { SessionError } from "@agentforge/core";

export interface SlidingWindowStrategyOptions {
  /**
   * Maximum number of tokens allowed
   */
  maxTokens: number;
  /**
   * Tokenizer function to count tokens
   */
  tokenizer: (text: string) => number;
  /**
   * Always keep the system prompt
   */
  keepSystemPrompt?: boolean;
  /**
   * Always keep tool call/result pairs together
   */
  keepToolPairs?: boolean;
}

/**
 * SlidingWindowStrategy: Keep messages while under token limit, oldest first removed
 */
export function createSlidingWindowStrategy(
  options: SlidingWindowStrategyOptions
): (messages: Message[]) => Effect.Effect<Message[], SessionError> {
  const { 
    maxTokens, 
    tokenizer, 
    keepSystemPrompt = true, 
    keepToolPairs = true 
  } = options;

  return (messages: Message[]): Effect.Effect<Message[], SessionError> => {
    return Effect.sync(() => {
      // Separate system prompt if we're keeping it
      let systemMessage: Message | undefined;
      let otherMessages: Message[] = [];

      if (keepSystemPrompt) {
        const sysMsg = messages.find(m => m.role === "system");
        if (sysMsg) {
          systemMessage = sysMsg;
          otherMessages = messages.filter(m => m.role !== "system");
        } else {
          otherMessages = [...messages];
        }
      } else {
        otherMessages = [...messages];
      }

      // If we're keeping tool pairs, first identify them
      let processedMessages: Message[] = [...otherMessages];
      
      if (keepToolPairs) {
        // Mark tool pairs to keep them together
        const keepTogether = new Set<number>();
        for (let i = 0; i < otherMessages.length - 1; i++) {
          if (otherMessages[i].role === "assistant" && 
              otherMessages[i + 1].role === "tool") {
            keepTogether.add(i);
            keepTogether.add(i + 1);
          }
        }
      }

      // Calculate total tokens and remove oldest messages until we're under limit
      let totalTokens = 0;
      const keptMessages: Message[] = [];

      // Start from the end (newest messages) and work backwards
      for (let i = processedMessages.length - 1; i >= 0; i--) {
        const msg = processedMessages[i];
        const msgTokens = tokenizer(msg.content);

        // Check if adding this message would exceed the limit
        if (totalTokens + msgTokens > maxTokens) {
          // If we're keeping tool pairs, check if the previous message is part of a pair
          if (keepToolPairs && i > 0 && 
              msg.role === "tool" && 
              processedMessages[i - 1].role === "assistant") {
            // Don't break, but also don't add - we need to skip both
            continue;
          }
          break;
        }

        totalTokens += msgTokens;
        keptMessages.unshift(msg); // Add to beginning to preserve order

        // If this is a tool result, also add the preceding tool call if we're keeping pairs
        if (keepToolPairs && i > 0 && 
            msg.role === "tool" && 
            processedMessages[i - 1].role === "assistant") {
          const toolCallTokens = tokenizer(processedMessages[i - 1].content);
          if (totalTokens + toolCallTokens <= maxTokens) {
            totalTokens += toolCallTokens;
            keptMessages.unshift(processedMessages[i - 1]);
          }
        }
      }

      // Build final result
      const result: Message[] = [];
      if (systemMessage) {
        result.push(systemMessage);
      }
      result.push(...keptMessages);

      return result;
    });
  };
}
