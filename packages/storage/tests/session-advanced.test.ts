import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { FileStorage, PersistentSessionManager } from "@agentforge/storage";

describe("PersistentSessionManager - Fork", () => {
  let storage: FileStorage;
  let sessionManager: PersistentSessionManager;

  beforeEach(() => {
    storage = new FileStorage();
    sessionManager = new PersistentSessionManager({ storage });
  });

  it("should fork a session with parentId", async () => {
    const original = await Effect.runPromise(
      sessionManager.create({
        initialMessages: [
          { role: "user", content: "Original message" },
        ],
      })
    );

    const forked = await Effect.runPromise(
      sessionManager.fork!(original.id, { title: "Forked session" })
    );

    expect(forked.id).not.toBe(original.id);
    expect(forked.parentId).toBe(original.id);
    expect(forked.messages).toEqual(original.messages);
    expect((forked.metadata as any).title).toBe("Forked session");
  });

  it("should copy all messages to forked session", async () => {
    const original = await Effect.runPromise(
      sessionManager.create({
        initialMessages: Array.from({ length: 10 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}`,
        })),
      })
    );

    const forked = await Effect.runPromise(
      sessionManager.fork!(original.id)
    );

    expect(forked.messages.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(forked.messages[i].content).toBe(`Message ${i}`);
    }
  });
});

describe("PersistentSessionManager - Time Travel", () => {
  let storage: FileStorage;
  let sessionManager: PersistentSessionManager;

  beforeEach(() => {
    storage = new FileStorage();
    sessionManager = new PersistentSessionManager({ storage });
  });

  it("should restore session state with revert metadata", async () => {
    const session = await Effect.runPromise(
      sessionManager.create({
        initialMessages: [
          { role: "user", content: "Initial message" },
        ],
      })
    );

    // Add messages
    await Effect.runPromise(
      sessionManager.addMessage(session.id, {
        role: "assistant",
        content: "Response 1",
      })
    );
    await Effect.runPromise(
      sessionManager.addMessage(session.id, {
        role: "user",
        content: "Message 2",
      })
    );

    const beforeRestore = await Effect.runPromise(sessionManager.get(session.id));
    expect(beforeRestore.messages.length).toBe(3);

    // Restore to checkpoint
    const restored = await Effect.runPromise(
      sessionManager.restoreToCheckpoint!(session.id, "checkpoint-abc-123")
    );

    expect(restored.revert?.checkpointId).toBe("checkpoint-abc-123");
    expect(restored.revert?.description).toBe("Restored from checkpoint");
    expect(restored.parentId).toBe(beforeRestore.parentId);
  });
});
