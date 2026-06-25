import type { HarnessEvent } from "@agentforge/shared";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const CONFIDENCE_MIN = 0.3;
const CONFIDENCE_MAX = 0.9;
const REPEAT_STEP = 0.1;
const EVIDENCE_CAP = 5;
const OBS_CTX_RATIO = 0.8;

/** Extract 阶段 LLM system prompt：约束严格 JSON 输出 + 禁止幻觉。 */
export const EXTRACT_PROMPT =
  "You are an instinct extractor. From the given tool-use observations, extract atomic " +
  '"instincts" (one trigger → one action) that represent stable user preferences or repeated ' +
  "patterns (user corrections, error resolutions, repeated workflows). Output ONLY strict JSON: " +
  '{"instincts":[{"trigger":"when ...","action":"...","confidence":0.3-0.9,"domain":"testing|git|code-style|debugging|workflow","evidence":["..."]}]}. ' +
  "Do NOT invent. Only extract patterns genuinely supported by the observations. Empty " +
  '{"instincts":[]} if no stable pattern.';

function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) : s; }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function normalizeTrigger(t: string): string { return t.trim().toLowerCase(); }

function observationsPath(dataDir: string, projectHash: string | null): string {
  return projectHash
    ? join(dataDir, "projects", projectHash, "observations.jsonl")
    : join(dataDir, "observations.jsonl");
}

/** instinct 持久化目录：project 作用域 → `<dataDir>/projects/<hash>/instincts`；global → `<dataDir>/instincts`。 */
export function instinctsDir(dataDir: string, projectHash: string | null): string {
  return projectHash
    ? join(dataDir, "projects", projectHash, "instincts")
    : join(dataDir, "instincts");
}

/** 读 observations.jsonl 为 Observation[]；文件缺失或解析失败返回 []（best-effort）。 */
function readObservations(path: string): Observation[] {
  try {
    return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Observation);
  } catch { return []; }
}

/** 持久化单个 instinct 到 `<dir>/<id>.json`；IO 失败静默吞掉（best-effort）。 */
function persistInstinct(dataDir: string, inst: Instinct): void {
  try {
    const dir = instinctsDir(dataDir, inst.projectHash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${inst.id}.json`), JSON.stringify(inst));
  } catch { /* best-effort */ }
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
    async extract(signal?: AbortSignal): Promise<void> {
      if (!opts.extractRun) return;
      try {
        const obsPath = observationsPath(dataDir, projectHash);
        let observations = readObservations(obsPath);
        if (observations.length === 0) return;
        // 确保 instinct 输出目录存在（即使后续 extractRun 失败，目录也应为空而非缺失）。
        mkdirSync(instinctsDir(dataDir, projectHash), { recursive: true });
        // 体积 backstop：observations tokens 超过 ctx 80% → 截断到最近若干条 + 警告。
        if (opts.modelContextWindow) {
          const obsTokens = Math.ceil(JSON.stringify(observations).length / 4);
          const cap = Math.floor(opts.modelContextWindow * OBS_CTX_RATIO);
          if (obsTokens > cap) {
            observations = observations.slice(-Math.max(1, Math.floor(observations.length * cap / obsTokens)));
            console.error(`[instinct] observations exceeded ${cap} tokens, truncated to ${observations.length} most recent`);
          }
        }
        const produced = await opts.extractRun(observations, signal);
        const existing = readAllInstincts(dataDir, projectHash); // project + global，用于查重/碰撞
        const sameScope = existing.filter((e) => e.scope === (projectHash ? "project" : "global"));
        const byTrigger = new Map(sameScope.map((e) => [normalizeTrigger(e.trigger), e]));
        const usedIds = new Set(existing.map((e) => e.id));
        const now = Date.now();
        for (const raw of produced) {
          const nt = normalizeTrigger(raw.trigger);
          const found = byTrigger.get(nt);
          if (found) {
            // 同 trigger → merge：confidence +0.1 cap 0.9，evidence 追加去重 cap 5，updatedAt 刷新。
            found.confidence = clamp(found.confidence + REPEAT_STEP, CONFIDENCE_MIN, CONFIDENCE_MAX);
            for (const ev of raw.evidence ?? []) {
              if (!found.evidence.includes(ev) && found.evidence.length < EVIDENCE_CAP) found.evidence.push(ev);
            }
            found.updatedAt = now;
            persistInstinct(dataDir, found);
          } else {
            // 新 instinct：id 派生；若与已有 id 碰撞（不同 trigger 同 40 字符 kebab）→ 数字后缀 -2/-3。
            let id = deriveId(raw.trigger);
            while (usedIds.has(id)) {
              id = id.replace(/(-\d+)?$/, (m) => `-${(parseInt(m.slice(1)) || 1) + 1}`);
            }
            usedIds.add(id);
            const inst: Instinct = {
              id,
              trigger: raw.trigger,
              action: raw.action,
              confidence: clamp(raw.confidence, CONFIDENCE_MIN, CONFIDENCE_MAX),
              domain: raw.domain,
              scope: projectHash ? "project" : "global",
              projectHash,
              evidence: (raw.evidence ?? []).slice(0, EVIDENCE_CAP),
              createdAt: now,
              updatedAt: now,
            };
            persistInstinct(dataDir, inst);
          }
        }
      } catch (err) {
        console.error(`[instinct] extract failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
