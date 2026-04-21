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
import { ChatAgent } from "../src";

// Mock LLM Provider
class MockLLMProvider implements LLMProvider {
  generate = vi.fn();
}

describe("Chat Agent", () => {
  let sessionManager: SessionManager;
  let llmProvider: MockLLMProvider;
  let chatAgent: ChatAgent;

  beforeEach(async () => {
    sessionManager = new InMemorySessionManager();
    llmProvider = new MockLLMProvider();

    // Use static create method instead of direct constructor
    chatAgent = await ChatAgent.create({
      sessionManager,
      llmProvider,
      systemPrompt: "You are a helpful assistant.",
    });
  });

  it("should send a message and get a response", async () => {
    llmProvider.generate.mockReturnValue(
      Effect.succeed({ text: "Hello, how can I help you?" })
    );

    const response = await Effect.runPromise(
      chatAgent.sendMessage("Hi there!")
    );

    expect(response).toBe("Hello, how can I help you?");
    expect(llmProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hi there!" },
        ],
      })
    );
  });

  it("should maintain conversation history across multiple messages", async () => {
    llmProvider.generate
      .mockReturnValueOnce(Effect.succeed({ text: "First response" }))
      .mockReturnValueOnce(Effect.succeed({ text: "Second response" }));

    await Effect.runPromise(chatAgent.sendMessage("First message"));
    const secondResponse = await Effect.runPromise(
      chatAgent.sendMessage("Second message")
    );

    expect(secondResponse).toBe("Second response");
    expect(llmProvider.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "First message" },
          { role: "assistant", content: "First response" },
          { role: "user", content: "Second message" },
        ],
      })
    );
  });

  it("should store all messages in session", async () => {
    llmProvider.generate.mockReturnValue(Effect.succeed({ text: "Test response" }));

    await Effect.runPromise(chatAgent.sendMessage("Test message"));
    const session = await Effect.runPromise(chatAgent.getSession());

    expect(session.messages).toEqual([
      { role: "user", content: "Test message" },
      { role: "assistant", content: "Test response" },
    ]);
  });
  
  it("should send a message and get a response", async () => {
    llmProvider.generate.mockReturnValue(
      Effect.succeed({ text: "Hello, how can I help you?" })
    );

    const response = await Effect.runPromise(
      chatAgent.sendMessage("Hi there!")
    );

    expect(response).toBe("Hello, how can I help you?");
    expect(llmProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hi there!" },
        ],
      })
    );
  });

  it("should maintain conversation history across multiple messages", async () => {
    llmProvider.generate
      .mockReturnValueOnce(Effect.succeed({ text: "First response" }))
      .mockReturnValueOnce(Effect.succeed({ text: "Second response" }));

    await Effect.runPromise(chatAgent.sendMessage("First message"));
    const secondResponse = await Effect.runPromise(
      chatAgent.sendMessage("Second message")
    );

    expect(secondResponse).toBe("Second response");
    expect(llmProvider.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "First message" },
          { role: "assistant", content: "First response" },
          { role: "user", content: "Second message" },
        ],
      })
    );
  });

  it("should store all messages in the session", async () => {
    llmProvider.generate.mockReturnValue(Effect.succeed({ text: "Test response" }));

    await Effect.runPromise(chatAgent.sendMessage("Test message"));
    const session = await Effect.runPromise(chatAgent.getSession());

    expect(session.messages).toEqual([
      { role: "user", content: "Test message" },
      { role: "assistant", content: "Test response" },
    ]);
  });
});
