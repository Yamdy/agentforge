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

/** LLM 实际产出的部分 instinct 候选：仅 trigger/action/confidence/domain/evidence。id/scope/时间戳由 extract() 补齐。 */
export interface ExtractedInstinct {
  trigger: string;
  action: string;
  confidence: number;
  domain: string;
  evidence?: string[];
}

export interface ExtractRun {
  (observations: Observation[], signal?: AbortSignal): Promise<ExtractedInstinct[]>;
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

/**
 * Extract 阶段 LLM system prompt。T1 探针 gate 后收紧（v2）：
 *  - 强制 trigger/action 泛化（禁止具体文件名/路径/单次字面事件）——修场景 3 平凡重述。
 *  - 禁止字面序列重述，要求提炼底层偏好。
 *  - 明确证据门槛：用户纠正 / error→retry 修复 / 重复 2+ 次模式；单次孤立事件 → 空。
 *  - 强调 ONLY JSON（no fences/prose）——配合 createExtractRun parseInstinctsJson 容错。
 */
export const EXTRACT_PROMPT =
  "You are an instinct extractor. From the given tool-use observations, extract atomic " +
  '"instincts" (one trigger → one action) representing stable, GENERALIZABLE user preferences ' +
  "or repeated patterns (user corrections, error resolutions, repeated workflows).\n\n" +
  "RULES:\n" +
  "- GENERALIZE: trigger and action must describe a generalizable condition/behavior, NEVER a specific filename, path, or single literal event. Bad: 'when reading a.ts → edit a.ts'. Good: 'when editing a file → read it first'.\n" +
  "- NO RESTATEMENT: do not restate the observation sequence; extract the underlying preference.\n" +
  "- EVIDENCE: extract only on real signal — a user correction, an error→retry fix, or a pattern repeated 2+ times. A single isolated event with no correction → omit.\n" +
  "- Do NOT invent. No stable pattern → empty.\n\n" +
  'Output ONLY the JSON object (no markdown fences, no prose): {"instincts":[{"trigger":"when ...","action":"...","confidence":0.3-0.9,"domain":"testing|git|code-style|debugging|workflow","evidence":["..."]}]} or {"instincts":[]}.';

function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) : s; }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function normalizeTrigger(t: string): string { return t.trim().toLowerCase(); }

/** bash/shell 类工具名集合。 */
const SHELL_TOOLS = new Set(["bash", "sh", "shell", "zsh", "fish", "powershell", "pwsh"]);

/** 常见 shell secret pattern → <redacted>。(red-team Important 4:200-cap 会 truncate mid-secret,故先 redact) */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/((?:[A-Z0-9_]*)(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL))\s*[:=]\s*\S+/gi, "$1=<redacted>"],
  [/Authorization\s*:\s*Bearer\s+\S+/gi, "Authorization: Bearer <redacted>"],
  [/-H\s+['"]\s*Authorization:[^'"]*['"]/gi, "-H 'Authorization: <redacted>'"],
  [/(postgres|mongodb|redis|mysql|amqp):\/\/[^:\s]+:[^@\s]+@/gi, "$1://<user>:<redacted>@"],
  [/https?:\/\/[^\s/:]+:[^\s/:]+@[^\s/]+/gi, "https://<user>:<redacted>@<host>"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-<redacted>"],
];

function redactString(s: string): string {
  let out = s;
  for (const [re, repl] of SECRET_PATTERNS) out = out.replace(re, repl);
  return out;
}

/**
 * 序列化 tool args 为 argsSummary(截断 ~200 字符)。bash/shell 类工具的 command 字段先 redact secret pattern。
 * 非 shell 工具(read/edit/write 的 path)不含 secret,直接 stringify。
 */
function redactArgs(toolName: string, args: unknown): string {
  let safe: unknown = args;
  if (SHELL_TOOLS.has(toolName) && args && typeof args === "object" && "command" in (args as Record<string, unknown>)) {
    const a = args as Record<string, unknown>;
    safe = { ...a, command: redactString(String(a.command ?? "")) };
  }
  return truncate(JSON.stringify(safe), TRUNCATE_ARGS);
}

/**
 * 将 Message.content 序列化为纯文本，兼容 string 与 block 数组两种形式。
 * pi-ai UserMessage.content: string | (TextContent | ImageContent)[]
 * pi-ai AssistantMessage.content: (TextContent | ThinkingContent | ToolCall)[] — 恒为数组
 * 仅 text block 贡献文本；ThinkingContent/ToolCall/ImageContent 跳过
 * （tool_call 已由 tool_execution_end 单独记录为 tool_call observation）。
 * 直接 String(array) 会得到 "[object Object]"，污染 EXTRACT_PROMPT 学习信号。
 */
function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => b?.type === "text" ? String(b.text ?? "") : "")
    .filter(Boolean)
    .join("\n");
}

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
      // prefer-args 去重(Slice 4-B T10):跳过无 args 的 tool_execution_end
      // (pi 原生事件无 args 字段 types.d.ts:392;harness afterToolCall emit 带 args)。
      // 不依赖 emit 顺序——无论 pi 原生还是 harness 先发,无 args 的被跳过,带 args 的被记录。
      if (e.args === undefined) return [];
      const argsSummary = redactArgs(e.toolName, e.args);
      const out: Observation[] = [{ timestamp: ts, projectHash, kind: "tool_call", data: { toolName: e.toolName, argsSummary, isError: e.isError } }];
      if (e.isError) out.push({ timestamp: ts, projectHash, kind: "tool_error", data: { toolName: e.toolName, isError: true } });
      return out;
    }
    if ((event as any).type === "message_end") {
      const msg = (event as any).message;
      if (msg?.role === "user") return [{ timestamp: ts, projectHash, kind: "user_message", data: { content: truncate(contentToString(msg.content), TRUNCATE_CONTENT) } }];
      if (msg?.role === "assistant") return [{ timestamp: ts, projectHash, kind: "assistant_message", data: { content: truncate(contentToString(msg.content), TRUNCATE_CONTENT) } }];
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
