import { describe, test, expect } from "vitest";
import { serializeEntry, deserializeEntry, type SessionEntry } from "./index.js";

describe("SessionEntry serialization", () => {
  test("round-trips a message entry with user message", () => {
    const entry: SessionEntry = {
      entryId: "e1",
      parentId: null,
      timestamp: 1000,
      type: "message",
      message: { role: "user", content: "hello", timestamp: 1000 },
    };
    expect(deserializeEntry(serializeEntry(entry))).toEqual(entry);
  });

  test("round-trips a compaction entry", () => {
    const entry: SessionEntry = {
      entryId: "e2",
      parentId: "e1",
      timestamp: 2000,
      type: "compaction",
      summary: "compacted context",
      firstKeptEntryId: "e1",
    };
    expect(deserializeEntry(serializeEntry(entry))).toEqual(entry);
  });

  test("round-trips a custom entry (instinct)", () => {
    const entry: SessionEntry = {
      entryId: "e3",
      parentId: "e2",
      timestamp: 3000,
      type: "custom",
      kind: "instinct",
      data: { trigger: "x", action: "y", confidence: 0.5 },
    };
    expect(deserializeEntry(serializeEntry(entry))).toEqual(entry);
  });

  test("deserializeEntry throws on invalid JSON", () => {
    expect(() => deserializeEntry("{not json")).toThrow();
  });
});
