import { Effect } from "effect";
import type { Message } from "@agentforge/core";
import { SessionError } from "@agentforge/core";

export interface KeepLatestStrategyOptions {
  /**
   * Number of messages to keep (latest N messages)
   */
  keepCount: number;
  /**
   * Always keep the system prompt
   */
  keepSystemPrompt?: boolean;
}

/**
 * KeepLatestStrategy: Only keep the latest N messages
 */
export function createKeepLatestStrategy(
  options: KeepLatestStrategyOptions
): (messages: Message[]) => Effect.Effect<Message[], SessionError> {
  const { keepCount, keepSystemPrompt = true } = options;

  return (messages: Message[]): Effect.Effect<Message[], SessionError> => {
    return Effect.sync(() => {
      if (messages.length <= keepCount) {
        return messages;
      }

      let startIdx = Math.max(0, messages.length - keepCount);
      let keptMessages = messages.slice(startIdx);

      // If we're keeping system prompt and it got trimmed, add it back
      if (keepSystemPrompt) {
        const hasSystemPrompt = keptMessages.some(m => m.role === "system");
        if (!hasSystemPrompt) {
          const systemPromptMsg = messages.find(m => m.role === "system");
          if (systemPromptMsg) {
            keptMessages = [systemPromptMsg, ...keptMessages.slice(-keepCount + 1)];
          }
        }
      }

      return keptMessages;
    });
  };
}
