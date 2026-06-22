import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  deserializeEntry,
  serializeEntry,
} from "@agentforge/shared";
import type { SessionEntry, SessionEntryBase } from "@agentforge/shared";
import type { SessionStore } from "./session.js";

/**
 * JSONL-backed session store. 见 ARCHITECTURE.md §4.1。
 * 把树形会话持久化到 JSONL 文件：每行一条 serializeEntry(entry)。
 * 构造时读文件重建 entries Map + leafId（最后一条非空行）；
 * appendEntry 先走内存逻辑（填 entryId/parentId/timestamp），再 append 一行到文件。
 * 损坏行（非法 JSON）跳过——只丢该行，其余行正常加载。
 */
export function createJsonlSession(path: string): SessionStore {
  const entries = new Map<string, SessionEntry>();
  let leafId = "";

  // Load existing file (if any). Corrupt lines are skipped.
  if (existsSync(path)) {
    const content = readFileSync(path, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.length === 0) continue;
      let entry: SessionEntry;
      try {
        entry = deserializeEntry(line);
      } catch {
        // Skip corrupt line; do not touch entries/leafId.
        continue;
      }
      entries.set(entry.entryId, entry);
      leafId = entry.entryId;
    }
  }

  return {
    getLeafId() {
      return leafId;
    },
    setLeafId(id) {
      leafId = id;
    },
    appendEntry(e) {
      const entryId = e.entryId || randomUUID();
      const parentId = entries.size === 0 ? null : leafId;
      const entry = {
        ...e,
        entryId,
        parentId,
        timestamp: e.timestamp ?? Date.now(),
      } as SessionEntry & SessionEntryBase;

      entries.set(entryId, entry);
      leafId = entryId;
      // 确保父目录存在（REPL 首次运行时 .agentforge/sessions/ 可能尚不存在；
      // appendFileSync 不会自动创建父目录，否则抛 ENOENT）。
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, serializeEntry(entry) + "\n", "utf8");
      return entryId;
    },
    getEntry(id) {
      return entries.get(id);
    },
    getPathToRoot(leaf) {
      const pathOut: SessionEntry[] = [];
      let current = entries.get(leaf);
      while (current) {
        pathOut.unshift(current);
        if (current.parentId === null) break;
        current = entries.get(current.parentId);
      }
      return pathOut;
    },
    moveTo(targetLeafId, _branchSummary) {
      // Slice 0: 仅切 leafId（fork 点）。branch_summary 持久化留待后续 slice。
      leafId = targetLeafId;
    },
  };
}
