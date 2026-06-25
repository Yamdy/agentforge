import type { HarnessEvent } from "@agentforge/shared";
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Observation {
  timestamp: number;
  projectHash: string | null;
  kind: "tool_call" | "user_message" | "assistant_message" | "tool_error";
  data: { toolName?: string; argsSummary?: string; isError?: boolean; content?: string };
}

export interface Instinct {
  id: string;
  trigger: string;
  action: string;
  confidence: number;
  domain: string;
  scope: "project" | "global";
  projectHash: string | null;
  evidence: string[];
  createdAt: number;
  updatedAt: number;
}

/** id 派生：trigger → kebab-case，40 字符截断。同 trigger → 同 id。 */
export function deriveId(trigger: string): string {
  return trigger.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/** 格式化 instinct 为 systemPrompt `<learned_instincts>` 段落。空数组返回 ""。 */
export function formatInstinctsForSystemPrompt(instincts: Instinct[]): string {
  if (instincts.length === 0) return "";
  const lines = instincts.map(
    (i) => `- ${i.trigger} → ${i.action} (confidence: ${i.confidence.toFixed(1)})`,
  );
  return `<learned_instincts>\n${lines.join("\n")}\n</learned_instincts>`;
}

export interface ExtractRun {
  (observations: Observation[], signal?: AbortSignal): Promise<Instinct[]>;
}

export interface InstinctStore {
  observe(event: HarnessEvent): void;
  loadInstincts(): Instinct[];
  extract(signal?: AbortSignal): Promise<void>;
}

const TRUNCATE_CONTENT = 500;
const TRUNCATE_ARGS = 200;

function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) : s; }

function observationsPath(dataDir: string, projectHash: string | null): string {
  return projectHash
    ? join(dataDir, "projects", projectHash, "observations.jsonl")
    : join(dataDir, "observations.jsonl");
}

/** instinct 持久化目录：project 作用域 → `<dataDir>/projects/<hash>/instincts`；global → `<dataDir>/instincts`。 */
function instinctsDir(dataDir: string, projectHash: string | null): string {
  return projectHash
    ? join(dataDir, "projects", projectHash, "instincts")
    : join(dataDir, "instincts");
}

/** 从单个目录读全部 `.json` instinct；目录缺失返回 []，单文件 malformed 静默跳过（best-effort）。 */
function readInstinctsFromDir(dir: string): Instinct[] {
  let files: string[];
  try { files = readdirSync(dir); } catch { return []; }
  const out: Instinct[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), "utf-8")) as Instinct);
    } catch { /* malformed: skip */ }
  }
  return out;
}

/**
 * 读 project + global instinct 文件，未过滤。
 * 模块级 helper，供 `InstinctStore.loadInstincts()` 和未来 T5 `extract()` 复用。
 * projectHash=null → 仅 global；非空 → project 目录 + global 目录合并。
 */
export function readAllInstincts(dataDir: string, projectHash: string | null): Instinct[] {
  const proj = projectHash ? readInstinctsFromDir(instinctsDir(dataDir, projectHash)) : [];
  const global = readInstinctsFromDir(instinctsDir(dataDir, null));
  return [...proj, ...global];
}

export function createInstinctStore(opts: {
  projectHash: string | null;
  extractRun?: ExtractRun;
  dataDir?: string;
  modelContextWindow?: number;
}): InstinctStore {
  const dataDir = opts.dataDir ?? join(homedir(), ".agentforge");
  const projectHash = opts.projectHash;

  function appendObservation(obs: Observation): void {
    try {
      const path = observationsPath(dataDir, obs.projectHash);
      mkdirSync(join(path, ".."), { recursive: true });
      appendFileSync(path, JSON.stringify(obs) + "\n");
    } catch { /* best-effort */ }
  }

  function adapt(event: HarnessEvent): Observation[] {
    const ts = Date.now();
    if ((event as any).type === "tool_execution_end") {
      const e = event as any;
      const argsSummary = e.args ? truncate(JSON.stringify(e.args), TRUNCATE_ARGS) : undefined;
      const out: Observation[] = [{ timestamp: ts, projectHash, kind: "tool_call", data: { toolName: e.toolName, argsSummary, isError: e.isError } }];
      if (e.isError) out.push({ timestamp: ts, projectHash, kind: "tool_error", data: { toolName: e.toolName, isError: true } });
      return out;
    }
    if ((event as any).type === "message_end") {
      const msg = (event as any).message;
      if (msg?.role === "user") return [{ timestamp: ts, projectHash, kind: "user_message", data: { content: truncate(String(msg.content ?? ""), TRUNCATE_CONTENT) } }];
      if (msg?.role === "assistant") return [{ timestamp: ts, projectHash, kind: "assistant_message", data: { content: truncate(String(msg.content ?? ""), TRUNCATE_CONTENT) } }];
    }
    return [];
  }

  return {
    observe(event) { for (const o of adapt(event)) appendObservation(o); },
    loadInstincts() { return readAllInstincts(dataDir, projectHash); },
    async extract() { /* T5 填 */ },
  };
}
