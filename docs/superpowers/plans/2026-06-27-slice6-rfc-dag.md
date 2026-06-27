# Slice 6:RFC-DAG 循环模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/cli/src/rfc-dag/` 实现 RFC-DAG 循环模式(RFC→AI 分解依赖 DAG→拓扑串行调度→per-unit worktree 隔离→gate→merge queue→final verify),自举 dry-run 在 agentforge 自身上验证 DAG 编排骨架 + 文件 resumable + 轻量 retry。

**Architecture:** 新 `RfcDagRunner`(纯逻辑编排)注入 factory + 接口(`gitOpsFactory`/`gateFactory` 多 cwd / `WorktreeOps` / `AgentRunner` / `DagDecomposer` / `RfcDagState`)+ 复用 continuous-PR `ExitCondition`/`checkExit`/`SantaVerifier`/`createLoopAgentDeps`。每 unit:worktree→agent(6 工具,fresh context 不注入 instinct/auditor/verifier/compactor)→commit→gate→merge(非 ff retryable)→state。失败 retry with context(`maxUnitRetries` 默认 2)。harness/shared/eval/loop 零改动,全落 cli。

**Tech Stack:** TypeScript / vitest / pnpm monorepo / `node:child_process`(git worktree+gate exec)/ `node:fs`(state.json)/ `@agentforge/harness`(`AgentForgeHarness`+`createSantaVerifier`)/ 复用 `packages/cli/src/loop/`(`GitOps`/`DryRunGitOps`/`Gate`/`LocalBuildGate`/`AgentRunner`/`InProcessAgentRunner`/`ExitCondition`/`createLoopAgentDeps`)。

## Global Constraints

- **分支 `pi`**(AGENTS.md):所有 commit 落 pi 分支。
- **commit message 末尾加** `Co-Authored-By: Claude <noreply@anthropic.com>`(AGENTS.md)。
- **仅在用户要求时 commit/push**(AGENTS.md):plan 内 Task commit step 是 TDD 频繁提交,执行者按 step 走;**不 push**(pi 无 remote)。
- **harness/shared/eval/loop 零改动**(spec D11):全部新代码落 `packages/cli/src/rfc-dag/`;不动已绿测试。仅 `index.ts` 加 `rfc-dag` 路由(非 breaking)。
- **不注入 instinct/auditor/verifier/compactor**(spec D12):unit agent 构造 harness 只注入 safety(不传 askHandler→ask 降级 deny)+ 基础 + `createLoopAgentDeps` 6 工具,fresh context。
- **多 cwd factory**(spec D13):`gitOpsFactory(cwd)`/`gateFactory(cwd)` 多实例(DryRunGitOps/LocalBuildGate 已有 {cwd}),勿共享单 cwd 实例。
- **worktree 残留用 `--force`**(red-team 🟡3):`addWorktree` = `git worktree add --force <path> -B <branch>`(--force 清路径残留,-B 重建 branch);≠ checkout -B branch 残留机制。
- **state2 全 5 字段**(red-team 🔴1):复用 `LoopState`(`runs`/`cost`/`durationMs`/`consecutiveCompletionSignals`/`consecutiveGateFailures`),后 2 counter per-unit 未用但必填,`checkExit` 才 typecheck。
- **merge 非 ff retryable**(red-team 🔴2):`DryRunGitOps.merge` 非 --ff-only;baseBranch 前进时可能 merge commit/冲突 → 当 retryable conflict(走 retry 路径)。删"串行免冲突"绝对语言。
- **DAG 语义校验限制**(red-team 🟡4):只校验 graph-validity(无环/依赖存在/≥1/max-units ≤20),不校验 missing dep/granularity/semantic。诚实标注。
- **reviewer 靠 diff text**(red-team 🟡5):`--review` reviewer 不在 worktree cwd(`createDefaultReviewerRun` 不传 cwd),靠 `wtGitOps.diff()` text 看改动。intentional。
- **GateGuard**(执行者会遇 hook):新文件 Write/Edit 需陈述 4 事实;Bash 需 2 事实。
- **包名**:`@agentforge/cli`(`pnpm --filter @agentforge/cli <script>`)。
- **TS strict**:`tsc` 零 error;`pnpm --filter @agentforge/cli typecheck` 必须过。改 harness export 后须 `pnpm --filter @agentforge/harness build` rebuild dist(老陷阱)。
- **`loop-mode.test.ts` diagnostics 前置确认**(Task 1 探针):该文件报 `AssistantMessage` 不导出(提示 `ProxyAssistantMessage`)。Task 1 确认是否 pre-existing tsc-only(vitest 走 development condition 仍绿)或 pi-agent-core 重命名;若阻塞 cli typecheck 先修 test import(非 RFC-DAG 代码)。

---

## File Structure

全部新文件落 `packages/cli/src/rfc-dag/`(6 src + 6 test),加 1 处 `index.ts` 路由修改。按依赖顺序:

| 文件 | 责任 | 依赖 |
|---|---|---|
| `rfc-dag/dag-decomposer.ts` | `DagDecomposer`:RFC→unit DAG(AI 产 JSON→parse 剥围栏→拓扑校验+max-units) | `../loop/agent-runner.js`(AgentRunner) |
| `rfc-dag/dag-scheduler.ts` | `DagScheduler`:拓扑序 `next`+依赖满足+串行+failed 下游 skipped(纯逻辑) | 无 |
| `rfc-dag/worktree-pool.ts` | `WorktreeOps` 接口 + `DryRunWorktreeOps`(`git worktree add --force -B` / `remove --force`) | `node:child_process` |
| `rfc-dag/rfc-dag-state.ts` | `RfcDagState`:文件 resumable `state.json`(save/load/reset/markUnit) | `node:fs` |
| `rfc-dag/rfc-dag-runner.ts` | `RfcDagRunner`:编排+retry with context+review+回滚 tag+final verify | 上面 4 + `../loop/*`(GitOps/Gate/AgentRunner/ExitCondition)+ `@agentforge/harness`(SantaVerifier) |
| `rfc-dag/rfc-dag-mode.ts` | `runRfcDagMode`:argv 解析+构造默认实现+wiring+输出摘要 | 上面 5 + `../loop/agent-deps.js`(createLoopAgentDeps)+ `../loop/loop-runner.js`(ReviewGate 类型) |
| `index.ts`(修改) | `argv[0]==="rfc-dag"` 子命令路由(与 `loop` 并列,优先于 -p/--rpc) | `rfc-dag-mode.ts` |

测试文件一一对应(`*.test.ts` 同目录)。

---

## Task 1:探针(验证复用签名 + 确认 loop-mode.test.ts diagnostics)

**Files:**
- 无产品代码创建(探针,只读验证);若 `loop-mode.test.ts` 阻塞 typecheck 则 Modify: `packages/cli/src/loop/loop-mode.test.ts`(修 import,非 RFC-DAG 代码)
- 无测试文件

**Interfaces:**
- Consumes: continuous-PR 已建抽象(`packages/cli/src/loop/`)+ `@agentforge/harness`
- Produces: 探针结论(记入 commit message + 本 plan Task 1 末尾"探针结论"段),供 Task 2-8 引用精确签名。**若探针发现签名与 spec 不符,停下来修正 spec/plan 再继续。**

**目的:** RFC-DAG load-bearing 复用 continuous-PR 抽象。red-team 已独立验证签名存在,但执行者须亲自确认(不信行号,信 grep)。同时确认 `loop-mode.test.ts` diagnostics 是否阻塞 cli typecheck。

- [ ] **Step 1: 确认 continuous-PR 抽象签名**

Grep/Read 验证以下签名(spec §4 引用,Task 2-8 依赖):
- `packages/cli/src/loop/agent-runner.ts`:`AgentRunner` 接口 `run(prompt: string, opts: { cwd: string; signal?: AbortSignal }): Promise<AgentRunResult>`;`AgentRunResult = { reply: string; cost: number; tokensIn: number; tokensOut: number }`;`InProcessAgentRunner` 构造 `{ provider, model, getApiKey, tools, systemPrompt, streamFn?, safety?, cwd? }`。
- `packages/cli/src/loop/git-ops.ts`:`GitOps` 接口含 `createBranch`/`checkout`/`commit`/`merge`/`currentBranch`/`hasChanges`/`deleteBranch`/`diff`/`tag`/`isClean`;`DryRunGitOps` 构造 `{ cwd }`;`MergeResult = { ok: boolean; conflict?: string }`。
- `packages/cli/src/loop/gate.ts`:`Gate` 接口 `run(): Promise<GateResult>`;`GateResult = { passed: boolean; output: string }`;`LocalBuildGate` 构造 `{ cwd, commands? }`。
- `packages/cli/src/loop/exit-condition.ts`:`LoopState`(5 字段)/`ExitConditionConfig`/`ExitDecision`/`checkExit(state, config)`(已存在,Task 6 复用,**不重写**)。
- `packages/cli/src/loop/loop-runner.ts`:`ReviewGate = { rubric: Rubric; verifier: SantaVerifier }` 类型 export(Task 6/7 引用)。
- `packages/cli/src/loop/agent-deps.ts`:`createLoopAgentDeps(opts)` 返回 `{ tools, systemPrompt, safety }`(Task 7 wiring 引用)。
- `packages/harness/src/verification.ts`:`createSantaVerifier(deps)` / `SantaVerifier.review(output, rubric): Promise<ReviewResult{verdict,issues}>`(Task 6/7 引用)。

Run: `grep -rn "export" packages/cli/src/loop/agent-runner.ts packages/cli/src/loop/git-ops.ts packages/cli/src/loop/gate.ts packages/cli/src/loop/exit-condition.ts packages/cli/src/loop/loop-runner.ts packages/cli/src/loop/agent-deps.ts`
Expected: 上述 interface/class/function 均在 export 列表。若有不符,记下差异。

- [ ] **Step 2: 确认 loop-mode.test.ts diagnostics 是否阻塞**

Run: `pnpm --filter @agentforge/cli typecheck 2>&1 | head -40`
Expected: 若仅 `loop-mode.test.ts` 报 `AssistantMessage`/`AssistantMessageEvent`/`AssistantMessageEventStream` 不导出(提示 `ProxyAssistantMessage`),且 src 文件无错 → pre-existing tsc-only(vitest 走 development condition 仍绿)。

Run: `pnpm --filter @agentforge/cli test 2>&1 | tail -20`
Expected: 测试仍绿(vitest 不 tsc test 文件)。确认 `AssistantMessage` 错误不阻塞 build(测试文件不进 build dist)。

- [ ] **Step 3: 若阻塞则修 loop-mode.test.ts import(非 RFC-DAG 代码)**

若 typecheck 因 test 文件失败阻塞 plan 验证:Read `loop-mode.test.ts:1-15`,将 `AssistantMessage`/`AssistantMessageEvent`/`AssistantMessageEventStream` 的 import 改为 pi-agent-core 当前导出名(grep `packages/cli/node_modules/@earendil-works/pi-agent-core/dist/*.d.ts` 确认实际导出,如 `ProxyAssistantMessageEvent` 或类型 re-export)。若不阻塞(测试绿、build 绿)→ 跳过,记为 separate 待办(continuous-PR 既有,非 RFC-DAG)。

- [ ] **Step 4: 记录探针结论 + Commit(若有 test 修复)**

探针结论(填入实际值):
- continuous-PR 抽象签名:✅ 全部匹配 spec §4 / ⚠️ 差异:[列]
- loop-mode.test.ts diagnostics:[pre-existing tsc-only 不阻塞 / 已修 import / 需 separate 待办]
- baseline:`pnpm --filter @agentforge/cli typecheck` [pass/fail],`pnpm --filter @agentforge/cli test` [N tests pass]

若 Step 3 修了 test:commit;若未改代码,本 task 无 commit(探针只读)。

```bash
# 仅在 Step 3 修改了 loop-mode.test.ts 时:
git add packages/cli/src/loop/loop-mode.test.ts
git commit -m "fix(loop): loop-mode.test.ts AssistantMessage import 对齐 pi-agent-core 导出(Task1 探针)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2:DagDecomposer(RFC→unit DAG)

**Files:**
- Create: `packages/cli/src/rfc-dag/dag-decomposer.ts`
- Test: `packages/cli/src/rfc-dag/dag-decomposer.test.ts`

**Interfaces:**
- Consumes: `AgentRunner`(from `../loop/agent-runner.js`)—— `run(prompt, { cwd })` 返 `{ reply, cost, ... }`;reply 含 AI 产的 unit list JSON(可能包 ```json 围栏)。
- Produces: `WorkUnit` / `Dag` / `DagDecomposer` 类型 + `DagDecomposer` 类。`RfcDagRunner`(Task 6)依赖 `decomposer.decompose(rfc): Promise<Dag>`。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/rfc-dag/dag-decomposer.test.ts
import { describe, it, expect, vi } from "vitest";
import { DagDecomposer } from "./dag-decomposer.js";
import type { AgentRunner, AgentRunResult } from "../loop/agent-runner.js";

/** 构造 mock agentRunner,reply 返回给定 JSON 字符串(可包围栏)。 */
function mockRunner(reply: string): AgentRunner {
	return {
		run: vi.fn(async (): Promise<AgentRunResult> => ({
			reply, cost: 0.01, tokensIn: 100, tokensOut: 200,
		})),
	};
}

const validUnitsJson = JSON.stringify([
	{ id: "u1", dependsOn: [], scope: "补 adr 测试", acceptanceTests: ["adr.test.ts 存在"], riskLevel: 1, rollbackPlan: "删 adr.test.ts" },
	{ id: "u2", dependsOn: ["u1"], scope: "补 audit 测试", acceptanceTests: ["audit.test.ts 存在"], riskLevel: 1, rollbackPlan: "删 audit.test.ts" },
]);

describe("DagDecomposer", () => {
	it("合法 JSON(无围栏)→ parse 成 Dag", async () => {
		const d = new DagDecomposer({ agentRunner: mockRunner(validUnitsJson) });
		const dag = await d.decompose("RFC: 补测试");
		expect(dag.units).toHaveLength(2);
		expect(dag.units[1].dependsOn).toEqual(["u1"]);
	});

	it("围栏包裹的 ```json...``` → 剥围栏 parse", async () => {
		const fenced = "```json\n" + validUnitsJson + "\n```";
		const d = new DagDecomposer({ agentRunner: mockRunner(fenced) });
		const dag = await d.decompose("RFC");
		expect(dag.units).toHaveLength(2);
	});

	it("reply 含噪声文本 + JSON → brace-fallback 提取首个 JSON 数组", async () => {
		const noisy = "好的,以下是分解:\n" + validUnitsJson + "\n以上是 unit。";
		const d = new DagDecomposer({ agentRunner: mockRunner(noisy) });
		const dag = await d.decompose("RFC");
		expect(dag.units).toHaveLength(2);
	});

	it("空数组 → throw(≥1 unit)", async () => {
		const d = new DagDecomposer({ agentRunner: mockRunner("[]") });
		await expect(d.decompose("RFC")).rejects.toThrow(/at least 1 unit|≥1/i);
	});

	it("循环依赖 → throw(无环)", async () => {
		const cyclic = JSON.stringify([
			{ id: "a", dependsOn: ["b"], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
			{ id: "b", dependsOn: ["a"], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		]);
		const d = new DagDecomposer({ agentRunner: mockRunner(cyclic) });
		await expect(d.decompose("RFC")).rejects.toThrow(/cycle|环/i);
	});

	it("dependsOn 引用不存在 id → throw", async () => {
		const bad = JSON.stringify([
			{ id: "u1", dependsOn: ["nope"], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		]);
		const d = new DagDecomposer({ agentRunner: mockRunner(bad) });
		await expect(d.decompose("RFC")).rejects.toThrow(/dependsOn|依赖.*不存在/i);
	});

	it("超 max-units(默认 20)→ throw", async () => {
		const many = JSON.stringify(Array.from({ length: 21 }, (_, i) => ({
			id: `u${i}`, dependsOn: [], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r",
		})));
		const d = new DagDecomposer({ agentRunner: mockRunner(many) });
		await expect(d.decompose("RFC")).rejects.toThrow(/max.*unit|≤20/i);
	});

	it("非法 JSON → throw(parse 失败)", async () => {
		const d = new DagDecomposer({ agentRunner: mockRunner("not json at all") });
		await expect(d.decompose("RFC")).rejects.toThrow(/parse|JSON/i);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/dag-decomposer.test.ts`
Expected: FAIL with "Cannot find module './dag-decomposer.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/rfc-dag/dag-decomposer.ts
import type { AgentRunner } from "../loop/agent-runner.js";

export interface WorkUnit {
	id: string;
	dependsOn: string[];
	scope: string;
	acceptanceTests: string[];
	riskLevel: 1 | 2 | 3;
	rollbackPlan: string;
}
export interface Dag { units: WorkUnit[]; }

export interface DagDecomposerDeps {
	agentRunner: AgentRunner;
	decomposePrompt?: (rfc: string) => string;
	maxUnits?: number;   // 默认 20
}

const DEFAULT_MAX_UNITS = 20;

const DECOMPOSE_PROMPT = (rfc: string) => `你是架构分解助手。把以下 RFC 分解成可独立验证的工作单元 DAG。
输出 JSON 数组,每个元素:{ id: string, dependsOn: string[], scope: string, acceptanceTests: string[], riskLevel: 1|2|3, rollbackPlan: string }
规则:id 唯一;dependsOn 只引用同数组内 id;无循环依赖;粒度适中(单 unit 单文件级)。
只输出 JSON 数组,不要其他文本。

RFC:
${rfc}`;

/** 剥 ```json...``` 围栏 + brace-fallback 提取首个 JSON 数组(类比 instinct parseInstinctsJson)。 */
function parseUnitsJson(reply: string): unknown[] {
	let s = reply.trim();
	const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) s = fence[1].trim();
	try {
		const parsed = JSON.parse(s);
		if (Array.isArray(parsed)) return parsed;
	} catch { /* fall through to brace-fallback */ }
	const start = s.indexOf("[");
	const end = s.lastIndexOf("]");
	if (start !== -1 && end !== -1 && end > start) {
		const sliced = s.slice(start, end + 1);
		const parsed = JSON.parse(sliced);   // 抛错由调用方 catch
		if (Array.isArray(parsed)) return parsed;
	}
	throw new Error("parse: reply 不含合法 JSON 数组");
}

function validateDag(units: WorkUnit[], maxUnits: number): void {
	if (units.length === 0) throw new Error("DAG 校验失败:至少 1 unit(≥1)");
	if (units.length > maxUnits) throw new Error(`DAG 校验失败:超 max-units(≤${maxUnits}),实际 ${units.length}`);
	const ids = new Set(units.map(u => u.id));
	if (ids.size !== units.length) throw new Error("DAG 校验失败:id 重复");
	for (const u of units) {
		for (const dep of u.dependsOn) {
			if (!ids.has(dep)) throw new Error(`DAG 校验失败:dependsOn "${dep}" 不存在(unit ${u.id})`);
		}
	}
	// 无环:DFS
	const color = new Map<string, number>();   // 0=未访 1=在栈 2=完成
	const adj = new Map<string, string[]>();
	for (const u of units) adj.set(u.id, u.dependsOn);
	const dfs = (id: string): void => {
		const c = color.get(id) ?? 0;
		if (c === 1) throw new Error(`DAG 校验失败:循环依赖(经 ${id})`);
		if (c === 2) return;
		color.set(id, 1);
		for (const dep of adj.get(id) ?? []) dfs(dep);
		color.set(id, 2);
	};
	for (const u of units) dfs(u.id);
}

function toWorkUnit(raw: unknown): WorkUnit {
	const r = raw as Record<string, unknown>;
	return {
		id: String(r.id),
		dependsOn: Array.isArray(r.dependsOn) ? r.dependsOn.map(String) : [],
		scope: String(r.scope ?? ""),
		acceptanceTests: Array.isArray(r.acceptanceTests) ? r.acceptanceTests.map(String) : [],
		riskLevel: ([1, 2, 3].includes(Number(r.riskLevel)) ? Number(r.riskLevel) : 2) as 1 | 2 | 3,
		rollbackPlan: String(r.rollbackPlan ?? ""),
	};
}

export class DagDecomposer {
	constructor(private deps: DagDecomposerDeps) {}

	async decompose(rfc: string): Promise<Dag> {
		const prompt = (this.deps.decomposePrompt ?? DECOMPOSE_PROMPT)(rfc);
		const { reply } = await this.deps.agentRunner.run(prompt, { cwd: process.cwd() });
		const raw = parseUnitsJson(reply);
		const units = raw.map(toWorkUnit);
		validateDag(units, this.deps.maxUnits ?? DEFAULT_MAX_UNITS);
		return { units };
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/dag-decomposer.test.ts`
Expected: PASS(8 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/rfc-dag/dag-decomposer.ts packages/cli/src/rfc-dag/dag-decomposer.test.ts
git commit -m "feat(rfc-dag): Slice 6 Task 2 DagDecomposer(RFC→unit DAG,AI+parse+拓扑校验+max-units)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3:DagScheduler(拓扑序 + 依赖满足 + 串行 + failed 下游 skipped)

**Files:**
- Create: `packages/cli/src/rfc-dag/dag-scheduler.ts`
- Test: `packages/cli/src/rfc-dag/dag-scheduler.ts`

**Interfaces:**
- Consumes: `Dag`/`WorkUnit`(from `./dag-decomposer.js`)。
- Produces: `UnitStatus`/`UnitState`/`DagScheduler` 类型 + `DagScheduler` 类。`RfcDagRunner`(Task 6)与 `RfcDagState`(Task 5)依赖 `UnitState`。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/rfc-dag/dag-scheduler.test.ts
import { describe, it, expect } from "vitest";
import { DagScheduler } from "./dag-scheduler.js";
import type { UnitState } from "./dag-scheduler.js";
import type { Dag } from "./dag-decomposer.js";

function mkDag(): Dag {
	return { units: [
		{ id: "u1", dependsOn: [], scope: "s1", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		{ id: "u2", dependsOn: ["u1"], scope: "s2", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		{ id: "u3", dependsOn: ["u1"], scope: "s3", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		{ id: "u4", dependsOn: ["u2", "u3"], scope: "s4", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
	]};
}
function pendingState(dag: Dag): Record<string, UnitState> {
	const m: Record<string, UnitState> = {};
	for (const u of dag.units) m[u.id] = { id: u.id, status: "pending", attempts: 0 };
	return m;
}

describe("DagScheduler", () => {
	it("next 返回无依赖的 pending unit(u1)", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		expect(s.next()?.id).toBe("u1");
	});

	it("u1 running 时 next 返 null(串行,不并发选 u2/u3)", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		s.next();
		s.mark("u1", "running");
		expect(s.next()).toBeNull();
	});

	it("u1 merged → next 返回 u2 或 u3(依赖满足)", () => {
		const dag = mkDag();
		const units = pendingState(dag);
		const s = new DagScheduler({ dag, units });
		s.mark("u1", "merged");
		expect(["u2", "u3"]).toContain(s.next()?.id);
	});

	it("u1 failed → 下游 u2/u3/u4 全 skipped", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		s.mark("u1", "failed");
		expect(s.next()).toBeNull();
		expect(s.status("u2").status).toBe("skipped");
		expect(s.status("u3").status).toBe("skipped");
		expect(s.status("u4").status).toBe("skipped");
	});

	it("u2 failed(u1 merged)→ u4 skipped,u3 仍可跑", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		s.mark("u1", "merged");
		s.mark("u2", "failed");
		expect(s.next()?.id).toBe("u3");   // u3 依赖 u1(merged)可跑
		expect(s.status("u4").status).toBe("skipped");   // u4 依赖 u2(failed)
	});

	it("allDone:全 merged → true;有 pending → false", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		expect(s.allDone()).toBe(false);
		s.mark("u1", "merged"); s.mark("u2", "merged"); s.mark("u3", "merged"); s.mark("u4", "merged");
		expect(s.allDone()).toBe(true);
	});

	it("allDone:全 failed/skipped → true", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		s.mark("u1", "failed");   // u2/u3/u4 skipped
		expect(s.allDone()).toBe(true);
	});

	it("attempts 从 state 读取", () => {
		const dag = mkDag();
		const units = pendingState(dag);
		units.u1.attempts = 2;
		const s = new DagScheduler({ dag, units });
		expect(s.status("u1").attempts).toBe(2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/dag-scheduler.test.ts`
Expected: FAIL "Cannot find module './dag-scheduler.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/rfc-dag/dag-scheduler.ts
import type { Dag, WorkUnit } from "./dag-decomposer.js";

export type UnitStatus = "pending" | "running" | "merged" | "failed" | "skipped";
export interface UnitState {
	id: string;
	status: UnitStatus;
	attempts: number;
	lastError?: string;
	lastGateOutput?: string;
	lastReviewIssues?: string[];
}

export interface DagSchedulerDeps {
	dag: Dag;
	units: Record<string, UnitState>;
}

export class DagScheduler {
	constructor(private deps: DagSchedulerDeps) {}

	/** 下一个可跑 unit:pending 且所有 dependsOn merged。先传播 failed→skipped。无则 null。 */
	next(): WorkUnit | null {
		this.propagateSkipped();
		for (const u of this.deps.dag.units) {
			const st = this.deps.units[u.id];
			if (st.status !== "pending") continue;
			const ready = u.dependsOn.every(dep => this.deps.units[dep]?.status === "merged");
			if (ready) return u;
		}
		return null;
	}

	/** pending 且任意 dependsOn 是 failed/skipped → skipped(多轮传播间接依赖)。 */
	private propagateSkipped(): void {
		let changed = true;
		while (changed) {
			changed = false;
			for (const u of this.deps.dag.units) {
				const st = this.deps.units[u.id];
				if (st.status !== "pending") continue;
				const blocked = u.dependsOn.some(dep => {
					const ds = this.deps.units[dep]?.status;
					return ds === "failed" || ds === "skipped";
				});
				if (blocked) { st.status = "skipped"; changed = true; }
			}
		}
	}

	mark(id: string, status: UnitStatus): void {
		const st = this.deps.units[id];
		if (st) st.status = status;
	}

	status(id: string): UnitState {
		return this.deps.units[id];
	}

	allDone(): boolean {
		return this.deps.dag.units.every(u => {
			const s = this.deps.units[u.id].status;
			return s === "merged" || s === "failed" || s === "skipped";
		});
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/dag-scheduler.test.ts`
Expected: PASS(8 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/rfc-dag/dag-scheduler.ts packages/cli/src/rfc-dag/dag-scheduler.test.ts
git commit -m "feat(rfc-dag): Slice 6 Task 3 DagScheduler(拓扑序+依赖+串行+failed下游skipped)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4:WorktreeOps + DryRunWorktreeOps(git worktree --force -B)

**Files:**
- Create: `packages/cli/src/rfc-dag/worktree-pool.ts`
- Test: `packages/cli/src/rfc-dag/worktree-pool.test.ts`

**Interfaces:**
- Consumes: `node:child_process`。
- Produces: `WorktreeOps` 接口 + `DryRunWorktreeOps` 类。`RfcDagRunner`(Task 6)依赖。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/rfc-dag/worktree-pool.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DryRunWorktreeOps } from "./worktree-pool.js";

function mkRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "wt-"));
	execSync("git init -b main", { cwd: dir, stdio: "ignore" });
	execSync('git config user.email t@t.t && git config user.name t', { cwd: dir, shell: true });
	writeFileSync(join(dir, "a.txt"), "a");
	execSync("git add a.txt && git commit -m init", { cwd: dir, shell: true, stdio: "ignore" });
	return dir;
}

describe("DryRunWorktreeOps", () => {
	let repo: string;
	beforeEach(() => { repo = mkRepo(); });
	afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

	it("addWorktree 创建 worktree + branch(含初始文件)", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		await ops.addWorktree(wt, "rfc-dag/u1");
		expect(existsSync(join(wt, "a.txt"))).toBe(true);
		expect(execSync("git -C " + JSON.stringify(repo) + " branch --list", { encoding: "utf8" })).toContain("rfc-dag/u1");
	});

	it("removeWorktree 删除 worktree 目录", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		await ops.addWorktree(wt, "rfc-dag/u1");
		await ops.removeWorktree(wt);
		expect(existsSync(wt)).toBe(false);
	});

	it("addWorktree 残留路径(未 remove 再 add 同路径)→ --force 重建不 throw", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		await ops.addWorktree(wt, "rfc-dag/u1");
		await expect(ops.addWorktree(wt, "rfc-dag/u1")).resolves.not.toThrow();
	});

	it("addWorktree 残留 branch(remove 后 branch 留,再 add 同 branch)→ -B 重建不 throw", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		await ops.addWorktree(wt, "rfc-dag/u1");
		await ops.removeWorktree(wt);
		await expect(ops.addWorktree(wt, "rfc-dag/u1")).resolves.not.toThrow();
	});

	it("removeWorktree 不存在路径 → non-fatal 不 throw", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		await expect(ops.removeWorktree(join(repo, "nope"))).resolves.not.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/worktree-pool.test.ts`
Expected: FAIL "Cannot find module './worktree-pool.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/rfc-dag/worktree-pool.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface WorktreeOps {
	/** git worktree add --force <path> -B <branch>(--force 清路径残留,-B 重建 branch 残留)。 */
	addWorktree(path: string, branch: string): Promise<void>;
	/** git worktree remove --force <path>(失败 non-fatal)。 */
	removeWorktree(path: string): Promise<void>;
}

export interface DryRunWorktreeOpsOpts {
	cwd: string;
}

/** 简单 shell quote(路径/分支含空格)。 */
function shq(s: string): string {
	return `"${s.replace(/"/g, '\\"')}"`;
}

export class DryRunWorktreeOps implements WorktreeOps {
	constructor(private opts: DryRunWorktreeOpsOpts) {}

	async addWorktree(path: string, branch: string): Promise<void> {
		const cwd = shq(this.opts.cwd);
		const cmd = `git -C ${cwd} worktree add --force -B ${shq(branch)} ${shq(path)}`;
		try {
			await execAsync(cmd);
		} catch {
			// 残留 worktree 注册(prune)后重试
			await execAsync(`git -C ${cwd} worktree prune`);
			await execAsync(cmd);
		}
	}

	async removeWorktree(path: string): Promise<void> {
		try {
			await execAsync(`git -C ${shq(this.opts.cwd)} worktree remove --force ${shq(path)}`);
		} catch {
			// non-fatal(残留下轮 addWorktree --force 清)
		}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/worktree-pool.test.ts`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/rfc-dag/worktree-pool.ts packages/cli/src/rfc-dag/worktree-pool.test.ts
git commit -m "feat(rfc-dag): Slice 6 Task 4 WorktreeOps+DryRunWorktreeOps(git worktree --force -B / remove --force)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5:RfcDagState(文件 resumable state.json)

**Files:**
- Create: `packages/cli/src/rfc-dag/rfc-dag-state.ts`
- Test: `packages/cli/src/rfc-dag/rfc-dag-state.test.ts`

**Interfaces:**
- Consumes: `Dag`(from `./dag-decomposer.js`)+ `UnitState`/`UnitStatus`(from `./dag-scheduler.js`)+ `node:fs`。
- Produces: `RfcDagStateData`/`RfcDagState`/`FileRfcDagState`。`RfcDagRunner`(Task 6)依赖。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/rfc-dag/rfc-dag-state.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRfcDagState } from "./rfc-dag-state.js";
import type { Dag } from "./dag-decomposer.js";

const dag: Dag = { units: [
	{ id: "u1", dependsOn: [], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
	{ id: "u2", dependsOn: ["u1"], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
]};

describe("FileRfcDagState", () => {
	let dir: string;
	beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rfc-st-")); });
	afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

	it("load 不存在 → null", () => {
		expect(new FileRfcDagState({ dir }).load()).toBeNull();
	});

	it("save → 新实例 load 往返一致(dag/units/rollbackTag)", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: {
			u1: { id: "u1", status: "pending", attempts: 0 },
			u2: { id: "u2", status: "pending", attempts: 0 },
		}, rollbackTag: "tag-1" };
		s.save();
		const loaded = new FileRfcDagState({ dir }).load();
		expect(loaded?.rollbackTag).toBe("tag-1");
		expect(loaded?.units.u1.status).toBe("pending");
		expect(loaded?.dag.units).toHaveLength(2);
	});

	it("reset 删文件 → load null", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: {}, rollbackTag: "t" };
		s.save();
		s.reset();
		expect(new FileRfcDagState({ dir }).load()).toBeNull();
	});

	it("markUnit 更新 status + attempts + context", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: { u1: { id: "u1", status: "pending", attempts: 0 } }, rollbackTag: "t" };
		s.markUnit("u1", "pending", 1, { lastError: "gate fail", lastGateOutput: "ERR" });
		expect(s.data.units.u1.attempts).toBe(1);
		expect(s.data.units.u1.lastError).toBe("gate fail");
		expect(s.data.units.u1.lastGateOutput).toBe("ERR");
	});

	it("resumable:已 merged 的 unit load 后仍 merged(恢复跳过)", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: {
			u1: { id: "u1", status: "merged", attempts: 0 },
			u2: { id: "u2", status: "pending", attempts: 0 },
		}, rollbackTag: "t" };
		s.save();
		const loaded = new FileRfcDagState({ dir }).load();
		expect(loaded?.units.u1.status).toBe("merged");
		expect(loaded?.units.u2.status).toBe("pending");
	});

	it("markUnit 不存在 id → no-op 不 throw", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: {}, rollbackTag: "t" };
		expect(() => s.markUnit("nope", "failed")).not.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/rfc-dag-state.test.ts`
Expected: FAIL "Cannot find module './rfc-dag-state.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/rfc-dag/rfc-dag-state.ts
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Dag } from "./dag-decomposer.js";
import type { UnitState, UnitStatus } from "./dag-scheduler.js";

export interface RfcDagStateData {
	dag: Dag;
	units: Record<string, UnitState>;
	rollbackTag: string;
}

export interface RfcDagState {
	data: RfcDagStateData;
	load(): RfcDagStateData | null;
	save(): void;
	reset(): void;
	markUnit(id: string, status: UnitStatus, attempts?: number,
		context?: { lastError?: string; lastGateOutput?: string; lastReviewIssues?: string[] }): void;
}

export interface FileRfcDagStateOpts {
	dir: string;
	filename?: string;   // 默认 state.json
}

export class FileRfcDagState implements RfcDagState {
	data: RfcDagStateData = { dag: { units: [] }, units: {}, rollbackTag: "" };
	private path: string;

	constructor(private opts: FileRfcDagStateOpts) {
		this.path = join(opts.dir, opts.filename ?? "state.json");
	}

	load(): RfcDagStateData | null {
		if (!existsSync(this.path)) return null;
		this.data = JSON.parse(readFileSync(this.path, "utf-8"));
		return this.data;
	}

	save(): void {
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf-8");
	}

	reset(): void {
		if (existsSync(this.path)) unlinkSync(this.path);
	}

	markUnit(id: string, status: UnitStatus, attempts?: number,
		context?: { lastError?: string; lastGateOutput?: string; lastReviewIssues?: string[] }): void {
		const u = this.data.units[id];
		if (!u) return;
		u.status = status;
		if (attempts != null) u.attempts = attempts;
		if (context?.lastError != null) u.lastError = context.lastError;
		if (context?.lastGateOutput != null) u.lastGateOutput = context.lastGateOutput;
		if (context?.lastReviewIssues != null) u.lastReviewIssues = context.lastReviewIssues;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/rfc-dag-state.test.ts`
Expected: PASS(6 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/rfc-dag/rfc-dag-state.ts packages/cli/src/rfc-dag/rfc-dag-state.test.ts
git commit -m "feat(rfc-dag): Slice 6 Task 5 RfcDagState(文件 resumable state.json,save/load/reset/markUnit)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6:RfcDagRunner(编排 + retry + review + 回滚 + final verify)

**Files:**
- Create: `packages/cli/src/rfc-dag/rfc-dag-runner.ts`
- Test: `packages/cli/src/rfc-dag/rfc-dag-runner.test.ts`

**Interfaces:**
- Consumes: `GitOps`/`Gate`/`AgentRunner`/`ExitConditionConfig`/`LoopState`/`checkExit`/`ReviewGate`(from `../loop/*`)+ `DagDecomposer`/`Dag`/`WorkUnit`(Task 2)+ `DagScheduler`/`UnitStatus`/`UnitState`(Task 3)+ `WorktreeOps`(Task 4)+ `RfcDagState`/`RfcDagStateData`(Task 5)。
- Produces: `RfcDagConfig`/`RfcDagDeps`/`UnitResult`/`RfcDagResult`/`RfcDagRunner`。`runRfcDagMode`(Task 7)依赖。

**resumable 修正(spec §5 细化):** `run` 开始先 `state.load()`——存在(恢复 run)→ 用 existing dag + units(已 merged 跳过),不 reset/decompose;不存在(新 run)→ reset + tag + decompose + save。这修正 spec §5 "state.reset() 然后 decompose" 的新 run 假设。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/rfc-dag/rfc-dag-runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { RfcDagRunner } from "./rfc-dag-runner.js";
import type { RfcDagConfig, RfcDagDeps } from "./rfc-dag-runner.js";
import type { Dag } from "./dag-decomposer.js";
import type { GitOps, MergeResult } from "../loop/git-ops.js";
import type { Gate, GateResult } from "../loop/gate.js";
import type { AgentRunner } from "../loop/agent-runner.js";
import type { WorktreeOps } from "./worktree-pool.js";
import type { RfcDagState, RfcDagStateData } from "./rfc-dag-state.js";
import type { DagDecomposer } from "./dag-decomposer.js";

const dag: Dag = { units: [
	{ id: "u1", dependsOn: [], scope: "s1", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
	{ id: "u2", dependsOn: ["u1"], scope: "s2", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
]};

function mockGitOps(o: { clean?: boolean; branch?: string; mergeOk?: boolean } = {}): GitOps {
	return {
		isClean: vi.fn(async () => o.clean ?? true),
		currentBranch: vi.fn(async () => o.branch ?? "main"),
		tag: vi.fn(async () => {}),
		createBranch: vi.fn(async () => {}),
		checkout: vi.fn(async () => {}),
		commit: vi.fn(async () => true),
		merge: vi.fn(async (): Promise<MergeResult> => (o.mergeOk ?? true) ? { ok: true } : { ok: false, conflict: "CONFLICT" }),
		hasChanges: vi.fn(async () => true),
		deleteBranch: vi.fn(async () => {}),
		diff: vi.fn(async () => "diff"),
	};
}
function mockGate(seq: boolean[]): Gate {
	let i = 0;
	return { run: vi.fn(async (): Promise<GateResult> => {
		const p = seq[Math.min(i, seq.length - 1)]; i++;
		return { passed: p, output: p ? "ok" : "FAIL" };
	})};
}
function mockState(data: RfcDagStateData): RfcDagState {
	return { data, load: vi.fn(() => null), save: vi.fn(), reset: vi.fn(),
		markUnit: vi.fn((id, status, attempts, ctx) => { const u = data.units[id]; if (u) { u.status = status; if (attempts != null) u.attempts = attempts; if (ctx?.lastError != null) u.lastError = ctx.lastError; if (ctx?.lastGateOutput != null) u.lastGateOutput = ctx.lastGateOutput; if (ctx?.lastReviewIssues != null) u.lastReviewIssues = ctx.lastReviewIssues; } }) };
}
function mkDeps(over: Partial<RfcDagDeps> & { dag?: Dag; existing?: RfcDagStateData | null } = {}): RfcDagDeps {
	const data: RfcDagStateData = { dag: over.dag ?? dag, units: {
		u1: { id: "u1", status: "pending", attempts: 0 },
		u2: { id: "u2", status: "pending", attempts: 0 },
	}, rollbackTag: "" };
	const state = mockState(data);
	state.load = vi.fn(() => over.existing ?? null);
	return {
		gitOpsFactory: vi.fn(() => mockGitOps()),
		worktreeOps: { addWorktree: vi.fn(async () => {}), removeWorktree: vi.fn(async () => {}) },
		gateFactory: vi.fn(() => mockGate([true, true, true])),
		agentRunner: { run: vi.fn(async () => ({ reply: "done DONE", cost: 0.05, tokensIn: 10, tokensOut: 20 })) },
		decomposer: { decompose: vi.fn(async () => over.dag ?? dag) } as DagDecomposer,
		state,
		...over,
	};
}
function mkConfig(over: Partial<RfcDagConfig> = {}): RfcDagConfig {
	return { rfc: "RFC", exit: { maxRuns: 10 }, maxUnitRetries: 1, baseBranch: "main", ...over };
}

describe("RfcDagRunner", () => {
	it("正常 DAG 2 unit 全 merge + all-done", async () => {
		const r = new RfcDagRunner(mkConfig(), mkDeps());
		const res = await r.run();
		expect(res.units.filter(u => u.status === "merged")).toHaveLength(2);
		expect(res.stopReason).toBe("all-done");
	});

	it("decompose 失败 → throw(回滚 tag 已打)", async () => {
		const deps = mkDeps();
		(deps.decomposer.decompose as any) = vi.fn(async () => { throw new Error("bad dag"); });
		await expect(new RfcDagRunner(mkConfig(), deps).run()).rejects.toThrow(/bad dag/);
		expect(deps.gitOpsFactory).toHaveBeenCalled();   // repoGitOps 建了(tag 已打)
	});

	it("gate 永失败 retry 达上限 → u1 failed + u2 skipped", async () => {
		const deps = mkDeps({ gateFactory: vi.fn(() => mockGate([false])) });
		const res = await new RfcDagRunner(mkConfig({ maxUnitRetries: 1 }), deps).run();
		expect(res.units.find(u => u.unitId === "u1")?.status).toBe("failed");
		expect(res.units.find(u => u.unitId === "u2")?.status).toBe("skipped");
	});

	it("gate 失败 1 次后 retry pass → merged", async () => {
		const deps = mkDeps({ gateFactory: vi.fn(() => mockGate([false, true, true])) });
		const res = await new RfcDagRunner(mkConfig({ maxUnitRetries: 2 }), deps).run();
		expect(res.units.find(u => u.unitId === "u1")?.status).toBe("merged");
	});

	it("isClean 失败 → throw 不开始(不 decompose)", async () => {
		const deps = mkDeps({ gitOpsFactory: vi.fn(() => mockGitOps({ clean: false })) });
		await expect(new RfcDagRunner(mkConfig(), deps).run()).rejects.toThrow(/clean/);
		expect(deps.decomposer.decompose).not.toHaveBeenCalled();
	});

	it("merge 冲突 retry 达上限 → failed", async () => {
		const deps = mkDeps({ gitOpsFactory: vi.fn(() => mockGitOps({ mergeOk: false })) });
		const res = await new RfcDagRunner(mkConfig({ maxUnitRetries: 1 }), deps).run();
		expect(res.units.find(u => u.unitId === "u1")?.status).toBe("failed");
	});

	it("resumable:state 已 merged u1 → 跳过 u1 只跑 u2", async () => {
		const existing: RfcDagStateData = { dag, units: {
			u1: { id: "u1", status: "merged", attempts: 0 },
			u2: { id: "u2", status: "pending", attempts: 0 },
		}, rollbackTag: "tag-x" };
		const deps = mkDeps({ existing });
		const res = await new RfcDagRunner(mkConfig(), deps).run();
		expect(deps.decomposer.decompose).not.toHaveBeenCalled();   // 恢复 run 不 decompose
		expect(res.units.find(u => u.unitId === "u2")?.status).toBe("merged");
		expect(res.rollbackTag).toBe("tag-x");
	});

	it("回滚 tag 在结果中 + console 输出 reset 提示", async () => {
		const deps = mkDeps();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const res = await new RfcDagRunner(mkConfig(), deps).run();
		expect(res.rollbackTag).toMatch(/rfc-dag-rollback-/);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("git reset --hard"));
		logSpy.mockRestore();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/rfc-dag-runner.test.ts`
Expected: FAIL "Cannot find module './rfc-dag-runner.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/rfc-dag/rfc-dag-runner.ts
import type { GitOps } from "../loop/git-ops.js";
import type { Gate } from "../loop/gate.js";
import type { AgentRunner } from "../loop/agent-runner.js";
import type { LoopState, ExitConditionConfig, ExitDecision } from "../loop/exit-condition.js";
import { checkExit } from "../loop/exit-condition.js";
import type { ReviewGate } from "../loop/loop-runner.js";
import type { DagDecomposer, Dag, WorkUnit } from "./dag-decomposer.js";
import { DagScheduler } from "./dag-scheduler.js";
import type { UnitStatus } from "./dag-scheduler.js";
import type { WorktreeOps } from "./worktree-pool.js";
import type { RfcDagState, RfcDagStateData } from "./rfc-dag-state.js";

export interface RfcDagConfig {
	rfc: string;
	exit: ExitConditionConfig;
	review?: ReviewGate;
	maxUnitRetries?: number;   // 默认 2
	baseBranch?: string;       // 默认 main
	branchPrefix?: string;     // 默认 rfc-dag
	cwd?: string;
}
export interface RfcDagDeps {
	gitOpsFactory: (cwd: string) => GitOps;
	worktreeOps: WorktreeOps;
	gateFactory: (cwd: string) => Gate;
	agentRunner: AgentRunner;
	decomposer: DagDecomposer;
	state: RfcDagState;
}
export interface UnitResult {
	unitId: string; status: UnitStatus; attempts: number;
	reply?: string; cost: number; gatePassed: boolean;
	reviewVerdict?: "nice" | "naughty"; error?: string;
}
export interface RfcDagResult {
	units: UnitResult[]; totalCost: number; stopReason: string; rollbackTag: string;
}

const DEFAULT_MAX_UNIT_RETRIES = 2;
const DEFAULT_BASE_BRANCH = "main";
const DEFAULT_BRANCH_PREFIX = "rfc-dag";

export class RfcDagRunner {
	constructor(private config: RfcDagConfig, private deps: RfcDagDeps) {}

	async run(signal?: AbortSignal): Promise<RfcDagResult> {
		const repoCwd = this.config.cwd ?? process.cwd();
		const worktreesDir = `${repoCwd}/.agentforge/worktrees`;
		const repoGitOps = this.deps.gitOpsFactory(repoCwd);
		const maxRetries = this.config.maxUnitRetries ?? DEFAULT_MAX_UNIT_RETRIES;
		const baseBranch = this.config.baseBranch ?? DEFAULT_BASE_BRANCH;
		const prefix = this.config.branchPrefix ?? DEFAULT_BRANCH_PREFIX;

		if (!(await repoGitOps.isClean())) throw new Error("RFC-DAG:working tree 不干净,清理后再开始");
		if ((await repoGitOps.currentBranch()) !== baseBranch) throw new Error(`RFC-DAG:须在 ${baseBranch} 分支开始`);

		// 新 run vs 恢复 run(spec §5 细化)
		let dag: Dag;
		let rollbackTag: string;
		const existing = this.deps.state.load();
		if (existing && existing.dag.units.length > 0) {
			this.deps.state.data = existing;
			dag = existing.dag;
			rollbackTag = existing.rollbackTag;
		} else {
			this.deps.state.reset();
			rollbackTag = `rfc-dag-rollback-${Date.now()}`;
			await repoGitOps.tag(rollbackTag);
			dag = await this.deps.decomposer.decompose(this.config.rfc);   // 失败 throw
			this.deps.state.data = {
				dag,
				units: Object.fromEntries(dag.units.map(u => [u.id, { id: u.id, status: "pending" as UnitStatus, attempts: 0 }])),
				rollbackTag,
			};
			this.deps.state.save();
		}

		const scheduler = new DagScheduler({ dag, units: this.deps.state.data.units });
		const state2: LoopState = { runs: 0, cost: 0, durationMs: 0, consecutiveCompletionSignals: 0, consecutiveGateFailures: 0 };
		const results: UnitResult[] = [];
		let stopReason = "all-done";
		let exit: ExitDecision = { stop: false, reason: "" };

		while (true) {
			if (signal?.aborted) { stopReason = "aborted"; break; }
			exit = checkExit(state2, this.config.exit);
			if (exit.stop) { stopReason = exit.reason; break; }
			const unit = scheduler.next();
			if (!unit) break;   // allDone
			scheduler.mark(unit.id, "running");
			const r = await this.runUnit(unit, dag, repoGitOps, worktreesDir, prefix, baseBranch, maxRetries, signal);
			results.push(r);
			state2.runs += r.attempts;
			state2.cost += r.cost;
			this.deps.state.save();
		}

		// final verify(主 repo,全量集成)
		await repoGitOps.checkout(baseBranch);
		const finalGate = this.deps.gateFactory(this.config.cwd ?? process.cwd());
		const finalRes = await finalGate.run();
		if (!finalRes.passed) {
			results.push({ unitId: "__final__", status: "failed", attempts: 1, cost: 0, gatePassed: false, error: finalRes.output });
		}

		console.log(`RFC-DAG 结束(${stopReason})。回滚 tag: ${rollbackTag}`);
		console.log(`  git reset --hard ${rollbackTag}`);
		return { units: results, totalCost: state2.cost, stopReason, rollbackTag };
	}

	private async runUnit(unit: WorkUnit, dag: Dag, repoGitOps: GitOps, worktreesDir: string, prefix: string, baseBranch: string, maxRetries: number, signal?: AbortSignal): Promise<UnitResult> {
		const wt = `${worktreesDir}/${unit.id}`;
		const branch = `${prefix}/${unit.id}`;
		let attempts = this.deps.state.data.units[unit.id]?.attempts ?? 0;
		const result: UnitResult = { unitId: unit.id, status: "pending", attempts, reply: "", cost: 0, gatePassed: false };

		while (attempts <= maxRetries) {
			result.attempts = attempts;
			const wtGitOps = this.deps.gitOpsFactory(wt);
			const gate = this.deps.gateFactory(wt);
			try {
				await this.deps.worktreeOps.addWorktree(wt, branch);
				if (signal?.aborted) break;
				const notes = this.buildNotes(unit);
				const mergedDeps = unit.dependsOn.map(id => `${id}: ${dag.units.find(u => u.id === id)?.scope ?? ""}`).join("; ");
				const prompt = this.buildPrompt(unit, notes, mergedDeps);
				const { reply, cost } = await this.deps.agentRunner.run(prompt, { cwd: wt, signal });
				result.reply = reply; result.cost += cost;

				if (this.config.review) {
					const output = reply + "\n" + (await wtGitOps.diff()).slice(0, 4000);
					const rr = await this.config.review.verifier.review(output, this.config.review.rubric);
					result.reviewVerdict = rr.verdict;
					if (rr.verdict === "naughty") {
						attempts++;
						this.deps.state.markUnit(unit.id, "pending", attempts, { lastReviewIssues: rr.issues?.join("; ") });
						this.deps.state.save();
						await this.deps.worktreeOps.removeWorktree(wt);
						if (attempts > maxRetries) { result.status = "failed"; result.error = rr.issues?.join("; "); this.deps.state.markUnit(unit.id, "failed", attempts); return result; }
						continue;
					}
				}
				await wtGitOps.commit(reply.slice(0, 72));
				const gateRes = await gate.run();
				result.gatePassed = gateRes.passed;
				if (gateRes.passed) {
					await repoGitOps.checkout(baseBranch);
					const mergeRes = await repoGitOps.merge(branch);   // 非 --ff-only,冲突 retryable
					if (mergeRes.ok) {
						result.status = "merged";
						this.deps.state.markUnit(unit.id, "merged", attempts);
						this.deps.state.save();
						await this.deps.worktreeOps.removeWorktree(wt);
						return result;
					}
					attempts++;
					this.deps.state.markUnit(unit.id, "pending", attempts, { lastError: mergeRes.conflict });
				} else {
					attempts++;
					this.deps.state.markUnit(unit.id, "pending", attempts, { lastGateOutput: gateRes.output });
				}
			} catch (err) {
				attempts++;
				this.deps.state.markUnit(unit.id, "pending", attempts, { lastError: (err as Error).message });
			}
			this.deps.state.save();
			try { await this.deps.worktreeOps.removeWorktree(wt); } catch { /* non-fatal */ }
			if (attempts > maxRetries) { result.status = "failed"; result.error = result.error ?? this.deps.state.data.units[unit.id]?.lastError; this.deps.state.markUnit(unit.id, "failed", attempts); return result; }
		}
		result.status = "failed";
		return result;
	}

	private buildNotes(unit: WorkUnit): string {
		const st = this.deps.state.data.units[unit.id];
		if (!st) return "";
		const parts: string[] = [];
		if (st.lastError) parts.push(`上次错误: ${st.lastError}`);
		if (st.lastGateOutput) parts.push(`上次 gate 失败: ${st.lastGateOutput}`);
		if (st.lastReviewIssues?.length) parts.push(`上次 review issues: ${st.lastReviewIssues.join("; ")}`);
		parts.push(`已尝试 ${st.attempts} 次`);
		return parts.join("\n");
	}

	private buildPrompt(unit: WorkUnit, notes: string, mergedDeps: string): string {
		return `${this.config.rfc}

--- 你的工作单元 ---
id: ${unit.id}
scope: ${unit.scope}
acceptanceTests: ${unit.acceptanceTests.join("; ")}
riskLevel: ${unit.riskLevel}
rollbackPlan: ${unit.rollbackPlan}
依赖 unit(已完成,代码已在 worktree): ${mergedDeps || "无"}

--- 上下文(retry 时)---
${notes || "首次执行"}

--- 要求 ---
完成本 unit scope。完成后输出 DONE。`;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/rfc-dag-runner.test.ts`
Expected: PASS(8 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/rfc-dag/rfc-dag-runner.ts packages/cli/src/rfc-dag/rfc-dag-runner.test.ts
git commit -m "feat(rfc-dag): Slice 6 Task 6 RfcDagRunner(编排+retry+review+回滚+final verify+resumable)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7:CLI rfc-dag-mode(argv + wiring)+ index.ts 路由

**Files:**
- Create: `packages/cli/src/rfc-dag/rfc-dag-mode.ts`
- Test: `packages/cli/src/rfc-dag/rfc-dag-mode.test.ts`
- Modify: `packages/cli/src/index.ts`(加 `argv[0]==="rfc-dag"` 路由,与 `loop` 并列)

**Interfaces:**
- Consumes: `RfcDagRunner`/`RfcDagConfig`/`RfcDagDeps`(Task 6)+ `DagDecomposer`(Task 2)+ `DryRunWorktreeOps`(Task 4)+ `FileRfcDagState`(Task 5)+ `DryRunGitOps`/`LocalBuildGate`/`InProcessAgentRunner`/`createLoopAgentDeps`/`createSantaVerifier`(from `../loop/*` + `@agentforge/harness`)。
- Produces: `runRfcDagMode(argv, opts)` + `RfcDagModeOptions`。`index.ts` 路由调用。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/rfc-dag/rfc-dag-mode.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseRfcDagArgs, runRfcDagMode } from "./rfc-dag-mode.js";

describe("parseRfcDagArgs", () => {
	it("解析 --rfc 文件 + --base-branch + --max-unit-retries", () => {
		const a = parseRfcDagArgs(["--rfc", "rfc.md", "--base-branch", "pi", "--max-unit-retries", "3", "--max-runs", "5"]);
		expect(a).toMatchObject({ rfc: "rfc.md", baseBranch: "pi", maxUnitRetries: 3, maxRuns: 5 });
	});

	it("--rfc - 从 stdin(标记)", () => {
		const a = parseRfcDagArgs(["--rfc", "-"]);
		expect(a.rfc).toBe("-");
	});

	it("--review flag", () => {
		expect(parseRfcDagArgs(["--rfc", "x", "--review"]).review).toBe(true);
	});

	it("缺 --rfc → throw", () => {
		expect(() => parseRfcDagArgs([])).toThrow(/rfc/);
	});
});

describe("runRfcDagMode wiring", () => {
	it("构造 RfcDagRunner + 跑 + 返 RfcDagResult(mock streamFn)", async () => {
		const mockRun = vi.fn().mockResolvedValue({ units: [], totalCost: 0, stopReason: "all-done", rollbackTag: "t" });
		vi.doMock("./rfc-dag-runner.js", () => ({ RfcDagRunner: class { run = mockRun; } }));
		// 注:实际测试用真实 RfcDagRunner + mock gitOpsFactory/gateFactory 等(注入 streamFn mock),
		// 这里简化验证 wiring 不 throw + 调 RfcDagRunner.run。
		const r = await runRfcDagMode(["--rfc", "x", "--max-runs", "1"], {
			getApiKey: async () => "k", provider: "xiaomi-token-plan-cn", model: "mimo-v2.5-pro",
			streamFn: (async () => ({ reply: "DONE", cost: 0, tokensIn: 0, tokensOut: 0 })) as any,
		});
		expect(r.stopReason).toBe("all-done");
		vi.doUnmock("./rfc-dag-runner.js");
	});
});
```

> **注:** wiring 测试用真实 `RfcDagRunner` + 注入 `streamFn` mock(类比 `loop-mode.test.ts` 的 mock streamFn 模式)。`InProcessAgentRunner` 构造接受 `streamFn?`,mock 返固定 reply。`gitOpsFactory`/`gateFactory` 注入 mock(或临时 git repo)。执行者按 `loop-mode.test.ts` 既有模式实现完整 wiring 测试。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/rfc-dag-mode.test.ts`
Expected: FAIL "Cannot find module './rfc-dag-mode.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/rfc-dag/rfc-dag-mode.ts
import { readFileSync } from "node:fs";
import { RfcDagRunner } from "./rfc-dag-runner.js";
import type { RfcDagConfig, RfcDagDeps } from "./rfc-dag-runner.js";
import { DagDecomposer } from "./dag-decomposer.js";
import { DryRunWorktreeOps } from "./worktree-pool.js";
import { FileRfcDagState } from "./rfc-dag-state.js";
import { DryRunGitOps } from "../loop/git-ops.js";
import { LocalBuildGate } from "../loop/gate.js";
import { InProcessAgentRunner } from "../loop/agent-runner.js";
import { createLoopAgentDeps } from "../loop/agent-deps.js";
import { createSantaVerifier } from "@agentforge/harness";
import type { ExitConditionConfig } from "../loop/exit-condition.js";

export interface RfcDagModeOptions {
	rfc: string;               // --rfc <file|->(- 从 stdin)
	maxRuns?: number; maxCost?: number; maxDurationMs?: number;
	review?: boolean; maxUnitRetries?: number; baseBranch?: string;
	gateCommands?: string[];
	getApiKey: (provider: string) => string | Promise<string | undefined>;
	provider: string; model: string; cwd?: string; streamFn?: any;
}

export interface ParsedRfcDagArgs {
	rfc: string; maxRuns?: number; maxCost?: number; maxDurationMs?: number;
	review?: boolean; maxUnitRetries?: number; baseBranch?: string; gateCommands?: string[];
}

export function parseRfcDagArgs(argv: string[]): ParsedRfcDagArgs {
	const out: ParsedRfcDagArgs = { rfc: "" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--rfc": out.rfc = argv[++i]; break;
			case "--max-runs": out.maxRuns = Number(argv[++i]); break;
			case "--max-cost": out.maxCost = Number(argv[++i]); break;
			case "--max-duration": out.maxDurationMs = Number(argv[++i]); break;
			case "--review": out.review = true; break;
			case "--max-unit-retries": out.maxUnitRetries = Number(argv[++i]); break;
			case "--base-branch": out.baseBranch = argv[++i]; break;
			case "--gate-commands": out.gateCommands = argv[++i].split(","); break;
		}
	}
	if (!out.rfc) throw new Error("rfc-dag:--rfc <file|-> 必填");
	return out;
}

function readRfc(rfcArg: string, cwd: string): string {
	if (rfcArg === "-") {
		return readFileSync(0, "utf-8");   // stdin
	}
	return readFileSync(`${cwd}/${rfcArg}`, "utf-8");
}

export async function runRfcDagMode(argv: string[], opts: RfcDagModeOptions) {
	const parsed = parseRfcDagArgs(argv);
	const cwd = opts.cwd ?? process.cwd();
	const rfc = readRfc(parsed.rfc, cwd);
	const { tools, systemPrompt, safety } = createLoopAgentDeps();   // 探针确认:无参,返 LoopAgentDeps{tools,systemPrompt,safety}
	const agentRunner = new InProcessAgentRunner({
		provider: opts.provider, model: opts.model, getApiKey: opts.getApiKey,
		tools, systemPrompt, safety, streamFn: opts.streamFn,
	});
	const exit: ExitConditionConfig = {
		maxRuns: parsed.maxRuns, maxCost: parsed.maxCost, maxDurationMs: parsed.maxDurationMs,
	};
	const config: RfcDagConfig = {
		rfc, exit, maxUnitRetries: parsed.maxUnitRetries, baseBranch: parsed.baseBranch, cwd,
	};
	if (parsed.review) {
		config.review = { rubric: "改动符合 scope/acceptanceTests;不破坏现有测试/类型;无明显 slop", verifier: createSantaVerifier({ getApiKey: opts.getApiKey, provider: opts.provider, model: opts.model, streamFn: opts.streamFn }) };
	}
	const deps: RfcDagDeps = {
		gitOpsFactory: (c: string) => new DryRunGitOps({ cwd: c }),
		worktreeOps: new DryRunWorktreeOps({ cwd }),
		gateFactory: (c: string) => new LocalBuildGate({ cwd: c, commands: parsed.gateCommands ?? ["pnpm -r typecheck", "pnpm -r test"] }),
		agentRunner,
		decomposer: new DagDecomposer({ agentRunner }),
		state: new FileRfcDagState({ dir: `${cwd}/.agentforge/rfc-dag` }),
	};
	const runner = new RfcDagRunner(config, deps);
	const result = await runner.run();
	console.log(`RFC-DAG 完成:${result.units.filter(u => u.status === "merged").length}/${result.units.length} unit merged,cost ${result.totalCost},stop ${result.stopReason}`);
	return result;
}
```

`index.ts` 路由修改(与 `loop` 并列,子命令优先):

```ts
// packages/cli/src/index.ts(在现有 loop 路由前/后加 rfc-dag)
const hasRfcDagSubcommand = argv[0] === "rfc-dag";
if (hasRfcDagSubcommand) {
	const { runRfcDagMode } = await import("./rfc-dag/rfc-dag-mode.js");
	await runRfcDagMode(argv.slice(1), { getApiKey });
	return;
}
const hasLoopSubcommand = argv[0] === "loop";
if (hasLoopSubcommand) {
	const { runLoopMode } = await import("./loop/loop-mode.js");
	await runLoopMode(argv.slice(1), { getApiKey });
	return;
}
// ...原有 print/rpc/repl flag 检测
```

> **执行者注:** Read `index.ts` 现有 loop 路由位置(子命令优先段),在 `loop` 路由旁加 `rfc-dag` 路由。保持现有 flag 路由(print>rpc>repl)不变。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/rfc-dag/rfc-dag-mode.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + build**

Run: `pnpm --filter @agentforge/cli typecheck && pnpm --filter @agentforge/cli build`
Expected: 0 error。若 `loop-mode.test.ts` 仍报 `AssistantMessage`(Task 1 未修或不阻塞),确认是 test-only 不影响 build。

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/rfc-dag/rfc-dag-mode.ts packages/cli/src/rfc-dag/rfc-dag-mode.test.ts packages/cli/src/index.ts
git commit -m "feat(rfc-dag): Slice 6 Task 7 CLI runRfcDagMode(argv+wiring+santa)+index.ts 路由

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8:真对话自举验证 + memory/handoff

**Files:**
- 无新 src(test 已全)。验证步骤(真 LLM,非自动化 TDD)+ memory 更新。
- Modify(可选): `C:\Users\90514\.claude\projects\C--Users-90514-code-primo-agentforge\memory\agentforge-project-direction.md`(加 Slice 6 RFC-DAG 段)

**目的:** 在 agentforge 自身上真跑 `agentforge rfc-dag`,验证 DAG 编排骨架(decompose→worktree→agent→commit→gate→merge→final verify)+ resumable + retry。类比 continuous-PR Task 8 自举。

- [ ] **Step 1: 预检 repo 状态**

Run: `git -C . status --short && git -C . branch --show-current`
Expected: working tree 干净,在 pi 分支。RFC-DAG 会真改 agentforge(pi 分支)+ 打 rollback tag + 本地 merge。

- [ ] **Step 2: 真跑 RFC-DAG(2 unit 无依赖,补测试)**

```
set -a; source .env; set +a; pnpm --filter @agentforge/cli exec agentforge rfc-dag \
  --rfc - --base-branch pi --provider xiaomi-token-plan-cn --model mimo-v2.5-pro \
  --max-runs 10 --max-unit-retries 2 --gate-commands "pnpm --filter @agentforge/harness test,pnpm --filter @agentforge/cli typecheck"
```
stdin 输入 RFC(示例):
```
RFC:给 agentforge harness 补两个边界测试。
unit1:给 packages/harness/src/adr.ts 补边界测试(recordAdr 空 slug/listAdrs 无文件)。
unit2:给 packages/harness/src/audit.ts 补边界测试(activeLayers 报告/环形 buffer cap)。
两 unit 互不依赖,可并行(但 MVP 串行)。
```
Expected:
- AI decompose 产 2 unit DAG(u1/u2 无依赖)。
- u1:worktree→agent 用 write 创建 adr 边界测试→commit→gate(harness test)pass→merge pi。
- u2:worktree→agent 创建 audit 边界测试→commit→gate pass→merge pi。
- final verify(gate 全量)pass。
- 输出 rollback tag + unit scorecards(2/2 merged)。

- [ ] **Step 3: 验证关键链路**

- `git log --oneline -5`:应有 agent 产的 2 commit(adr 测试 + audit 测试)merge 到 pi。
- `.agentforge/rfc-dag/state.json`:units u1/u2 status=merged。
- `.agentforge/worktrees/`:应清空(removeWorktree 成功)。
- `pnpm --filter @agentforge/harness test`:新测试绿。
- 回滚验证:`git reset --hard <rollbackTag>` 恢复循环前 pi(验证后可 reset 回或保留 agent 产)。

- [ ] **Step 4: 验证 resumable(中断恢复)**

手动中断 Step 2(Ctrl-C 在 u2 跑时)→ 重跑同命令 → state.load 读 u1=merged(跳过)+ u2=pending(恢复跑)→ 只跑 u2。验证 `decomposer.decompose` 未再调(恢复 run)。

- [ ] **Step 5: 验证 retry(gate 失败 retry)**

可选用一个故意会 gate 失败的 RFC unit(如 agent 产故意破测试的代码),观察 retry with context(lastGateOutput 进 notes 喂下轮)→ 达 maxUnitRetries 标 failed + 下游 skipped。

- [ ] **Step 6: 更新 memory + Commit 自举产 + handoff**

- memory `agentforge-project-direction.md`:加 Slice 6 RFC-DAG 段(MVP 完成,DAG 编排骨架验证结果,red-team 吸收,defer 项)。
- agent 自举产的测试 commit 已在 Step 2 merge pi(若保留)。
- handoff:`%TEMP%\agentforge-slice6-rfc-dag-handoff.md`(若需交接)。

```bash
# memory 更新(若改了 memory 文件,非 repo 内,不 commit repo)
# repo 内自举产的测试已在 Step 2 merge pi
git log --oneline -8   # 确认 agent 产 commit 在 pi
```

- [ ] **Step 7: 全量回归**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: 4 包 typecheck+test 全绿(395+ → +RFC-DAG 新测试)。

---

## Self-Review

**1. Spec coverage:**
- §4.1 DagDecomposer → Task 2 ✅
- §4.2 DagScheduler → Task 3 ✅
- §4.3 WorktreeOps/DryRunWorktreeOps → Task 4 ✅
- §4.4 RfcDagState → Task 5 ✅
- §4.5 RfcDagRunner → Task 6 ✅
- §4.6 review gate → Task 6(runUnit review 分支)+ Task 7(--review wiring)✅
- §4.7 CLI rfc-dag-mode + index.ts → Task 7 ✅
- §5 数据流 → Task 6 实现(run + runUnit)✅
- §6 错误处理 → Task 6(decompose throw / retry / merge 冲突 / isClean)+ Task 3(failed 下游 skipped)✅
- §7 测试策略 → Task 2-7 测试文件 ✅
- §8 陷阱 → Global Constraints + 各 Task 注 ✅
- red-team 🔴1(state2 5 字段)→ Task 6 实现 ✅
- red-team 🔴2(merge 非 ff retryable)→ Task 6 注 + Global Constraints ✅
- red-team 🟡3(worktree --force)→ Task 4 实现 ✅
- red-team 🟡4(DAG max-units)→ Task 2 ✅
- red-team 🟡5(reviewer diff text)→ Task 6 + Global Constraints ✅
- 真对话自举 → Task 8 ✅

**2. Placeholder scan:** 无 TBD/TODO。Task 7 wiring 测试注执行者按 loop-mode.test.ts 模式补完整(已说明,非 placeholder——是测试实现指引)。Task 8 是验证步骤(真 LLM),非代码 placeholder。

**3. Type consistency:**
- `WorkUnit`/`Dag`(Task 2)→ Task 3/5/6 引用一致 ✅
- `UnitStatus`/`UnitState`(Task 3)→ Task 5/6 引用一致 ✅
- `WorktreeOps`/`DryRunWorktreeOps`(Task 4)→ Task 6/7 引用一致 ✅
- `RfcDagState`/`RfcDagStateData`(Task 5)→ Task 6/7 引用一致 ✅
- `RfcDagConfig`/`RfcDagDeps`/`UnitResult`/`RfcDagResult`(Task 6)→ Task 7 引用一致 ✅
- `checkExit`/`LoopState`/`ExitConditionConfig`(continuous-PR)→ Task 6 import + state2 全 5 字段 ✅
- `gitOpsFactory`/`gateFactory`(factory 模式)→ Task 6 deps + Task 7 wiring 一致 ✅

**4. resumable 修正:** spec §5 `state.reset()` 假设新 run;plan Task 6 细化为 load 检测(恢复 run 不 reset/decompose)。这是 plan 对 spec 的实现细化(spec 是设计层面),Task 6 已标注。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-27-slice6-rfc-dag.md`. Two execution options:

**1. Subagent-Driven(推荐)** — per Task 派 fresh subagent + 两阶段 review(implementer haiku/sonnet + reviewer sonnet + final opus),类比 continuous-PR/Slice 5/7。适合 8 task TDD,风险隔离。

**2. Inline Execution** — 本 session 按 executing-plans 批量执行 + checkpoint。

**推荐 Subagent-Driven**(类比 continuous-PR Task 1-3 可 opencode 外包 + Task 4-7 inline TDD + Task 8 真对话自举)。memory `opencode-outsourcing-strategy` 记:边界清晰 task 适合外包(DagDecomposer/DagScheduler/WorktreeOps/RfcDagState 纯逻辑 + 临时 repo 测试);RfcDagRunner 编排 + CLI wiring + 真对话自举 inline(controller 亲核)。

**Which approach?**
