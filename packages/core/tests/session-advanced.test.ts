import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import {
  InMemorySessionManager,
  type Session,
  SessionError,
} from "@agentforge/core";

describe("SessionManager - Fork", () => {
  let sessionManager: InMemorySessionManager;

  beforeEach(() => {
    sessionManager = new InMemorySessionManager();
  });

  it("should fork a session and copy messages", async () => {
    const originalSession = await Effect.runPromise(
      sessionManager.create({
        systemPrompt: "You are helpful.",
        initialMessages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      })
    );

    const forkedSession = await Effect.runPromise(
(
      sessionManager.fork!(originalSession.id)
    );

    expect(forkedSession.id).not.toBe(originalSession.id);
    expect(forkedSession.parentId).toBe(originalSession.id);
    expect(forkedSession.messages).toEqual(originalSession.messages);
    expect(forkedSession.systemPrompt).toBe(originalSession.systemPrompt);
  });

  it("should use custom title in forked session", async () => {
    const originalSession = await Effect.runPromise(
      sessionManager.create({
        metadata: { title: "Original Session" },
      })
    );

    const forkedSession = await Effect.runPromise(
      sessionManager.fork!(originalSession.id, { title: "Custom Fork Title" })
    );

    expect((forkedSession.metadata as any).title).toBe("Custom Fork Title");
  });

  it("should throw error when forking non-existent session", async () => {
    await expect(
      Effect.runPromise(sessionManager.fork!("non-existent"))
    ).rejects.toThrow(SessionError);
  });
});

describe("SessionManager - Time Travel", () => {
  let sessionManager: InMemorySessionManager;

  beforeEach(() => {
    sessionManager = new InMemorySessionManager();
  });

  it("should restore session from checkpoint with revert field", async () => {
    const originalSession = await Effect.runPromise(
      sessionManager.create({
        initialMessages: [
          { role: "user", content: "Message 1" },
          { role: "assistant", content: "Response 1" },
        ],
      })
    );

    // Add a message
    const updatedSession = await Effect.runPromise(
      session
      manager.addMessage(originalSession.id, {
        role: "user",
        content: "Message 2",
      })
    );
    expect(updatedSession.messages.length).toBe(2);

    // Restore to checkpoint
    const checkpointId = "checkpoint-123";
    const restoredSession = await Effect.runPromise(
      sessionManager.restoreToCheckpoint!(originalSession.id, checkpointId)
    );

    expect(restoredSession.revert?.checkpointId).toBe(checkpointId);
    expect(restoredSession.revert?.description).toBe("Restored from checkpoint");
    expect(restoredSession.updatedAt).toBeInstanceOf(Date);
  });

  it("should preserve session system prompt after restore", async () => {
    const session = await Effect.runPromise(
      sessionManager.create({
        systemPrompt: "You are a helpful assistant.",
      })
    );

    const restored = await Effect.runPromise(
      sessionManager.restoreToCheckpoint!(session.id, "cp-1")
    );

    expect(restored.systemPrompt).toBe("You are a helpful assistant.");
  });
});
