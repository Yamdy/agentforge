import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  Session,
  SessionManager,
  CreateSessionOptions,
  SessionError,
  Message,
  InMemorySessionManager,
} from "../src";

describe("Session System", () => {
  let manager: InMemorySessionManager;

  beforeEach(() => {
    manager = new InMemorySessionManager();
  });

  it("should create a new session", async () => {
    const session = await Effect.runPromise(manager.create());
    expect(session.id).toBeTruthy();
    expect(session.messages).toEqual([]);
    expect(session.systemPrompt).toBeUndefined();
  });

  it("should create a session with initial messages", async () => {
    const initialMessages: Message[] = [
      { role: "user", content: "Hello" },
    ];
    const session = await Effect.runPromise(
      manager.create({ initialMessages })
    );
    expect(session.messages).toEqual(initialMessages);
  });

  it("should create a session with system prompt", async () => {
    const systemPrompt = "You are a helpful assistant.";
    const session = await Effect.runPromise(
      manager.create({ systemPrompt })
    );
    expect(session.systemPrompt).toBe(systemPrompt);
  });

  it("should get an existing session", async () => {
    const created = await Effect.runPromise(manager.create());
    const retrieved = await Effect.runPromise(manager.get(created.id));
    expect(retrieved).toEqual(created);
  });

  it("should return undefined for non-existent session", async () => {
    const retrieved = await Effect.runPromise(manager.get("non-existent"));
    expect(retrieved).toBeUndefined();
  });

  it("should add a message to a session", async () => {
    const created = await Effect.runPromise(manager.create());
    const message: Message = { role: "user", content: "Test message" };
    const updated = await Effect.runPromise(
      manager.addMessage(created.id, message)
    );
    expect(updated.messages).toEqual([message]);
  });

  it("should throw error when adding message to non-existent session", async () => {
    const message: Message = { role: "user", content: "Test message" };
    await expect(
      Effect.runPromise(manager.addMessage("non-existent", message))
    ).rejects.toThrow(SessionError);
  });

  it("should preserve existing messages when adding new one", async () => {
    const initial: Message[] = [
      { role: "user", content: "First message" },
    ];
    const created = await Effect.runPromise(
      manager.create({ initialMessages: initial })
    );
    const newMessage: Message = { role: "assistant", content: "Response" };
    const updated = await Effect.runPromise(
      manager.addMessage(created.id, newMessage)
    );
    expect(updated.messages).toEqual([...initial, newMessage]);
  });
});
