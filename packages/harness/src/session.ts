import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  SessionEntry,
  SessionEntryBase,
  CompactionEntry,
} from "@agentforge/shared";

/**
 * Session 内存存储。见 ARCHITECTURE.md §4.1。
 * 树形会话：每个 entry 有 parentId（根为 null），leafId 指向当前叶节点。
 * moveTo 切换 leafId 实现 fork（Slice 0 仅切 leafId，branch_summary 参数接口预留）。
 */
export interface SessionStore {
  getLeafId(): string;
  setLeafId(id: string): void;
  appendEntry(e: SessionEntry): string; // 返回 entryId
  getEntry(id: string): SessionEntry | undefined;
  getPathToRoot(leafId: string): SessionEntry[];
  moveTo(leafId: string, branchSummary?: string): void;
}

export function createMemorySession(): SessionStore {
  const entries = new Map<string, SessionEntry>();
  let leafId = "";

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
      return entryId;
    },
    getEntry(id) {
      return entries.get(id);
    },
    getPathToRoot(leafId) {
      const path: SessionEntry[] = [];
      let current = entries.get(leafId);
      while (current) {
        path.unshift(current);
        if (current.parentId === null) break;
        current = entries.get(current.parentId);
      }
      return path;
    },
    moveTo(targetLeafId, _branchSummary) {
      // Slice 0: 仅切 leafId（fork 点）。branch_summary 写入留待持久化 slice。
      leafId = targetLeafId;
    },
  };
}

/**
 * 从 session 路径上的 entries 重建 AgentMessage[]（--resume 用）。
 * 见 ARCHITECTURE.md §4.1 / issue #3。
 *
 * 规则：遍历 entries，遇到 CompactionEntry 则注入一条 summary user 消息
 * {role:"user", content:"[Previous context summary]\n" + entry.summary, timestamp: entry.timestamp}，
 * 并以 firstKeptEntryId 为锚点跳过被压缩的旧 messages——只保留 firstKeptEntryId
 * 及其之后的 MessageEntry（CompactionEntry 位置之前的旧 messages 不重建）。
 *
 * 多次压缩：取最后一次 CompactionEntry（路径最末端的）作为有效锚点，
 * 其 summary 注入，旧区全部跳过。更早的 CompactionEntry 视为已被后续压缩覆盖。
 *
 * 无 CompactionEntry 时退化为：按序提取所有 MessageEntry.message（Slice 0 行为）。
 *
 * @param entries session 路径（getPathToRoot 产物，根→叶顺序）。
 * @returns 重建后的 AgentMessage[]，可直接喂给 Agent initialState.messages。
 */
export function rebuildMessages(entries: SessionEntry[]): AgentMessage[] {
  if (entries.length === 0) return [];

  // 找最末端（最后一次）CompactionEntry 的索引与内容。
  let lastCompactionIdx = -1;
  let lastCompaction: CompactionEntry | undefined;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.type === "compaction") {
      lastCompactionIdx = i;
      lastCompaction = entries[i] as CompactionEntry;
    }
  }

  // 无压缩：按序提取所有 MessageEntry.message。
  if (lastCompactionIdx === -1 || !lastCompaction) {
    const messages: AgentMessage[] = [];
    for (const e of entries) {
      if (e.type === "message") {
        messages.push((e as { message: AgentMessage }).message);
      }
    }
    return messages;
  }

  // 有压缩：构造 summary 消息，再保留 firstKeptEntryId 到 CompactionEntry 之间的
  // MessageEntry（保留区）。CompactionEntry 之后的 MessageEntry 是压缩落盘后新追加的，
  // 也应保留。firstKeptEntryId 之前的旧 MessageEntry 是被压缩掉的，跳过。
  const summaryMessage: AgentMessage = {
    role: "user",
    content: `[Previous context summary]\n${lastCompaction.summary}`,
    timestamp: lastCompaction.timestamp,
  } as AgentMessage;

  // 在整条路径中定位 firstKeptEntryId 的索引（保留区起点）。
  const keptStartIdx = entries.findIndex(
    (e) => e.entryId === lastCompaction!.firstKeptEntryId,
  );

  const keptMessages: AgentMessage[] = [];
  if (keptStartIdx !== -1) {
    // 从保留区起点遍历到路径末尾，跳过 CompactionEntry 自身（它只贡献 summary）。
    for (let i = keptStartIdx; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.type === "message") {
        keptMessages.push((e as { message: AgentMessage }).message);
      }
    }
  }

  return [summaryMessage, ...keptMessages];
}
