import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonlSession } from "./jsonl-storage.js";
import { serializeEntry, deserializeEntry } from "@agentforge/shared";
import type { SessionEntry, MessageEntry } from "@agentforge/shared";

/** Helper: build a minimal message entry input (no entryId/parentId/timestamp). */
function msg(content: string): Omit<MessageEntry, "entryId" | "parentId" | "timestamp"> {
  return {
    type: "message",
    message: { role: "user", content, timestamp: 1 } as MessageEntry["message"],
  };
}

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), `agentforge-jsonl-${randomUUID()}`));
  path = join(dir, "session.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createJsonlSession / JsonlSessionStorage — persistence", () => {
  test("appendEntry writes a corresponding JSONL line to the file", () => {
    const store = createJsonlSession(path);
    const id = store.appendEntry(msg("hi") as SessionEntry);

    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);

    const parsed = deserializeEntry(lines[0]) as MessageEntry;
    expect(parsed.entryId).toBe(id);
    expect(parsed.type).toBe("message");
    expect(parsed.message).toEqual((msg("hi") as MessageEntry).message);
    expect(parsed.parentId).toBe(null);
    expect(typeof parsed.timestamp).toBe("number");
  });

  test("loading an existing file rebuilds entries + leafId, getEntry/getPathToRoot work", () => {
    // instance A writes a chain
    const a = createJsonlSession(path);
    const id1 = a.appendEntry(msg("first") as SessionEntry);
    const id2 = a.appendEntry(msg("second") as SessionEntry);
    const id3 = a.appendEntry(msg("third") as SessionEntry);

    // instance B loads the same path (simulates new process / fresh memory)
    const b = createJsonlSession(path);

    expect(b.getLeafId()).toBe(id3);
    expect(b.getEntry(id2)).toBeDefined();
    expect((b.getEntry(id2) as MessageEntry).entryId).toBe(id2);

    const path3 = b.getPathToRoot(id3);
    expect(path3.map((e) => e.entryId)).toEqual([id1, id2, id3]);
    expect(path3[0].parentId).toBe(null);
  });

  test("process-restart simulation: B.getPathToRoot(B.getLeafId()) returns A's full chain", () => {
    const a = createJsonlSession(path);
    const ids = ["a", "b", "c", "d"].map((s) => a.appendEntry(msg(s) as SessionEntry));

    // A's in-memory state is discarded; B loads from disk.
    const b = createJsonlSession(path);

    expect(b.getLeafId()).toBe(ids[3]);
    const chain = b.getPathToRoot(b.getLeafId());
    expect(chain.map((e) => e.entryId)).toEqual(ids);

    // B can continue appending, parenting to the loaded leaf.
    const id5 = b.appendEntry(msg("e") as SessionEntry);
    const e5 = b.getEntry(id5) as MessageEntry;
    expect(e5.parentId).toBe(ids[3]);
  });

  test("empty / non-existent file loads as an empty session; first append has parentId null", () => {
    expect(existsSync(path)).toBe(false);
    const store = createJsonlSession(path);

    expect(store.getLeafId()).toBe("");
    const id = store.appendEntry(msg("root") as SessionEntry);
    const entry = store.getEntry(id) as MessageEntry;
    expect(entry.parentId).toBe(null);
    expect(store.getLeafId()).toBe(id);
  });

  test("corrupt line (invalid JSON) is skipped, valid lines around it still load", () => {
    // Write two valid lines with a corrupt line between them.
    const store = createJsonlSession(path);
    const id1 = store.appendEntry(msg("good-1") as SessionEntry);
    const id2 = store.appendEntry(msg("good-2") as SessionEntry);

    const valid = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
    const corrupt = "{not valid json";
    // Rebuild file: good-1, corrupt, good-2. good-2's parentId still points to id1.
    writeFileSync(path, `${valid[0]}\n${corrupt}\n${valid[1]}\n`);

    const reloaded = createJsonlSession(path);
    expect(reloaded.getEntry(id1)).toBeDefined();
    expect(reloaded.getEntry(id2)).toBeDefined();
    // good-2 was still loaded; chain from id2 reaches id1 (root).
    const chain = reloaded.getPathToRoot(id2);
    expect(chain.map((e) => e.entryId)).toEqual([id1, id2]);
  });

  test("behavior parity with createMemorySession: entryId/parentId/timestamp auto-fill, moveTo switches leaf", () => {
    const store = createJsonlSession(path);
    const id1 = store.appendEntry(msg("root") as SessionEntry);
    const id2 = store.appendEntry(msg("child") as SessionEntry);

    // auto-fill
    const e1 = store.getEntry(id1) as MessageEntry;
    expect(e1.entryId).toBe(id1);
    expect(e1.parentId).toBe(null);
    expect(typeof e1.timestamp).toBe("number");

    // chain
    expect((store.getEntry(id2) as MessageEntry).parentId).toBe(id1);
    expect(store.getLeafId()).toBe(id2);

    // moveTo fork
    store.moveTo(id1);
    expect(store.getLeafId()).toBe(id1);
    const id3 = store.appendEntry(msg("fork") as SessionEntry);
    expect((store.getEntry(id3) as MessageEntry).parentId).toBe(id1);

    const forkPath = store.getPathToRoot(id3);
    expect(forkPath.map((e) => e.entryId)).toEqual([id1, id3]);
  });

  test("serialized line matches serializeEntry(entry) format, one JSON object per line", () => {
    const store = createJsonlSession(path);
    const id = store.appendEntry(msg("fmt") as SessionEntry);
    const entry = store.getEntry(id) as SessionEntry;

    const content = readFileSync(path, "utf8");
    const line = content.trimEnd().split("\n").pop()!;
    expect(line).toBe(serializeEntry(entry));
  });

  test("appendEntry creates parent directory if missing (REPL first-run, dir does not exist)", () => {
    // 真对话首次运行：.agentforge/sessions/ 目录尚不存在。
    // appendFileSync 不会创建父目录 → ENOENT。createJsonlSession 应确保目录存在。
    const nestedPath = join(dir, "nested", "subdir", "session.jsonl");
    expect(existsSync(join(dir, "nested"))).toBe(false);

    const store = createJsonlSession(nestedPath);
    const id = store.appendEntry(msg("root") as SessionEntry);

    expect(existsSync(nestedPath)).toBe(true);
    const entry = store.getEntry(id) as MessageEntry;
    expect(entry.parentId).toBe(null);
    expect(store.getLeafId()).toBe(id);
  });
});
