# Slice 4-B Instinct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 agentforge 加 Instinct 模块（observe→extract→apply 跨 session 闭环 + project scope 隔离 + memory 组件补 ContextBudget + `/instincts` 命令）。

**Architecture:** InstinctStore（`packages/harness/src/instinct.ts`）横跨 harness（apply/observe/extract 逻辑 + 持久化）与 cli（createExtractRun + computeProjectHash + 三模式 wiring）。extract 用 `completeSimple`（类比 compaction `createSummaryGenerator`），session end 触发，跨 session apply 注入 systemPrompt `<learned_instincts>` 段落。memory 组件单独估 instinct 块 token 填 ContextBudget `memory?` 缺口。

**Tech Stack:** TypeScript / pnpm monorepo / vitest / `@earendil-works/pi-ai`（completeSimple/getModel）/ `@earendil-works/pi-agent-core`（Agent/AgentMessage）/ node:fs + node:crypto + node:child_process。

**Spec:** `docs/superpowers/specs/2026-06-25-slice4b-instinct-design.md`（commit `9e3f5cd`，含红队 Oracle 修订）

## Global Constraints

- pi 分支无 remote：commit 留本地不 push，message 结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`
- 默认模型 MiMo（`xiaomi-token-plan-cn`/`mimo-v2.5-pro`，env `XIAOMI_TOKEN_PLAN_CN_API_KEY`）；extract 的 `extractRun` 默认用 MiMo + `getApiKeyFromEnv`
- TDD 铁律：RED（watch fail）→ GREEN → commit，每步验
- vitest development condition vs tsc dist：改 harness/shared 后须 `pnpm --filter @agentforge/<pkg> build` rebuild dist（老陷阱）
- `completeSimple(model, {systemPrompt?, messages: Message[]}, {apiKey?, signal?})`
- pi streamFn 签名 `(model, llmContext, options)`，mock 从 `llmContext.messages` 取，按 toolCall name 匹配非全串
- token 估算 chars/4（pi-ai 无 tokenizer，复用 `context-budget.estimateStringTokens`）
- GateGuard hook 拦新文件/编辑/首次 bash，陈述 4 事实放行
- 数据根目录 `~/.agentforge/`（与 skills 一致），测试用 tmpdir 注入
- `loadInstincts()` 无参——用 InstinctStore 构造时注入的 `projectHash`（读 project + global）

---

## File Structure

**Create:**
- `packages/harness/src/instinct.ts` — InstinctStore + createInstinctStore + formatInstinctsForSystemPrompt + Observation/Instinct 类型 + EXTRACT_PROMPT + deriveId
- `packages/harness/src/instinct.test.ts` — 单元测试
- `packages/cli/src/instinct-config.ts` — createExtractRun + computeProjectHash + createInstinctConfig（cli 层 wiring，类比 compaction-config.ts）
- `packages/cli/src/instinct-config.test.ts` — cli 测试
- `packages/cli/verify-instinct-extract.mjs` — T1 临时探针（验证后删，不 commit）

**Modify:**
- `packages/harness/src/index.ts` — export instinct 公开 API
- `packages/harness/src/context-budget.ts` — `BudgetAuditInput.memory?` + audit `components.memory`
- `packages/harness/src/context-budget.test.ts` — memory 组件测试
- `packages/harness/src/harness.ts` — `HarnessOptions.instinct?` + 构造 apply/observe + `extract()` + `_baseSystemPrompt`/`_instinctBlock` + maybeAuditBudget 改读 basePrompt + memory
- `packages/harness/src/harness.test.ts` — 集成测试
- `packages/cli/src/print-mode.ts` — session end `await harness.extract()` + 注入 InstinctStore
- `packages/cli/src/repl.ts` — buildHarness 注入 InstinctStore + 退出调 extract + `/instincts` 命令
- `packages/cli/src/rpc.ts` — buildHarness 注入 InstinctStore（observe/apply，extract defer）
- `packages/cli/src/index.ts` — bin 入口 wiring（如需）

---

## Task 1: 前置探针 gate（learning 有效性验证）

**Files:**
- Create（临时，验证后删）: `packages/cli/verify-instinct-extract.mjs`
- 无产品代码改动，无 commit

**Interfaces:** N/A（gate——验证 EXTRACT_PROMPT 能从 observations 提炼非平凡 instinct，方可进 T2）

**依据:** spec §9 T1 探针 gate + §7.2 可靠性边界（红队修正：4-C 零幻觉不证 extract 有效性）。

- [ ] **Step 1: 写探针脚本**

`packages/cli/verify-instinct-extract.mjs`：构造 3 段典型 observation traces（JSON），调 `completeSimple` + EXTRACT_PROMPT（MiMo），打印产出 instinct。

```js
// 3 段 traces：用户纠正 / tool error 重试 / 重复工作流
const traces = [
  // 用户纠正：agent 用 pnpm -r，用户说"用 pnpm --filter"
  [{kind:"user_message",data:{content:"跑测试"}},{kind:"tool_call",data:{toolName:"bash",argsSummary:'{"command":"pnpm -r test"}'}},{kind:"tool_error",data:{toolName:"bash",isError:true}},{kind:"user_message",data:{content:"不对，用 pnpm --filter @agentforge/harness test"}}],
  // tool error 重试：read 不存在文件 → error → 改路径
  [{kind:"tool_call",data:{toolName:"read",argsSummary:'{"path":"src/index.ts"}'}},{kind:"tool_error",data:{toolName:"read",isError:true}},{kind:"tool_call",data:{toolName:"read",argsSummary:'{"path":"packages/harness/src/index.ts"}'}}],
  // 重复工作流：每次 edit 前 read
  [{kind:"tool_call",data:{toolName:"read",argsSummary:'{"path":"a.ts"}'}},{kind:"tool_call",data:{toolName:"edit",argsSummary:'{"path":"a.ts"}'}},{kind:"tool_call",data:{toolName:"read",argsSummary:'{"path":"b.ts"}'}},{kind:"tool_call",data:{toolName:"edit",argsSummary:'{"path":"b.ts"}'}}],
];
const EXTRACT_PROMPT = `You are an instinct extractor. From the given tool-use observations, extract atomic "instincts" (one trigger → one action) that represent stable user preferences or repeated patterns. Output ONLY strict JSON: {"instincts":[{"trigger":"when ...","action":"...","confidence":0.3-0.9,"domain":"testing|git|code-style|debugging|workflow","evidence":["..."}]}. Do NOT invent. Only extract patterns genuinely supported by the observations. Empty {"instincts":[]} if no stable pattern.`;
// import { completeSimple, getModel } from "@earendil-works/pi-ai";
// const model = getModel("xiaomi-token-plan-cn","mimo-v2.5-pro");
// const apiKey = process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY;
// for (const t of traces) { const r = await completeSimple(model,{systemPrompt:EXTRACT_PROMPT,messages:[{role:"user",content:JSON.stringify(t)}]},{apiKey}); console.log(JSON.stringify(t),"=>",extractText(r)); }
```

- [ ] **Step 2: 跑探针（需 XIAOMI_TOKEN_PLAN_CN_API_KEY）**

Run: `cd packages/cli && node verify-instinct-extract.mjs`
Expected: 3 段 traces 各产出 instinct JSON。

- [ ] **Step 3: 眼看产出，判 gate**

对每段产出评估：(a) 非平凡（非"run tests → run tests"重述）(b) 跨重跑稳定（重跑 2 次 trigger 措辞一致）(c) 可操作。
- 通过 → 进 T2，据真实 confidence 分布记录校准建议（如 LLM 倾向给 0.7-0.9 则 apply 阈值 0.5 合理；若倾向 0.3-0.4 则考虑降阈值或调大 repeat 增量）。
- 不通过（平凡/不稳定）→ 重设 EXTRACT_PROMPT（加更具体约束）或扩 observation 信号（如加 args 全量），重跑 Step 2。

- [ ] **Step 4: 删探针脚本**

Run: `rm packages/cli/verify-instinct-extract.mjs`
无 commit（探针不留痕，仿 4-C verify-mimo.mjs）。gate 结论记入 ledger。

---

## Task 2: instinct.ts 类型 + deriveId + formatInstinctsForSystemPrompt

**Files:**
- Create: `packages/harness/src/instinct.ts`
- Test: `packages/harness/src/instinct.test.ts`
- Modify: `packages/harness/src/index.ts`（export）

**Interfaces:**
- Produces: `Observation` / `Instinct` 类型 + `deriveId(trigger: string): string` + `formatInstinctsForSystemPrompt(instincts: Instinct[]): string`

- [ ] **Step 1: 写失败测试**

`packages/harness/src/instinct.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { deriveId, formatInstinctsForSystemPrompt, type Instinct } from "./instinct.js";

describe("deriveId", () => {
  it("lowercases + replaces non-alnum with - + truncates 40", () => {
    expect(deriveId("When Running Tests Fails on Import")).toBe("when-running-tests-fails-on-import");
    expect(deriveId("when ".repeat(20) + "x)).toMatch(/^when-when/);
    expect(deriveId("when ".repeat(20) + "x").length).toBeLessThanOrEqual(40);
  });
  it("trims leading/trailing dash", () => {
    expect(deriveId("!!! hi !!!")).toBe("hi");
  });
});

describe("formatInstinctsForSystemPrompt", () => {
  it("returns empty string for empty array", () => {
    expect(formatInstinctsForSystemPrompt([])).toBe("");
  });
  it("formats <learned_instincts> block", () => {
    const instincts: Instinct[] = [
      { id: "prefer-filter", trigger: "when running tests in a package", action: "use pnpm --filter <pkg> test", confidence: 0.7, domain: "testing", scope: "project", projectHash: "abc", evidence: ["obs1"], createdAt: 1, updatedAt: 1 },
    ];
    const block = formatInstinctsForSystemPrompt(instincts);
    expect(block).toContain("<learned_instincts>");
    expect(block).toContain("when running tests in a package → use pnpm --filter <pkg> test");
    expect(block).toContain("0.7");
    expect(block).toContain("</learned_instincts>");
  });
});
```

- [ ] **Step 2: 跑测试验 RED**

Run: `pnpm --filter @agentforge/harness test -- instinct.test.ts`
Expected: FAIL（`./instinct.js` 不存在 / deriveId undefined）

- [ ] **Step 3: 写实现**

`packages/harness/src/instinct.ts`：
```ts
import type { HarnessEvent } from "@agentforge/shared";

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
```

`packages/harness/src/index.ts` 加：`export * from "./instinct.js";`

- [ ] **Step 4: 跑测试验 GREEN + typecheck + build**

Run: `pnpm --filter @agentforge/harness test -- instinct.test.ts && pnpm --filter @agentforge/harness build`
Expected: PASS + build Done（rebuild dist 供 cli typecheck）

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/instinct.ts packages/harness/src/instinct.test.ts packages/harness/src/index.ts
git commit -m "feat(harness): instinct 类型 + deriveId + formatInstinctsForSystemPrompt（Slice 4-B T2）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: observe + observations.jsonl 持久化

**Files:**
- Modify: `packages/harness/src/instinct.ts`, `packages/harness/src/instinct.test.ts`

**Interfaces:**
- Produces: `InstinctStore` 接口（observe）+ `createInstinctStore(opts)` 骨架
- `createInstinctStore({ projectHash, extractRun?, dataDir?, modelContextWindow? })` → `{ observe(event), loadInstincts(), extract(signal?) }`（loadInstincts/extract 本 task stub，T4/T5 填）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstinctStore } from "./instinct.js";

function tmpDataDir() { return mkdtempSync(join(tmpdir(), "instinct-")); }

describe("InstinctStore.observe", () => {
  it("tool_execution_end (no error) → tool_call observation", () => {
    const dir = tmpDataDir();
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: false } as any);
    const lines = readFileSync(join(dir, "projects/abc/observations.jsonl"), "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const obs = JSON.parse(lines[0]);
    expect(obs.kind).toBe("tool_call");
    expect(obs.projectHash).toBe("abc");
    expect(obs.data.toolName).toBe("bash");
    expect(obs.data.isError).toBe(false);
  });
  it("tool_execution_end isError → tool_call + tool_error", () => {
    const dir = tmpDataDir();
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "read", result: {}, isError: true } as any);
    const lines = readFileSync(join(dir, "projects/abc/observations.jsonl"), "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).kind).toBe("tool_call");
    expect(JSON.parse(lines[1]).kind).toBe("tool_error");
  });
  it("message_end user/assistant → user_message/assistant_message, content truncated ~500", () => {
    const dir = tmpDataDir();
    const store = createInstinctStore({ projectHash: null, dataDir: dir });
    const long = "x".repeat(600);
    store.observe({ type: "message_end", message: { role: "user", content: long } } as any);
    store.observe({ type: "message_end", message: { role: "assistant", content: "hi" } } as any);
    const lines = readFileSync(join(dir, "observations.jsonl"), "utf-8").trim().split("\n"); // global fallback
    expect(JSON.parse(lines[0]).kind).toBe("user_message");
    expect(JSON.parse(lines[0]).data.content.length).toBe(500);
    expect(JSON.parse(lines[1]).kind).toBe("assistant_message");
  });
  it("ignores unrelated events", () => {
    const dir = tmpDataDir();
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    store.observe({ type: "agent_start" } as any);
    store.observe({ type: "context_budget", components: {}, total: 0, suggestions: [], headroom: 0 } as any);
    expect(existsSync(join(dir, "projects/abc/observations.jsonl"))).toBe(false);
  });
  it("observe IO failure swallowed (no throw)", () => {
    const store = createInstinctStore({ projectHash: "abc", dataDir: "/nonexistent-root/no-perm" });
    expect(() => store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: false } as any)).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试验 RED**

Run: `pnpm --filter @agentforge/harness test -- instinct.test.ts`
Expected: FAIL（createInstinctStore undefined）

- [ ] **Step 3: 写实现**

`packages/harness/src/instinct.ts` 追加：
```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
    loadInstincts() { return []; }, // T4 填
    async extract() { /* T5 填 */ },
  };
}
```

- [ ] **Step 4: 跑测试验 GREEN + build**

Run: `pnpm --filter @agentforge/harness test -- instinct.test.ts && pnpm --filter @agentforge/harness build`
Expected: PASS + build Done

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/instinct.ts packages/harness/src/instinct.test.ts
git commit -m "feat(harness): instinct observe + observations.jsonl 持久化（Slice 4-B T3）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: loadInstincts（读 project + global instinct 文件，无参）

**Files:**
- Modify: `packages/harness/src/instinct.ts`, `packages/harness/src/instinct.test.ts`

**Interfaces:**
- Produces: `InstinctStore.loadInstincts(): Instinct[]` 返回 store.projectHash 的 project + global 全部 Instinct[]（未过滤）
- 持久化路径：`<dataDir>/projects/<hash>/instincts/<id>.json` + `<dataDir>/instincts/<id>.json`

- [ ] **Step 1: 写失败测试**

```ts
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
describe("InstinctStore.loadInstincts", () => {
  it("reads project + global instincts, unfiltered", () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    mkdirSync(join(dir, "projects/abc/instincts"), { recursive: true });
    mkdirSync(join(dir, "instincts"), { recursive: true });
    const projInst: Instinct = { id: "p1", trigger: "t1", action: "a1", confidence: 0.3, domain: "x", scope: "project", projectHash: "abc", evidence: [], createdAt: 1, updatedAt: 1 };
    const globalInst: Instinct = { id: "g1", trigger: "t2", action: "a2", confidence: 0.9, domain: "x", scope: "global", projectHash: null, evidence: [], createdAt: 1, updatedAt: 1 };
    writeFileSync(join(dir, "projects/abc/instincts/p1.json"), JSON.stringify(projInst));
    writeFileSync(join(dir, "instincts/g1.json"), JSON.stringify(globalInst));
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    const all = store.loadInstincts();
    expect(all).toHaveLength(2);
    expect(all.map(i => i.id).sort()).toEqual(["g1", "p1"]);
  });
  it("returns empty when no files", () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    expect(store.loadInstincts()).toEqual([]);
  });
  it("ignores malformed instinct json (best-effort)", () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    mkdirSync(join(dir, "projects/abc/instincts"), { recursive: true });
    writeFileSync(join(dir, "projects/abc/instincts/bad.json"), "{not json");
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    expect(store.loadInstincts()).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试验 RED**

Run: `pnpm --filter @agentforge/harness test -- instinct.test.ts`
Expected: FAIL（loadInstincts 返回 []，不读文件）

- [ ] **Step 3: 写实现**

`packages/harness/src/instinct.ts` 追加持久化 helper + 替换 `loadInstincts` stub：
```ts
import { readdirSync, readFileSync } from "node:fs";

function instinctsDir(dataDir: string, projectHash: string | null): string {
  return projectHash ? join(dataDir, "projects", projectHash, "instincts") : join(dataDir, "instincts");
}

function readInstinctsFromDir(dir: string): Instinct[] {
  let files: string[];
  try { files = readdirSync(dir); } catch { return []; }
  const out: Instinct[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), "utf-8")) as Instinct); } catch { /* malformed */ }
  }
  return out;
}

// 在 createInstinctStore 返回对象里替换 loadInstincts：
loadInstincts(): Instinct[] {
  try {
    const proj = projectHash ? readInstinctsFromDir(instinctsDir(dataDir, projectHash)) : [];
    const global = readInstinctsFromDir(instinctsDir(dataDir, null));
    return [...proj, ...global];
  } catch { return []; }
}
```

- [ ] **Step 4: 跑测试验 GREEN + build**

Run: `pnpm --filter @agentforge/harness test -- instinct.test.ts && pnpm --filter @agentforge/harness build`
Expected: PASS + build Done

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/instinct.ts packages/harness/src/instinct.test.ts
git commit -m "feat(harness): instinct loadInstincts 读 project+global（Slice 4-B T4）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: extract + 去重/合并 + 体积 backstop

**Files:**
- Modify: `packages/harness/src/instinct.ts`, `packages/harness/src/instinct.test.ts`

**Interfaces:**
- Consumes: `extractRun: ExtractRun`（注入，测试 mock）+ `loadInstincts()`（T4）
- Produces: `InstinctStore.extract(signal?)` —— 读 observations.jsonl + extractRun + 去重/合并 + 持久化

- [ ] **Step 1: 写失败测试**

```ts
import { vi } from "vitest";
describe("InstinctStore.extract", () => {
  it("creates new instinct (clamp confidence)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    const extractRun = vi.fn(async () => [{ trigger: "when tests fail on import", action: "check alias config", confidence: 0.99, domain: "testing", evidence: ["obs1"] }]);
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: true } as any);
    await store.extract();
    const files = readdirSync(join(dir, "projects/abc/instincts"));
    expect(files).toHaveLength(1);
    const inst = JSON.parse(readFileSync(join(dir, "projects/abc/instincts", files[0]), "utf-8")) as Instinct;
    expect(inst.confidence).toBe(0.9); // clamp 0.99→0.9
    expect(inst.scope).toBe("project");
    expect(inst.id).toBe(deriveId("when tests fail on import"));
  });
  it("merges on trigger equal: confidence +0.1 cap 0.9, evidence append dedup cap 5", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    mkdirSync(join(dir, "projects/abc/instincts"), { recursive: true });
    const existing: Instinct = { id: "when-tests-fail-on-import", trigger: "when tests fail on import", action: "check alias", confidence: 0.5, domain: "testing", scope: "project", projectHash: "abc", evidence: ["e1"], createdAt: 1, updatedAt: 1 };
    writeFileSync(join(dir, "projects/abc/instincts/when-tests-fail-on-import.json"), JSON.stringify(existing));
    const extractRun = vi.fn(async () => [{ trigger: "when tests fail on import", action: "check alias", confidence: 0.5, domain: "testing", evidence: ["e2"] }]);
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: true } as any);
    await store.extract();
    const inst = JSON.parse(readFileSync(join(dir, "projects/abc/instincts/when-tests-fail-on-import.json"), "utf-8")) as Instinct;
    expect(inst.confidence).toBe(0.6); // 0.5 + 0.1
    expect(inst.evidence).toEqual(["e1", "e2"]);
  });
  it("id collision but different trigger → not merged, suffix -2", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    mkdirSync(join(dir, "projects/abc/instincts"), { recursive: true });
    const existing: Instinct = { id: "when-running-tests-fails-on-import", trigger: "when running tests fails on import", action: "a1", confidence: 0.5, domain: "testing", scope: "project", projectHash: "abc", evidence: ["e1"], createdAt: 1, updatedAt: 1 };
    writeFileSync(join(dir, "projects/abc/instincts/when-running-tests-fails-on-import.json"), JSON.stringify(existing));
    // 不同 trigger 但同 id（40 字符前缀碰撞）
    const extractRun = vi.fn(async () => [{ trigger: "when running tests fails on import resolution", action: "a2", confidence: 0.5, domain: "testing", evidence: ["e2"] }]);
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: true } as any);
    await store.extract();
    const files = readdirSync(join(dir, "projects/abc/instincts"));
    expect(files.sort()).toEqual(["when-running-tests-fails-on-import", "when-running-tests-fails-on-import-2"]);
  });
  it("extractRun failure → stderr, no throw, no persistence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const extractRun = vi.fn(async () => { throw new Error("llm boom"); });
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: true } as any);
    await expect(store.extract()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    expect(readdirSync(join(dir, "projects/abc/instincts"))).toEqual([]);
    errSpy.mockRestore();
  });
  it("observations exceed ctx 80% → truncate oldest + warn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    const extractRun = vi.fn(async (obs: any[]) => [{ trigger: "t", action: "a", confidence: 0.5, domain: "x", evidence: [] }]);
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun, modelContextWindow: 100 });
    for (let i = 0; i < 50; i++) store.observe({ type: "message_end", message: { role: "user", content: "x".repeat(200) } } as any);
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await store.extract();
    expect(extractRun).toHaveBeenCalled();
    const passedObs = extractRun.mock.calls[0][0] as any[];
    expect(passedObs.length).toBeLessThan(50);
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: 跑测试验 RED**

Run: `pnpm --filter @agentforge/harness test -- instinct.test.ts`
Expected: FAIL（extract stub，不持久化）

- [ ] **Step 3: 写实现**

`packages/harness/src/instinct.ts` 加 EXTRACT_PROMPT + extract 实现 + persistInstinct：
```ts
import { writeFileSync } from "node:fs";

export const EXTRACT_PROMPT =
  "You are an instinct extractor. From the given tool-use observations, extract atomic " +
  '"instincts" (one trigger → one action) that represent stable user preferences or repeated ' +
  "patterns (user corrections, error resolutions, repeated workflows). Output ONLY strict JSON: " +
  '{"instincts":[{"trigger":"when ...","action":"...","confidence":0.3-0.9,"domain":"testing|git|code-style|debugging|workflow","evidence":["..."]}]}. ' +
  "Do NOT invent. Only extract patterns genuinely supported by the observations. Empty " +
  '{"instincts":[]} if no stable pattern.';

const CONFIDENCE_MIN = 0.3, CONFIDENCE_MAX = 0.9, REPEAT_STEP = 0.1, EVIDENCE_CAP = 5;
const OBS_CTX_RATIO = 0.8;

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function normalizeTrigger(t: string): string { return t.trim().toLowerCase(); }

function readObservations(path: string): Observation[] {
  try {
    return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Observation);
  } catch { return []; }
}

function persistInstinct(dataDir: string, inst: Instinct): void {
  try {
    const dir = instinctsDir(dataDir, inst.projectHash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${inst.id}.json`), JSON.stringify(inst));
  } catch { /* best-effort */ }
}

// 在 createInstinctStore 返回对象里替换 extract：
async extract(signal?: AbortSignal): Promise<void> {
  if (!opts.extractRun) return;
  try {
    const obsPath = observationsPath(dataDir, projectHash);
    let observations = readObservations(obsPath);
    if (observations.length === 0) return;
    if (opts.modelContextWindow) {
      const obsTokens = Math.ceil(JSON.stringify(observations).length / 4);
      const cap = Math.floor(opts.modelContextWindow * OBS_CTX_RATIO);
      if (obsTokens > cap) {
        observations = observations.slice(-Math.max(1, Math.floor(observations.length * cap / obsTokens)));
        console.error(`[instinct] observations exceeded ${cap} tokens, truncated to ${observations.length} most recent`);
      }
    }
    const produced = await opts.extractRun(observations, signal);
    const existing = loadInstinctsAll(); // project + global，用于查重/碰撞
    const sameScope = existing.filter(e => e.scope === (projectHash ? "project" : "global"));
    const byTrigger = new Map(sameScope.map(e => [normalizeTrigger(e.trigger), e]));
    const usedIds = new Set(existing.map(e => e.id));
    const now = Date.now();
    for (const raw of produced) {
      const nt = normalizeTrigger(raw.trigger);
      const found = byTrigger.get(nt);
      if (found) {
        found.confidence = clamp(found.confidence + REPEAT_STEP, CONFIDENCE_MIN, CONFIDENCE_MAX);
        for (const ev of raw.evidence ?? []) if (!found.evidence.includes(ev) && found.evidence.length < EVIDENCE_CAP) found.evidence.push(ev);
        found.updatedAt = now;
        persistInstinct(dataDir, found);
      } else {
        let id = deriveId(raw.trigger);
        while (usedIds.has(id)) id = id.replace(/(-\d+)?$/, (m) => `-${(parseInt(m.slice(1)) || 1) + 1}`);
        usedIds.add(id);
        const inst: Instinct = {
          id, trigger: raw.trigger, action: raw.action,
          confidence: clamp(raw.confidence, CONFIDENCE_MIN, CONFIDENCE_MAX),
          domain: raw.domain, scope: projectHash ? "project" : "global",
          projectHash, evidence: (raw.evidence ?? []).slice(0, EVIDENCE_CAP),
          createdAt: now, updatedAt: now,
        };
        persistInstinct(dataDir, inst);
      }
    }
  } catch (err) {
    console.error(`[instinct] extract failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```
注：`loadInstinctsAll()` 复用 T4 `loadInstincts` 的实现逻辑（project + global），extract 内直接调 `this.loadInstincts()` 或抽出共享函数。implementer 据代码结构选——若 `loadInstincts` 是返回对象方法，extract 内闭包无法直接调 `this`，需把读逻辑抽为模块级 `readAllInstincts(dataDir, projectHash)` 函数供两者复用。

- [ ] **Step 4: 跑测试验 GREEN + build**

Run: `pnpm --filter @agentforge/harness test -- instinct.test.ts && pnpm --filter @agentforge/harness build`
Expected: PASS + build Done

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/instinct.ts packages/harness/src/instinct.test.ts
git commit -m "feat(harness): instinct extract + 去重/合并 + 体积 backstop（Slice 4-B T5）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: context-budget memory 组件

**Files:**
- Modify: `packages/harness/src/context-budget.ts`, `packages/harness/src/context-budget.test.ts`

**Interfaces:**
- Produces: `BudgetAuditInput.memory?: string` + audit `components.memory = memory ? estimateStringTokens(memory) : undefined` + total 含 memory

- [ ] **Step 1: 写失败测试**

`context-budget.test.ts` 加：
```ts
import { audit } from "./context-budget.js";
describe("audit memory component", () => {
  it("fills components.memory when memory provided, included in total", () => {
    const report = audit({ systemPrompt: "base", skills: [], tools: [], messages: [], memory: "<learned_instincts>x</learned_instincts>" } as any);
    expect(report.components.memory).toBeGreaterThan(0);
    expect(report.total).toBeGreaterThanOrEqual(report.components.memory + report.components.systemPrompt);
  });
  it("memory undefined when not provided", () => {
    const report = audit({ systemPrompt: "base", skills: [], tools: [], messages: [] } as any);
    expect(report.components.memory).toBeUndefined();
  });
  it("systemPrompt does NOT include memory tokens (no double count)", () => {
    const basePrompt = "base";
    const memoryBlock = "<learned_instincts>" + "x".repeat(400) + "</learned_instincts>";
    const withMem = audit({ systemPrompt: basePrompt, skills: [], tools: [], messages: [], memory: memoryBlock } as any);
    const withoutMem = audit({ systemPrompt: basePrompt, skills: [], tools: [], messages: [] } as any);
    expect(withMem.components.systemPrompt).toBe(withoutMem.components.systemPrompt);
    expect(withMem.components.memory).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试验 RED**

Run: `pnpm --filter @agentforge/harness test -- context-budget.test.ts`
Expected: FAIL（memory 字段未填）

- [ ] **Step 3: 写实现**

`context-budget.ts`：
- `BudgetAuditInput` 加 `memory?: string;`
- `audit()` 内：
```ts
const memory = input.memory ? estimateStringTokens(input.memory) : undefined;
const components: BudgetComponents = { systemPrompt, skills, tools, history, memory };
const total = components.systemPrompt + components.skills + components.tools + components.history + (memory ?? 0);
```
（`BudgetComponents.memory?` 已存在，无需改类型）

- [ ] **Step 4: 跑测试验 GREEN + build**

Run: `pnpm --filter @agentforge/harness test -- context-budget.test.ts && pnpm --filter @agentforge/harness build`
Expected: PASS + build Done

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/context-budget.ts packages/harness/src/context-budget.test.ts
git commit -m "feat(harness): context-budget memory 组件（Slice 4-B T6）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: harness 集成（apply/observe/extract + maybeAuditBudget memory）

**Files:**
- Modify: `packages/harness/src/harness.ts`, `packages/harness/src/harness.test.ts`

**Interfaces:**
- Consumes: `InstinctStore`（T2-T5）+ `BudgetAuditInput.memory`（T6）
- Produces: `HarnessOptions.instinct?: InstinctStore` + harness 构造时 apply（拼 systemPrompt + `_baseSystemPrompt`/`_instinctBlock`）+ observe 订阅 + `harness.extract(signal?)` + `harness.instinctStore` getter + maybeAuditBudget 改读 basePrompt + memory

- [ ] **Step 1: 写失败测试**

`harness.test.ts` 加：
```ts
import { createInstinctStore, formatInstinctsForSystemPrompt, type Instinct } from "./instinct.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
describe("harness instinct integration", () => {
  it("apply: constructs agent with instinct block in systemPrompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "h-inst-"));
    mkdirSync(join(dir, "projects/abc/instincts"), { recursive: true });
    const inst: Instinct = { id: "x", trigger: "when t", action: "do a", confidence: 0.7, domain: "x", scope: "project", projectHash: "abc", evidence: [], createdAt: 1, updatedAt: 1 };
    writeFileSync(join(dir, "projects/abc/instincts/x.json"), JSON.stringify(inst));
    const instinct = createInstinctStore({ projectHash: "abc", dataDir: dir });
    const h = new AgentForgeHarness({ session: createMemorySession(), events: createEventBus(), tools: [], provider: "xiaomi-token-plan-cn", model: "mimo-v2.5-pro", systemPrompt: "BASE", streamFn: mockStreamFn, instinct });
    expect(h.agent.state.systemPrompt).toContain("BASE");
    expect(h.agent.state.systemPrompt).toContain("<learned_instincts>");
    expect(h.instinctStore).toBe(instinct);
  });
  it("apply filters confidence>=0.5 + cap 20", () => {
    // 写 25 个 instinct（confidence 0.3-0.9），断言 systemPrompt 含 20 条且不含 <0.5 的
  });
  it("observe: emit tool_execution_end → observations.jsonl grows", () => {
    const dir = mkdtempSync(join(tmpdir(), "h-inst-"));
    const instinct = createInstinctStore({ projectHash: "abc", dataDir: dir });
    const events = createEventBus();
    new AgentForgeHarness({ session: createMemorySession(), events, tools: [], provider: "xiaomi-token-plan-cn", model: "mimo-v2.5-pro", systemPrompt: "BASE", streamFn: mockStreamFn, instinct });
    events.emit({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: false } as any);
    const lines = readFileSync(join(dir, "projects/abc/observations.jsonl"), "utf-8").trim();
    expect(lines).toBeTruthy();
  });
  it("extract() delegates to instinctStore.extract()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "h-inst-"));
    const instinct = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun: async () => [] });
    const spy = vi.spyOn(instinct, "extract").mockResolvedValue();
    const h = new AgentForgeHarness({ session: createMemorySession(), events: createEventBus(), tools: [], provider: "xiaomi-token-plan-cn", model: "mimo-v2.5-pro", systemPrompt: "BASE", streamFn: mockStreamFn, instinct });
    await h.extract();
    expect(spy).toHaveBeenCalled();
  });
  it("maybeAuditBudget passes baseSystemPrompt + memory (no double count)", () => {
    // 注入 modelContextWindow + instinct（有 instinct 块），跑 prompt（mock），断言 context_budget 事件 components.systemPrompt == estimate(BASE)、components.memory == estimate(块)
  });
});
```

- [ ] **Step 2: 跑测试验 RED**

Run: `pnpm --filter @agentforge/harness test -- harness.test.ts`
Expected: FAIL（HarnessOptions.instinct 不存在）

- [ ] **Step 3: 写实现**

`harness.ts`：
- import `InstinctStore`, `formatInstinctsForSystemPrompt`
- `HarnessOptions` 加 `instinct?: InstinctStore;`
- 构造器加字段 + apply + observe：
```ts
private readonly _instinct?: InstinctStore;
private readonly _baseSystemPrompt: string;
private readonly _instinctBlock: string;
// constructor 内（在 new Agent 前）：
this._instinct = opts.instinct;
this._baseSystemPrompt = opts.systemPrompt;
let instinctBlock = "";
if (this._instinct) {
  try {
    const all = this._instinct.loadInstincts();
    const filtered = all.filter(i => i.confidence >= 0.5).sort((a,b) => b.confidence - a.confidence).slice(0, 20);
    instinctBlock = formatInstinctsForSystemPrompt(filtered);
  } catch { instinctBlock = ""; }
}
this._instinctBlock = instinctBlock;
// Agent initialState.systemPrompt 改为：opts.systemPrompt + instinctBlock
// new Agent(...) 之后：
if (this._instinct) this.events.on("*", (e) => this._instinct!.observe(e));
```
- 加方法：
```ts
async extract(signal?: AbortSignal): Promise<void> { await this._instinct?.extract(signal); }
get instinctStore(): InstinctStore | undefined { return this._instinct; }
```
- `maybeAuditBudget` 改 audit 输入：
```ts
const report = audit({
  systemPrompt: this._baseSystemPrompt,  // 非 _agent.state.systemPrompt（避免双重计算）
  skills: [], tools: this._agent.state.tools, messages: this._agent.state.messages,
  modelContextWindow: this.modelContextWindow, thresholds: this.budgetThresholds,
  memory: this._instinctBlock || undefined,
});
```

- [ ] **Step 4: 跑测试验 GREEN + build**

Run: `pnpm --filter @agentforge/harness test -- harness.test.ts && pnpm --filter @agentforge/harness build`
Expected: PASS + build Done

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/harness.ts packages/harness/src/harness.test.ts
git commit -m "feat(harness): instinct 集成 apply/observe/extract + maybeAuditBudget memory（Slice 4-B T7）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: cli instinct-config（createExtractRun + computeProjectHash + createInstinctConfig）

**Files:**
- Create: `packages/cli/src/instinct-config.ts`, `packages/cli/src/instinct-config.test.ts`

**Interfaces:**
- Consumes: `completeSimple`/`getModel`（pi-ai）+ `getApiKeyFromEnv`（env-config）+ `createInstinctStore`/`EXTRACT_PROMPT`（harness）
- Produces: `createExtractRun(model, getApiKey, provider, completeSimpleFn?): ExtractRun` + `computeProjectHash(opts?): string | null` + `createInstinctConfig(opts): { instinct: InstinctStore }`

- [ ] **Step 1: 写失败测试**

`instinct-config.test.ts`：
```ts
import { describe, it, expect, vi } from "vitest";
import { createExtractRun, computeProjectHash } from "./instinct-config.js";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";

describe("createExtractRun", () => {
  it("calls completeSimple + parses JSON instincts", async () => {
    const completeSimple = vi.fn(async () => ({ content: [{ type: "text", text: '{"instincts":[{"trigger":"t","action":"a","confidence":0.5,"domain":"x","evidence":[]}]}' }] }));
    const getApiKey = vi.fn(async () => "key");
    const run = createExtractRun({} as any, getApiKey, "xiaomi-token-plan-cn", completeSimple);
    const out = await run([{ timestamp: 1, projectHash: null, kind: "tool_call", data: {} }]);
    expect(completeSimple).toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].trigger).toBe("t");
  });
  it("returns [] on malformed JSON", async () => {
    const completeSimple = vi.fn(async () => ({ content: [{ type: "text", text: "not json" }] }));
    const run = createExtractRun({} as any, async () => "key", "p", completeSimple);
    expect(await run([])).toEqual([]);
  });
});

describe("computeProjectHash", () => {
  it("env override wins", () => {
    process.env.AGENTFORGE_PROJECT_DIR = "/some/dir";
    const h = computeProjectHash({ execSync: () => "" } as any);
    delete process.env.AGENTFORGE_PROJECT_DIR;
    expect(h).toMatch(/^[a-f0-9]{12}$/);
  });
  it("git remote → sha256 12", () => {
    const execSync = vi.fn((cmd: string) => cmd.startsWith("git remote") ? "https://github.com/x/y.git\n" : "");
    expect(computeProjectHash({ execSync } as any)).toMatch(/^[a-f0-9]{12}$/);
  });
  it("repo path fallback when no remote", () => {
    const execSync = vi.fn((cmd: string) => { if (cmd.startsWith("git remote")) throw new Error("no remote"); return "/repo/path\n"; });
    expect(computeProjectHash({ execSync } as any)).toMatch(/^[a-f0-9]{12}$/);
  });
  it("global null when all fail", () => {
    const execSync = vi.fn(() => { throw new Error("no git"); });
    expect(computeProjectHash({ execSync } as any)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试验 RED**

Run: `pnpm --filter @agentforge/cli test -- instinct-config.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`packages/cli/src/instinct-config.ts`：
```ts
import { completeSimple, getModel } from "@earendil-works/pi-ai";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createInstinctStore, EXTRACT_PROMPT, type ExtractRun, type Instinct, type Observation } from "@agentforge/harness";

export function createExtractRun(
  model: ReturnType<typeof getModel>,
  getApiKey: (provider: string) => string | undefined | Promise<string | undefined>,
  provider: string,
  completeSimpleFn: typeof completeSimple = completeSimple,
): ExtractRun {
  return async (observations: Observation[], signal?: AbortSignal): Promise<Instinct[]> => {
    const apiKey = await getApiKey(provider);
    const res = await completeSimpleFn(model, { systemPrompt: EXTRACT_PROMPT, messages: [{ role: "user", content: JSON.stringify(observations) }] }, { apiKey, signal });
    const text = (res.content as any[]).find((b) => b?.type === "text")?.text ?? "";
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed.instincts) ? parsed.instincts : [];
    } catch { return []; }
  };
}

function hash(s: string): string { return createHash("sha256").update(s).digest("hex").slice(0, 12); }

export function computeProjectHash(opts?: { execSync?: typeof execSync }): string | null {
  const exec = opts?.execSync ?? execSync;
  if (process.env.AGENTFORGE_PROJECT_DIR) return hash(process.env.AGENTFORGE_PROJECT_DIR);
  try { return hash(exec("git remote get-url origin", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim()); } catch { /* no remote */ }
  try { return hash(exec("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim()); } catch { /* not a repo */ }
  return null;
}

export function createInstinctConfig(opts: {
  provider: string; model: string; getApiKey: (provider: string) => string | undefined | Promise<string | undefined>;
  dataDir?: string;
}): { instinct: ReturnType<typeof createInstinctStore> } {
  const model = getModel(opts.provider as any, opts.model as any);
  const extractRun = createExtractRun(model, opts.getApiKey, opts.provider);
  const projectHash = computeProjectHash();
  const instinct = createInstinctStore({ projectHash, extractRun, dataDir: opts.dataDir, modelContextWindow: model.contextWindow });
  return { instinct };
}
```

- [ ] **Step 4: 跑测试验 GREEN + typecheck**

Run: `pnpm --filter @agentforge/cli test -- instinct-config.test.ts && pnpm --filter @agentforge/cli typecheck`
Expected: PASS + Done

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/instinct-config.ts packages/cli/src/instinct-config.test.ts
git commit -m "feat(cli): instinct-config createExtractRun + computeProjectHash + createInstinctConfig（Slice 4-B T8）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: cli 三模式 wiring + /instincts + session end extract

**Files:**
- Modify: `packages/cli/src/print-mode.ts`, `repl.ts`, `rpc.ts`, `print-mode.test.ts`, `repl.test.ts`

**Interfaces:**
- Consumes: `createInstinctConfig`（T8）+ `harness.extract()`/`harness.instinctStore`（T7）
- Produces: print 完成 / repl 退出调 `harness.extract()`；repl `/instincts` 命令；rpc 注入 InstinctStore（observe/apply，extract defer）

- [ ] **Step 1: 写失败测试**

`print-mode.test.ts` 加：
```ts
it("calls harness.extract() after prompt", async () => {
  let extracted = false;
  const streamFn = /* mock 返回 assistant 文本，仿现有 print-mode 测试 mockStreamFn */;
  await runPrintMode(["-p", "hi"], { streamFn, getApiKey: () => "k", onHarnessCreated: (h) => { vi.spyOn(h, "extract").mockImplementation(async () => { extracted = true; }); } });
  expect(extracted).toBe(true);
});
```
`repl.test.ts` 加：
```ts
it("/instincts command prints instinct list (not prompt)", async () => {
  // 注入含 instinct 的 InstinctStore（deps 加 instinct 注入点 或 onHarnessCreated spy loadInstincts），input 推 "/instincts" + null，断言 output 含 instinct 行 + 未调 prompt
});
it("calls harness.extract() on exit", async () => {
  // input 推 "exit"，spy harness.extract（onHarnessCreated），断言调用
});
```

- [ ] **Step 2: 跑测试验 RED**

Run: `pnpm --filter @agentforge/cli test -- print-mode.test.ts repl.test.ts`
Expected: FAIL（extract 未调 / /instincts 未处理）

- [ ] **Step 3: 写实现**

`print-mode.ts` `runPrintMode`：
- 构造 `const instinctCfg = createInstinctConfig({ provider: args.provider, model: args.model, getApiKey: deps.getApiKey ?? (() => undefined) });`
- harness 构造加 `instinct: instinctCfg.instinct`
- `await harness.prompt(args.prompt);` 后加：
```ts
try { await harness.extract(); } catch { /* best-effort, session end */ }
```

`repl.ts`：
- `buildHarness` opts 加 `instinct?: InstinctStore`，透传到 `new AgentForgeHarness({..., instinct: opts.instinct})`
- `runReplMode` 构造 `const instinctCfg = createInstinctConfig({ provider: args.provider, model: args.model, getApiKey: deps.getApiKey ?? (() => undefined), dataDir: deps.instinctDataDir });`，传 `instinct: instinctCfg.instinct` 给 buildHarness
- REPL 循环 `if (trimmed === "/instincts")` 分支（在 EXIT_COMMAND 检查前）：
```ts
if (trimmed === "/instincts") {
  const all = harness.instinctStore?.loadInstincts() ?? [];
  output.write(formatInstinctsList(all) + "\n");
  continue;
}
```
- 循环 break 后（EOF/exit，return 前）：
```ts
try { await harness.extract(); } catch { /* best-effort */ }
```
- 加 `formatInstinctsList(instincts: Instinct[]): string`（在 repl.ts 或 instinct-config.ts）：空返回 "No instincts learned yet for this project."；非空每行 `id | scope | confidence | trigger → action (evidence: N)`

`rpc.ts`：`buildHarness` 调用透传 `instinct`（rpc 注入 observe/apply；extract 不触发——rpc 无明确 session end，defer）。

- [ ] **Step 4: 跑测试验 GREEN + typecheck + build**

Run: `pnpm --filter @agentforge/cli test && pnpm --filter @agentforge/cli build`
Expected: PASS + Done

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/print-mode.ts packages/cli/src/repl.ts packages/cli/src/rpc.ts packages/cli/src/print-mode.test.ts packages/cli/src/repl.test.ts
git commit -m "feat(cli): instinct 三模式 wiring + /instincts + session end extract（Slice 4-B T9）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: 真对话验证 + memory/ledger/handoff

**Files:** 无产品代码（验证 + 文档更新：memory + ledger + handoff）

- [ ] **Step 1: 全量回归**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: 3 包 typecheck Done + 全测试 PASS（shared + harness + cli，预期 +N instinct 相关测试）

- [ ] **Step 2: 真对话验证（MiMo，需 XIAOMI_TOKEN_PLAN_CN_API_KEY + AGENTFORGE_PROJECT_DIR 固定 hash 避免污染）**

Run:
```bash
export AGENTFORGE_PROJECT_DIR=/tmp/instinct-dogfood
export XIAOMI_TOKEN_PLAN_CN_API_KEY=<key>
cd packages/cli && node dist/index.js -p "读 package.json 报告 name，然后故意用 pnpm -r test（会失败）"
# session end extract 跑（stderr 无 fatal）
ls ~/.agentforge/projects/<hash-of-/tmp/instinct-dogfood>/instincts/
# 重启 session 验证 apply（repl /instincts 查）
node dist/index.js
# > /instincts
```
Expected: ①print 链路通 ②session end extract 产出 instinct 文件 ③重启 session `/instincts` 列出学到的 instinct。若 extract 产出平凡/空，回看 T1 gate 结论是否需调 EXTRACT_PROMPT。

- [ ] **Step 3: 更新 memory + ledger + handoff**

- memory `agentforge-project-direction.md`：加 Slice 4-B 完成段（instinct 闭环 + memory 组件 + /instincts + T1 gate 结论 + confidence 校准结果）
- ledger `.superpowers/sdd/progress.md`：加 Slice 4-B 段（每 task commit + T1 gate + T10 真对话结果）
- handoff `%TEMP%\agentforge-slice4b-handoff.md`：下次会话焦点（defer 项：promote/evolve/阈值触发/检索 apply/rpc extract/observations 归档）+ 关键陷阱

- [ ] **Step 4: Commit 文档**

```bash
git add <memory 文件> .superpowers/sdd/progress.md
git commit -m "docs: Slice 4-B instinct 完成（memory + ledger + handoff）

Co-Authored-By: Claude <noreply@anthropic.com>"
```
（handoff 在 %TEMP%，不 commit）

---

## Self-Review（plan 作者自检）

**Spec coverage**：spec §2 范围逐项 → observe(T3) / extract(T5) / apply(T7) / project scope(T8 computeProjectHash) / memory 组件(T6) / /instincts(T9) 全覆盖。§3 D1-D5 决策 → D1 extract LLM(T5/T8) / D2 跨 session(T7 apply 构造 + T9 session end extract) / D3 全量 systemPrompt(T7) / D4 三级 fallback(T8) / D5 session end 同步(T9)。§7.2 红队修正（T1 gate / confidence 校准 / 体积 backstop / trigger 相等查重）→ T1/T5。§7.4 双重计算 → T6+T7。§9 T1 探针 → T1。覆盖完整。

**Placeholder scan**：T9 Step 1 的 `mockStreamFn` 标注"仿现有 print-mode 测试"——实现指引非 placeholder（现有测试已有 mockStreamFn 模式）。T7/T9 部分测试用注释描述断言（如 "apply filters cap 20"）——implementer 据描述补全断言（模式与现有 harness.test.ts 一致）。其余无 TBD/TODO。

**Type consistency**：`InstinctStore` 接口（observe/loadInstincts()/extract）T2-T5 一致（loadInstincts 无参，用 store.projectHash）；`createInstinctStore` 签名 T3 定义、T8 调用一致；`HarnessOptions.instinct?` T7 定义、T9 wiring 一致；`ExtractRun` T5/T8 一致；`BudgetAuditInput.memory?` T6 定义、T7 调用一致；`deriveId` T2 定义、T5 调用一致；`computeProjectHash` T8 定义、T9 createInstinctConfig 内调用一致。T5 extract 内读 instinct 的 `loadInstinctsAll` 与 T4 `loadInstincts` 共享逻辑——已注明 implementer 抽模块级函数复用。

**风险提示**：T1 gate 是 make-or-break（learning 有效性），若 gate 不通过需重设 EXTRACT_PROMPT 后再进 T2。T9 rpc extract defer（spec §7.5 + D5），rpc-only 用户 observations 累积不提炼——已知边界。T5 `id.replace(/(-\d+)?$/, ...)` 后缀逻辑：`when-x` → `when-x-2`（首次碰撞 m="" → "-2"），`when-x-2` → `when-x-3`（m="-2" → "-3"）——implementer 验正则行为匹配 T5 测试期望。
