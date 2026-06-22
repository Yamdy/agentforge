import { describe, test, expect } from "vitest";
import { createMemorySession, rebuildMessages } from "./session.js";
import type {
  SessionEntry,
  MessageEntry,
  CompactionEntry,
} from "@agentforge/shared";

/** Helper: build a minimal message entry input (no entryId/parentId/timestamp). */
function msg(content: string): Omit<MessageEntry, "entryId" | "parentId" | "timestamp"> {
  return {
    type: "message",
    message: { role: "user", content, timestamp: 1 } as MessageEntry["message"],
  };
}

/** Helper: build a minimal compaction entry input. */
function compaction(
  summary: string,
  firstKeptEntryId: string,
): Omit<CompactionEntry, "entryId" | "parentId" | "timestamp"> {
  return {
    type: "compaction",
    summary,
    firstKeptEntryId,
  };
}

describe("createMemorySession / SessionStore", () => {
  test("appendEntry returns an entryId and the first entry has parentId null", () => {
    const store = createMemorySession();
    const id = store.appendEntry(msg("hi") as SessionEntry);

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const entry = store.getEntry(id) as MessageEntry;
    expect(entry).toBeDefined();
    expect(entry.parentId).toBe(null);
    expect(entry.entryId).toBe(id);
    expect(entry.type).toBe("message");
  });

  test("consecutive appendEntry chains parentId to the previous leaf and updates leafId", () => {
    const store = createMemorySession();
    const id1 = store.appendEntry(msg("first") as SessionEntry);
    const id2 = store.appendEntry(msg("second") as SessionEntry);

    expect(store.getLeafId()).toBe(id2);

    const e1 = store.getEntry(id1) as MessageEntry;
    const e2 = store.getEntry(id2) as MessageEntry;
    expect(e1.parentId).toBe(null);
    expect(e2.parentId).toBe(id1);
  });

  test("getEntry retrieves a previously appended entry by id", () => {
    const store = createMemorySession();
    const id = store.appendEntry(msg("hello") as SessionEntry);

    const entry = store.getEntry(id) as MessageEntry;
    expect(entry).toBeDefined();
    expect(entry.entryId).toBe(id);
    expect(entry.message).toEqual(
      (msg("hello") as MessageEntry).message,
    );
  });

  test("getEntry returns undefined for a non-existent id", () => {
    const store = createMemorySession();
    expect(store.getEntry("does-not-exist")).toBeUndefined();
  });

  test("getPathToRoot returns the chain from root to leaf", () => {
    const store = createMemorySession();
    const id1 = store.appendEntry(msg("a") as SessionEntry);
    const id2 = store.appendEntry(msg("b") as SessionEntry);
    const id3 = store.appendEntry(msg("c") as SessionEntry);

    const path = store.getPathToRoot(id3);

    // root first, leaf last
    expect(path.map((e) => e.entryId)).toEqual([id1, id2, id3]);
    expect(path[0].parentId).toBe(null);
    expect(path[2].entryId).toBe(id3);
  });

  test("moveTo switches leafId so subsequent appendEntry parents to the new leaf (fork)", () => {
    const store = createMemorySession();
    const id1 = store.appendEntry(msg("root") as SessionEntry);
    const id2 = store.appendEntry(msg("child") as SessionEntry);

    // fork from id1
    store.moveTo(id1);
    expect(store.getLeafId()).toBe(id1);

    const id3 = store.appendEntry(msg("fork-child") as SessionEntry);
    const e3 = store.getEntry(id3) as MessageEntry;
    expect(e3.parentId).toBe(id1);

    // path from new leaf goes back through id1 only (plus itself)
    const path = store.getPathToRoot(id3);
    expect(path.map((e) => e.entryId)).toEqual([id1, id3]);
  });

  test("setLeafId / getLeafId round-trip the current leaf pointer", () => {
    const store = createMemorySession();
    const id1 = store.appendEntry(msg("x") as SessionEntry);
    const id2 = store.appendEntry(msg("y") as SessionEntry);

    store.setLeafId(id1);
    expect(store.getLeafId()).toBe(id1);
  });

  test("appendEntry fills in entryId/parentId/timestamp when caller omits them", () => {
    const store = createMemorySession();
    const id = store.appendEntry(msg("z") as SessionEntry);
    const entry = store.getEntry(id) as MessageEntry;

    expect(entry.entryId).toBe(id);
    expect(entry.parentId).toBe(null);
    expect(typeof entry.timestamp).toBe("number");
  });
});

describe("rebuildMessages", () => {
  test("returns only MessageEntry messages when no CompactionEntry is present", () => {
    const store = createMemorySession();
    store.appendEntry(msg("a") as SessionEntry);
    store.appendEntry(msg("b") as SessionEntry);

    const entries = store.getPathToRoot(store.getLeafId());
    const messages = rebuildMessages(entries);

    expect(messages).toHaveLength(2);
    expect((messages[0] as any).content).toBe("a");
    expect((messages[1] as any).content).toBe("b");
  });

  test("injects a summary user message at the CompactionEntry position and skips compacted old messages", () => {
    // 路径: [MessageEntry(old-q), MessageEntry(old-a), CompactionEntry(summary, firstKeptEntryId=kept-q), MessageEntry(kept-q), MessageEntry(kept-a)]
    const store = createMemorySession();
    const oldQId = store.appendEntry(msg("old question") as SessionEntry);
    store.appendEntry(msg("old answer") as SessionEntry);
    const keptQId = store.appendEntry(msg("kept question") as SessionEntry);
    store.appendEntry(msg("kept answer") as SessionEntry);
    // 插入 CompactionEntry：firstKeptEntryId 指向 kept-q（保留区起点）。
    store.appendEntry(
      compaction("SUMMARY OF OLD", keptQId) as SessionEntry,
    );

    const entries = store.getPathToRoot(store.getLeafId());
    const messages = rebuildMessages(entries);

    // 期望: [summaryMessage, kept-q, kept-a] —— old-q/old-a 被跳过。
    expect(messages).toHaveLength(3);

    // summary 消息在 CompactionEntry 位置（被压缩旧消息处）。
    const summaryMsg = messages[0] as any;
    expect(summaryMsg.role).toBe("user");
    expect(summaryMsg.content).toContain("[Previous context summary]");
    expect(summaryMsg.content).toContain("SUMMARY OF OLD");

    // 保留区消息按序保留。
    expect((messages[1] as any).content).toBe("kept question");
    expect((messages[2] as any).content).toBe("kept answer");

    // 被压缩的旧消息不出现在结果中。
    const contents = messages.map((m: any) => m.content);
    expect(contents).not.toContain("old question");
    expect(contents).not.toContain("old answer");
  });

  test("uses the CompactionEntry timestamp for the injected summary message", () => {
    const store = createMemorySession();
    const keptId = store.appendEntry(msg("kept") as SessionEntry);
    const compEntryId = store.appendEntry(
      compaction("S", keptId) as SessionEntry,
    );

    const entries = store.getPathToRoot(store.getLeafId());
    const compEntry = entries.find(
      (e) => e.type === "compaction",
    ) as CompactionEntry;
    const messages = rebuildMessages(entries);

    // summary 消息 timestamp 应来自 CompactionEntry。
    expect((messages[0] as any).timestamp).toBe(compEntry.timestamp);
    expect(compEntry.entryId).toBe(compEntryId);
  });

  test("handles multiple CompactionEntries by applying the latest summary and skipping all earlier compacted messages", () => {
    // 两次压缩：第一次压 old1，第二次压 old2，保留区只剩 kept。
    const store = createMemorySession();
    const old1Q = store.appendEntry(msg("old1 q") as SessionEntry);
    store.appendEntry(msg("old1 a") as SessionEntry);
    const old2Q = store.appendEntry(msg("old2 q") as SessionEntry);
    store.appendEntry(msg("old2 a") as SessionEntry);
    const keptQ = store.appendEntry(msg("kept q") as SessionEntry);
    store.appendEntry(msg("kept a") as SessionEntry);
    // 第一次压缩：firstKeptEntryId 指向 old2-q（第一次保留区起点）。
    store.appendEntry(compaction("SUM1", old2Q) as SessionEntry);
    // 第二次压缩：firstKeptEntryId 指向 kept-q（最终保留区起点）。
    store.appendEntry(compaction("SUM2", keptQ) as SessionEntry);

    const entries = store.getPathToRoot(store.getLeafId());
    const messages = rebuildMessages(entries);

    // 最终只保留最后一次压缩的 summary + 保留区。
    expect(messages).toHaveLength(3);
    expect((messages[0] as any).content).toContain("SUM2");
    expect((messages[1] as any).content).toBe("kept q");
    expect((messages[2] as any).content).toBe("kept a");
  });

  test("returns empty array for an empty entry list", () => {
    expect(rebuildMessages([])).toEqual([]);
  });
});
