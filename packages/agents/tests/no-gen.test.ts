import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  Message,
  SessionManager,
  InMemorySessionManager,
  type Session,
  SessionError,
} from "@agentforge/core";
import type { LLMProvider, LLMError } from "@agentforge/llm";

class MockLLMProvider implements LLMProvider {
  generate = vi.fn();
}

describe("No Gen Test", () => {
  let sessionManager: SessionManager;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    sessionManager = new InMemorySessionManager();
    llmProvider = new MockLLMProvider();
  });

  it("should work step by step with runPromise", async () => {
    llmProvider.generate.mockReturnValue(Effect.succeed("Hello!"));

    const session = await Effect.runPromise(
      sessionManager.create({
        systemPrompt: "You are helpful.",
      })
    );

    const withUserMessage = await Effect.runPromise(
      sessionManager.addMessage(session.id, {
        role: "user",
        content: "Hi!",
      })
    );

    const messagesToSend: Message[] = [
      { role: "system", content: "You are helpful." },
      ...withUserMessage.messages,
    ];

    const response = await Effect.runPromise(
      llmProvider.generate({
        messages: messagesToSend,
      })
    );

    const finalSession = await Effect.runPromise(
      sessionManager.addMessage(session.id, {
        role: "assistant",
        content: response,
      })
    );

    expect(response).toBe("Hello!");
    expect(finalSession.messages).toEqual([
      { role: "user", content: "Hi!" },
      { role: "assistant", content: "Hello!" },
    ]);
  });
});
