# Slice 4-A SUMMARIZE_PROMPT 质量改进 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确认 SUMMARIZE_PROMPT 对真实代码对话是否幻觉，若幻觉则通过措辞重写（保持 systemPrompt channel，单变量）改进摘要质量。

**Architecture:** 探索性 slice——"验证→改进→回归→可能轮试"循环，非纯 TDD 线性。Task 1 是 gate（真实端到端验证），结果决定 Task 2+ 是否执行。改进首选 Approach A（只改 SUMMARIZE_PROMPT 措辞，保持 systemPrompt channel——T9 证 systemPrompt effective，根因是措辞）；channel swap（B）/ streamSimple（C）为条件性轮试。

**Tech Stack:** TypeScript, vitest, pnpm monorepo（shared/harness/cli）, `@earendil-works/pi-ai`（completeSimple/getModel）, `@earendil-works/pi-agent-core`（AgentMessage）, DeepSeek（deepseek-v4-pro）。

## Global Constraints

- pi 分支无 remote，commit 留本地**不 push**。
- commit message 结尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- vitest dev condition vs tsc dist 陷阱：改 `@agentforge/harness`/`shared` 后须 `pnpm --filter @agentforge/<pkg> build` rebuild dist；cli 改也须 `pnpm --filter @agentforge/cli build`（bin 跑 dist/index.js）。
- 真实端到端需 `DEEPSEEK_API_KEY`（新 key，旧需轮换——前会话暴露 3 次）。从 repo 根跑：`DEEPSEEK_API_KEY=<key> node packages/cli/dist/index.js -p "..."`（`pnpm exec agentforge -p` 被 pnpm 拦 -p）。
- pi-ai 真实签名须验 `node_modules/.pnpm/@earendil-works+pi-ai@*/dist/*.d.ts`（plan 代码是起点非定论）。
- `SUMMARIZE_PROMPT` 在 `packages/cli/src/compaction-config.ts:12-16`；`createSummaryGenerator` 在 `:21-39`。
- `compactionTokenThreshold` 默认 100000（`packages/harness/src/harness.ts:118`），由 `buildCompactionContext` 填入 `ctx.tokenThreshold`（harness.ts:360）。
- 探索性 slice：Task 1 是 gate，不幻觉→跳 Task 2-5 直接 Task 6 关闭；幻觉→Task 2+。

---

### Task 1: 前置验证探针（gate，探索性）

**Files:**
- Modify（临时）: `packages/harness/src/harness.ts:118`
- 临时测试脚本（不提交）: 跑 agentforge 真实代码对话

**Interfaces:**
- Consumes: 现有 cli print 链路 + DeepSeek 真实 LLM
- Produces: 决策结论（幻觉 / 误报）记 ledger，决定 Task 2+ 是否执行

**目的**：T9 用 computing essay（非代码）测出幻觉，但 SUMMARIZE_PROMPT 为代码 agent 设计。本 task 用真实代码对话确认是否真幻觉。

- [ ] **Step 1: 临时调低 compactionTokenThreshold 触发 compaction**

改 `packages/harness/src/harness.ts:118`：
```ts
// 临时：100000 → 100（探针，Task 1 末 revert）
this.compactionTokenThreshold = opts.compactionTokenThreshold ?? 100;
```
Run: `pnpm --filter @agentforge/harness build`
Expected: dist rebuild 成功

- [ ] **Step 2: 跑真实代码对话触发 compaction**

准备一个临时代码任务（read + edit + 多 turn），从 repo 根跑：
```bash
DEEPSEEK_API_KEY=<key> node packages/cli/dist/index.js -p "读 packages/cli/package.json 报告 name 字段，然后编辑 /tmp/agentforge-probe.txt 写入 'probe' 再读回"
```
观察输出：compaction 事件 + generateSummary 产生的 summary 文本。

为捕获 summary，可临时在 `packages/cli/src/compaction-config.ts` 的 `createSummaryGenerator` 返回前 `console.error("[SUMMARY]", textBlock?.text)`（Task 1 末移除）。

- [ ] **Step 3: 人工判断 summary**

判断标准：
- **真实摘要**：含 read 的文件路径（package.json）、edit 的文件（/tmp/agentforge-probe.txt）、任务内容关键词 → 不幻觉
- **幻觉**：含无关内容（如 T9 的 BeamMP/garden）或编造未发生的事 → 幻觉

- [ ] **Step 4: revert 临时改动**

- `harness.ts:118` 改回 `?? 100000`
- 移除 compaction-config.ts 的临时 `console.error`
Run: `pnpm --filter @agentforge/harness build && pnpm --filter @agentforge/cli build`
Run: `pnpm -r test` Expected: 271 绿（无回归）

- [ ] **Step 5: 记录决策到 ledger**

在 `.superpowers/sdd/progress.md` 追加 "## Slice 4-A 前置验证" 段，记录：
- 验证输入（代码任务描述）
- summary 实际输出（摘要或幻觉示例）
- 结论：**幻觉** → 进 Task 2；**不幻觉** → 4-A 关闭（T9 是非代码场景失败，code scope 内 prompt 可用），跳 Task 2-5，进 Task 6

- [ ] **Step 6: Commit（仅 ledger，临时改动已 revert）**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs(ledger): Slice 4-A 前置验证结论

Co-Authored-By: Claude <noreply@anthropic.com>"
```

> **决策点**：若 Step 5 结论为"不幻觉"，Task 2-5 跳过，直接 Task 6（更新 memory + final）。若"幻觉"，继续 Task 2。

---

### Task 2: Approach A — SUMMARIZE_PROMPT 措辞重写（TDD）

> 仅当 Task 1 结论为"幻觉"时执行。

**Files:**
- Modify: `packages/cli/src/compaction-config.ts:12-16`（SUMMARIZE_PROMPT 常量）
- Test: `packages/cli/src/compaction-config.test.ts`

**Interfaces:**
- Consumes: 现有 `createSummaryGenerator`（传法不变，Approach A 仅改 prompt 文本）
- Produces: 新 `SUMMARIZE_PROMPT`（含强约束 "Do NOT invent"），传法保持 `{systemPrompt: SUMMARIZE_PROMPT, messages}`

- [ ] **Step 1: 写失败测试**

在 `packages/cli/src/compaction-config.test.ts` 的 `describe("createCompactionConfig")` 内追加：
```ts
it("SUMMARIZE_PROMPT contains anti-hallucination constraint (Approach A)", () => {
  // T9 暴露 DeepSeek 对旧 prompt 幻觉；新 prompt 须明确禁止编造
  expect(SUMMARIZE_PROMPT).toMatch(/Do NOT invent/i);
  expect(SUMMARIZE_PROMPT).toMatch(/Do NOT continue the conversation/i);
});

it("generateSummary keeps systemPrompt channel + messages in order (Approach A: wording-only)", async () => {
  const { completeSimple } = await import("@earendil-works/pi-ai");
  (completeSimple as any).mockClear();
  const cfg = createCompactionConfig({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    getApiKey: () => "key",
  });
  const msgs: AgentMessage[] = [
    { role: "user", content: "q1", timestamp: 0 } as AgentMessage,
    { role: "assistant", content: [{ type: "text", text: "a1" }], timestamp: 1 } as AgentMessage,
  ];
  await cfg.compactorDeps.generateSummary(msgs);
  const call = (completeSimple as any).mock.calls.at(-1);
  // Approach A: systemPrompt = SUMMARIZE_PROMPT（channel 不变，未移到 user message）
  expect(call?.[1]?.systemPrompt).toBe(SUMMARIZE_PROMPT);
  // messages 原序，未在首插指令 user message
  expect(call?.[1]?.messages).toEqual(msgs as unknown as any[]);
});
```

- [ ] **Step 2: 运行测试验证其失败**

Run: `pnpm --filter @agentforge/cli test -- compaction-config`
Expected: 第一个测试 FAIL（旧 SUMMARIZE_PROMPT 无 "Do NOT invent"）；第二个测试 PASS（传法未变）

- [ ] **Step 3: 重写 SUMMARIZE_PROMPT**

改 `packages/cli/src/compaction-config.ts:12-16`：
```ts
/**
 * generateSummary 的 systemPrompt。Slice 4-A Approach A：加强约束禁止幻觉
 * （T9 暴露 DeepSeek 对旧措辞产生不相关幻觉）。保持 systemPrompt channel
 * 不变（T9 证 systemPrompt effective，根因是措辞）。channel swap（B）/streamSimple（C）
 * 为轮试候选，见 plan Task 5。
 */
export const SUMMARIZE_PROMPT =
  "Summarize the preceding conversation for context retention. " +
  "Output ONLY a factual summary. Do NOT continue the conversation. " +
  "Do NOT invent or add information not present in the conversation. " +
  "Preserve: key decisions and their rationale; files read/written/edited " +
  "(with paths); important errors encountered and resolutions; unfinished tasks. " +
  "Omit verbatim tool-call arguments and large file contents.";
```

- [ ] **Step 4: 运行测试验证其通过**

Run: `pnpm --filter @agentforge/cli test -- compaction-config`
Expected: PASS（两个新测试 + 现有 4 测试全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/compaction-config.ts packages/cli/src/compaction-config.test.ts
git commit -m "feat(cli): SUMMARIZE_PROMPT 加强约束禁止幻觉（Slice 4-A Approach A）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: known-broken case 回归 guard（env-gated 真实 LLM）

> 仅当 Task 1 结论为"幻觉"时执行。与 Task 2 独立，可并行。

**Files:**
- Create: `packages/cli/src/compaction-config.real-llm.test.ts`（单独文件，不与 mock 冲突）

**Interfaces:**
- Consumes: `createCompactionConfig` + 真实 pi-ai completeSimple（不 mock）
- Produces: env-gated 回归 guard，防 prompt 改动引入新幻觉

**设计说明**：compaction-config.test.ts 顶部 `vi.mock("@earendil-works/pi-ai")` mock 了 completeSimple。known-broken guard 需真实 LLM，故放单独文件不 mock。LLM 输出非确定，测试标 `describe.skipIf(!process.env.DEEPSEEK_API_KEY)`——仅手动跑，不进默认 CI（可能 flaky）。

- [ ] **Step 1: 写 guard 测试**

创建 `packages/cli/src/compaction-config.real-llm.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createCompactionConfig } from "./compaction-config.js";

/**
 * known-broken case 回归 guard（red-team Finding 5）。
 * 真实 LLM，非确定——仅 DEEPSEEK_API_KEY 存在时跑，手动执行，可能 flaky。
 * 防止 prompt 改动对固定非代码输入引入新幻觉（T9 的 BeamMP/garden 失败模式）。
 * 非代码输入 out of scope（spec §1），此 guard 仅作 prompt 健壮性回归。
 */
describe.skipIf(!process.env.DEEPSEEK_API_KEY)(
  "known-broken case regression guard (real LLM, non-deterministic, manual)",
  () => {
    it("summary for non-code input stays on-topic (no BeamMP/garden hallucination)", async () => {
      const nonCodeMessages: AgentMessage[] = [
        { role: "user", content: "Explain how a CPU pipeline works in computing.", timestamp: 0 } as AgentMessage,
        { role: "assistant", content: [{ type: "text", text: "A CPU pipeline splits instruction execution into stages..." }], timestamp: 1 } as AgentMessage,
      ];
      const cfg = createCompactionConfig({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        getApiKey: () => process.env.DEEPSEEK_API_KEY!,
      });
      const summary = await cfg.compactorDeps.generateSummary(nonCodeMessages);
      // on-topic：含输入领域关键词
      expect(summary.toLowerCase()).toMatch(/cpu|pipeline|instruction|stage/);
      // 无 T9 已知幻觉词
      expect(summary.toLowerCase()).not.toMatch(/beammp|garden/);
    });
  },
);
```

- [ ] **Step 2: 验证默认 skip（无 KEY 不跑）**

Run: `pnpm --filter @agentforge/cli test -- compaction-config.real-llm`
Expected: 0 tests ran（skipIf 无 KEY 跳过），不阻塞默认 vitest run

- [ ] **Step 3: 手动跑 guard（有 KEY 时，验证 Task 2 改进）**

Run: `DEEPSEEK_API_KEY=<key> pnpm --filter @agentforge/cli test -- compaction-config.real-llm`
Expected: PASS（summary on-topic，无幻觉词）。若 FAIL——说明 Approach A 措辞改进对该非代码输入仍幻觉，记录为已知限制（非代码 out of scope，非阻塞），进 Task 4 用代码输入验证。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/compaction-config.real-llm.test.ts
git commit -m "test(cli): known-broken case 回归 guard（env-gated 真实 LLM，Slice 4-A）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 回归验证 — 改进后真实代码对话（探索性）

> 仅当 Task 1 结论为"幻觉"且 Task 2 完成时执行。

**Files:**
- 临时脚本（不提交）: 同 Task 1 流程

**目的**：Approach A 措辞改进后，用真实代码对话验证摘要质量改善。

- [ ] **Step 1: 临时调低阈值 + 跑改进后代码对话**

同 Task 1 Step 1-2（harness.ts:118 临时 `?? 100`，rebuild，跑代码任务，捕获 summary）。

- [ ] **Step 2: 人工判断改进效果**

对比 Task 1 的 summary：
- **改善**：summary 含 read/edit 文件路径 + 任务内容，无幻觉 → Approach A 有效
- **不足**：仍幻觉或低质 → 进 Task 5 轮试 B/C

- [ ] **Step 3: revert + 记录**

revert harness.ts:118 → 100000 + 移除临时 console.error，rebuild。在 ledger "Slice 4-A" 段记录回归结论。

- [ ] **Step 4: Commit ledger**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs(ledger): Slice 4-A Approach A 回归验证结论

Co-Authored-By: Claude <noreply@anthropic.com>"
```

> **决策点**：改善→Task 6（final）。不足→Task 5 轮试。

---

### Task 5: 轮试 B/C（条件性）

> 仅当 Task 4 结论为"Approach A 不足"时执行。每个 approach 独立 TDD + 真实回归。

**Files:**
- B: Modify `packages/cli/src/compaction-config.ts:21-39`（createSummaryGenerator 传法）
- C: Modify `packages/cli/src/compaction-config.ts:31-35`（completeSimple→streamSimple）+ 验 pi-ai streamSimple 签名

**Approach B — channel swap（摘要指令移 user message）**:
- [ ] **B1: 写失败测试**——断言 completeSimple 收到 `systemPrompt: "You are a summarization assistant."` + messages 首条是 `{role:"user", content: SUMMARIZE_PROMPT}` + 原 messages 随后
- [ ] **B2: 跑失败**（旧传法 systemPrompt=SUMMARIZE_PROMPT）
- [ ] **B3: 改 createSummaryGenerator**——构造 `summaryInstructionUserMsg`，`messages: [summaryInstructionUserMsg, ...messages]`，systemPrompt 极简角色
- [ ] **B4: 跑通过**
- [ ] **B5: 真实回归**（同 Task 4 流程）——观察连续 user 是否困惑；若困惑用 fallback (ii) 扁平化（**须加测试覆盖扁平化形态，护 AgentMessage→Message 契约**，spec §4.2 数据契约风险）
- [ ] **B6: Commit**（若有效）/ 记录不足（若无效）→ 进 C

**Approach C — streamSimple**:
- [ ] **C1: 验 pi-ai streamSimple 签名**——`Grep "streamSimple" node_modules/.pnpm/@earendil-works+pi-ai@*/dist/*.d.ts`，确认参数/返回（流式 vs completeSimple 非流式）
- [ ] **C2-C6**: TDD 改 completeSimple→streamSimple + 真实回归 + commit

> **收敛**：某 approach 真实端到端摘要可接受→定稿进 Task 6。穷尽 A/B/C 仍不足→Task 6 记录限制（含模型适配未评估，spec §2.2）+ 降级（调低 compactionTokenThreshold 默认/禁用 compaction）+ 触发重审"换模型"决策（spec §7 Escalation）。

---

### Task 6: ledger + memory + final

**Files:**
- Modify: `.superpowers/sdd/progress.md`（ledger）
- Modify: `~/.claude/projects/C--Users-90514-code-primo-agentforge/memory/agentforge-project-direction.md`（memory）
- Verify: 3 包 typecheck + test + dist

- [ ] **Step 1: 全量回归**

Run: `pnpm -r typecheck` Expected: 3 包 Done
Run: `pnpm -r test` Expected: shared4 + harness140 + cli128+ 绿（Task 2 加 2 测试 + Task 3 guard skip 默认不跑）

- [ ] **Step 2: rebuild dist**

Run: `pnpm --filter @agentforge/cli build && pnpm --filter @agentforge/harness build`
（cli 改了 compaction-config.ts，须 rebuild cli dist 供真对话）

- [ ] **Step 3: 更新 ledger**

在 `.superpowers/sdd/progress.md` 追加 "## Slice 4-A SUMMARIZE_PROMPT 质量改进" 段：Task 1 验证结论、改进 approach（A/B/C 哪个收敛）、回归结果、已知限制、commit 链。

- [ ] **Step 4: 更新 memory**

更新 `agentforge-project-direction.md` 的"下一步"段：4-A 完成（结论 + approach），下一步 4-B instinct brainstorm。

- [ ] **Step 5: Commit ledger + memory**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs(ledger): Slice 4-A 完成

Co-Authored-By: Claude <noreply@anthropic.com>"
```
（memory 在 ~/.claude 下，不进 repo commit）

- [ ] **Step 6: final review（可选）**

若 4-A 改了产品代码（Task 2/5），可 invoke red-team 或 whole-branch review 确认无回归。纯 prompt 改动 + 测试，final review 可选。

---

## Self-Review（plan 作者自检）

**1. Spec coverage**：
- §1 背景/caveat → Task 1 探针验证 ✓
- §2 范围（含/不含）→ Task 1-6 覆盖含项；不含项（分段/instinct/阶段边界/streamSimple 全链路/模型适配）明确排除 ✓
- §3 条件分支 → Task 1 Step 5 决策点 + Task 2-5 条件执行 ✓
- §4 改进方案 A/B/C → Task 2（A）/ Task 5（B/C）✓
- §5 数据流/错误处理 → 不变，Task 2 仅改 prompt 文本 ✓
- §6 测试策略 → Task 2 单元 + Task 3 known-broken guard + Task 1/4 真实端到端 ✓
- §7 探索性迭代 → Task 1→2→4→5 循环 + Task 5 收敛/降级 ✓
- §8 实现位置 → compaction-config.ts + test + dist rebuild ✓
- §10 成功标准/限制 → Task 6 ledger/memory + §2.2 模型适配限制记录 ✓

**2. Placeholder scan**：无 TBD/TODO；Task 5 B/C 给了具体步骤但标"条件性"（依赖 Task 4），非 placeholder——是条件分支。✓

**3. Type consistency**：`SUMMARIZE_PROMPT`（string 常量）、`createCompactionConfig`（返回 4 字段）、`generateSummary(messages, signal)`、`completeSimple(model, context, options)` 签名跨 task 一致。`compactionTokenThreshold`（harness.ts:118/360）引用一致。✓
