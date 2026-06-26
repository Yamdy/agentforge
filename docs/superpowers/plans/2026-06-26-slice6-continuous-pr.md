# Slice 6:continuous-PR 循环模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/cli/src/loop/` 实现 continuous-PR 循环模式(单 agent 迭代:分支→跑→commit→gate→merge→notes),自举 dry-run 在 agentforge 自身上验证循环编排骨架 + SHARED_TASK_NOTES 桥 + 退出条件。

**Architecture:** 分层抽象——`LoopRunner`(纯逻辑编排)注入 4 个接口(`GitOps`/`Gate`/`AgentRunner`/`SharedTaskNotes`)+ `ExitCondition`(纯函数)。每层可独立 mock 测试。`InProcessAgentRunner` per 迭代 `new AgentForgeHarness`(fresh context,不注入 instinct/auditor/verifier/compactor)。可选 `--review` 复用 `SantaVerifier.review`。harness/shared/eval 零改动,全落 cli。

**Tech Stack:** TypeScript / vitest / pnpm monorepo / `node:child_process`(git+gate exec)/ `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`(经 `@agentforge/harness` 间接)/ `@agentforge/harness`(`AgentForgeHarness` + `createSantaVerifier`)。

## Global Constraints

- **分支 `pi`**(AGENTS.md):所有 commit 落 pi 分支。
- **commit message 末尾加** `Co-Authored-By: Claude <noreply@anthropic.com>`(AGENTS.md)。
- **仅在用户要求时 commit/push**(AGENTS.md):本 plan 内 Task 的 commit step 是 plan 内置的 TDD 频繁提交,执行者按 step 走;但**不 push**(agentforge pi 无 remote,push 留用户决定)。
- **harness/shared/eval 零改动**(spec D11):全部新代码落 `packages/cli/src/loop/`;不动已绿的 395 测试。
- **不注入 instinct/auditor/verifier/compactor**(spec D13):`InProcessAgentRunner` 构造 harness 只注入 safety(不传 askHandler→ask 降级 deny)+ 基础(provider/model/systemPrompt/tools/streamFn),保证 per 迭代 fresh context。
- **SHARED_TASK_NOTES 放 `.agentforge/loop/`**(spec D12):不污染 repo working tree、不被 git 追踪。
- **GateGuard**(执行者会遇 hook):新文件 Write/Edit 需陈述 4 事实(谁调用/Grep 无现有/数据字段/用户指令);Bash 需 2 事实。
- **包名**:`@agentforge/cli`(monorepo,`pnpm --filter @agentforge/cli <script>`)。
- **TS strict**:`tsc` 零 error;`pnpm --filter @agentforge/cli typecheck` 必须过。

---

## File Structure

全部新文件落 `packages/cli/src/loop/`(7 src + 7 test),加 1 处 `index.ts` 路由修改。按依赖顺序:

| 文件 | 责任 | 依赖 |
|---|---|---|
| `loop/exit-condition.ts` | 纯函数 `checkExit(state, config)`:五退出条件判定 | 无 |
| `loop/shared-task-notes.ts` | `FileSharedTaskNotes`:读写 `.agentforge/loop/SHARED_TASK_NOTES.md` + maxEntries 截断 | 无 |
| `loop/git-ops.ts` | `GitOps` 接口 + `DryRunGitOps`(本地真 git exec) | 无 |
| `loop/gate.ts` | `Gate` 接口 + `LocalBuildGate`(exec commands) | 无 |
| `loop/agent-runner.ts` | `AgentRunner` 接口 + `InProcessAgentRunner`(new harness per run,cost=sum 所有 AssistantMessage) | `@agentforge/harness` |
| `loop/loop-runner.ts` | `LoopRunner`:驱动迭代循环 + try/catch 兜底 + signal 透传 | 上面 5 个接口 |
| `loop/loop-mode.ts` | `runLoopMode`:argv 解析 + 构造默认实现 + 接 santa + 输出摘要 | 上面 6 个 + `createSantaVerifier` |
| `index.ts`(修改) | `argv[0]==="loop"` 子命令路由(优先于 -p/--rpc flag) | `loop-mode.ts` |

测试文件一一对应(`*.test.ts` 同目录)。

---

## Task 1: ExitCondition(纯函数)

**Files:**
- Create: `packages/cli/src/loop/exit-condition.ts`
- Test: `packages/cli/src/loop/exit-condition.test.ts`

**Interfaces:**
- Consumes: 无(纯函数,无依赖)
- Produces: `LoopState` / `ExitConditionConfig` / `ExitDecision` 类型 + `checkExit(state, config)` 函数。`LoopRunner`(Task 6)与 `loop-mode`(Task 7)依赖 `checkExit` + 这些类型。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/loop/exit-condition.test.ts
import { describe, it, expect } from "vitest";
import { checkExit } from "./exit-condition.js";
import type { LoopState, ExitConditionConfig } from "./exit-condition.js";

const baseState: LoopState = {
	runs: 0,
	cost: 0,
	durationMs: 0,
	consecutiveCompletionSignals: 0,
	consecutiveGateFailures: 0,
};

describe("checkExit", () => {
	it("maxRuns 命中 → stop, reason max-runs", () => {
		const state: LoopState = { ...baseState, runs: 3 };
		const config: ExitConditionConfig = { maxRuns: 3 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-runs" });
	});

	it("maxRuns 未到 → 不停", () => {
		const state: LoopState = { ...baseState, runs: 2 };
		const config: ExitConditionConfig = { maxRuns: 3 };
		expect(checkExit(state, config)).toEqual({ stop: false, reason: "" });
	});

	it("maxCost 命中 → stop, reason max-cost", () => {
		const state: LoopState = { ...baseState, cost: 1.5 };
		const config: ExitConditionConfig = { maxCost: 1.5 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-cost" });
	});

	it("maxDurationMs 命中 → stop, reason max-duration", () => {
		const state: LoopState = { ...baseState, durationMs: 5000 };
		const config: ExitConditionConfig = { maxDurationMs: 5000 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-duration" });
	});

	it("completionSignal 达 threshold(默认 1)→ stop, reason completion-signal", () => {
		const state: LoopState = { ...baseState, consecutiveCompletionSignals: 1 };
		const config: ExitConditionConfig = { completionSignal: "DONE" };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "completion-signal" });
	});

	it("completionSignal threshold=2 未达 → 不停", () => {
		const state: LoopState = { ...baseState, consecutiveCompletionSignals: 1 };
		const config: ExitConditionConfig = { completionSignal: "DONE", completionThreshold: 2 };
		expect(checkExit(state, config)).toEqual({ stop: false, reason: "" });
	});

	it("completionSignal threshold=2 达 → stop", () => {
		const state: LoopState = { ...baseState, consecutiveCompletionSignals: 2 };
		const config: ExitConditionConfig = { completionSignal: "DONE", completionThreshold: 2 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "completion-signal" });
	});

	it("consecutiveGateFailures 达默认 3 → stop, reason max-consecutive-gate-failures", () => {
		const state: LoopState = { ...baseState, consecutiveGateFailures: 3 };
		const config: ExitConditionConfig = {};
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-consecutive-gate-failures" });
	});

	it("consecutiveGateFailures 自定义 2 达 → stop", () => {
		const state: LoopState = { ...baseState, consecutiveGateFailures: 2 };
		const config: ExitConditionConfig = { maxConsecutiveGateFailures: 2 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-consecutive-gate-failures" });
	});

	it("无任何条件 → 永不停(调用方应至少配 maxRuns)", () => {
		expect(checkExit(baseState, {})).toEqual({ stop: false, reason: "" });
	});

	it("多条件同时命中 → stop=true(reason 为先命中者)", () => {
		const state: LoopState = { ...baseState, runs: 5, cost: 9.9 };
		const config: ExitConditionConfig = { maxRuns: 3, maxCost: 1.0 };
		const r = checkExit(state, config);
		expect(r.stop).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/loop/exit-condition.test.ts`
Expected: FAIL with "Cannot find module './exit-condition.js'"(文件未建)。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/loop/exit-condition.ts
/**
 * 循环退出条件(spec §4.5)。纯函数,无副作用,无依赖。
 *
 * 五条件任一命中 → stop。判定顺序:maxRuns → maxCost → maxDuration →
 * completionSignal → consecutiveGateFailures。abort 不在此判定(abort 由
 * LoopRunner 循环顶部单独检 signal.aborted,保持本函数纯——spec §7 测试列表
 * 亦不含 abort,印证此设计)。
 *
 * 无任何条件(config 全空)→ 永不停;调用方(runLoopMode)应强制至少一个退出条件。
 */

export interface LoopState {
	runs: number;
	cost: number;
	durationMs: number;
	consecutiveCompletionSignals: number;
	consecutiveGateFailures: number;
}

export interface ExitConditionConfig {
	maxRuns?: number;
	maxCost?: number;
	maxDurationMs?: number;
	completionSignal?: string;
	/** completionSignal 连续命中几次才停。默认 1。 */
	completionThreshold?: number;
	/** 连续 gate 失败几次提前停(防 agent 破坏自身 test 空转烧预算)。默认 3。 */
	maxConsecutiveGateFailures?: number;
}

export interface ExitDecision {
	stop: boolean;
	reason: "max-runs" | "max-cost" | "max-duration" | "completion-signal" | "max-consecutive-gate-failures" | "";
}

/**
 * 五条件任一命中 → { stop:true, reason }。无命中 → { stop:false, reason:"" }。
 */
export function checkExit(state: LoopState, config: ExitConditionConfig): ExitDecision {
	if (config.maxRuns != null && state.runs >= config.maxRuns) {
		return { stop: true, reason: "max-runs" };
	}
	if (config.maxCost != null && state.cost >= config.maxCost) {
		return { stop: true, reason: "max-cost" };
	}
	if (config.maxDurationMs != null && state.durationMs >= config.maxDurationMs) {
		return { stop: true, reason: "max-duration" };
	}
	if (
		config.completionSignal != null &&
		state.consecutiveCompletionSignals >= (config.completionThreshold ?? 1)
	) {
		return { stop: true, reason: "completion-signal" };
	}
	const maxFail = config.maxConsecutiveGateFailures ?? 3;
	if (state.consecutiveGateFailures >= maxFail) {
		return { stop: true, reason: "max-consecutive-gate-failures" };
	}
	return { stop: false, reason: "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/loop/exit-condition.test.ts`
Expected: PASS(11 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/loop/exit-condition.ts packages/cli/src/loop/exit-condition.test.ts
git commit -m "feat(loop): Slice 6 Task 1 ExitCondition 纯函数(五退出条件判定)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: SharedTaskNotes(文件桥)

**Files:**
- Create: `packages/cli/src/loop/shared-task-notes.ts`
- Test: `packages/cli/src/loop/shared-task-notes.test.ts`

**Interfaces:**
- Consumes: 无(纯文件 IO)
- Produces: `IterationProgress` / `SharedTaskNotes` 类型 + `FileSharedTaskNotes` 类。`LoopRunner`(Task 6)依赖 `SharedTaskNotes.read()`(注入 agent prompt)+ `SharedTaskNotes.write()`(迭代末尾记进度)。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/loop/shared-task-notes.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSharedTaskNotes } from "./shared-task-notes.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "notes-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("FileSharedTaskNotes", () => {
	it("read 首次(文件不存在)→ 空串", () => {
		const notes = new FileSharedTaskNotes({ dir });
		expect(notes.read()).toBe("");
	});

	it("write 追加一条 Progress 段 → read 含该段", () => {
		const notes = new FileSharedTaskNotes({ dir });
		notes.write({
			iteration: 1,
			replySummary: "added a test",
			gatePassed: true,
			merged: true,
		});
		const content = notes.read();
		expect(content).toContain("Iteration 1");
		expect(content).toContain("added a test");
		expect(content).toContain("Merged: true");
	});

	it("write 多条 → read 含全部", () => {
		const notes = new FileSharedTaskNotes({ dir });
		notes.write({ iteration: 1, replySummary: "a", gatePassed: true, merged: true });
		notes.write({
			iteration: 2, replySummary: "b", gatePassed: false, merged: false, gateOutput: "test fail",
		});
		const content = notes.read();
		expect(content).toContain("Iteration 1");
		expect(content).toContain("Iteration 2");
		expect(content).toContain("test fail");
	});

	it("maxEntries 截断:超 2 条保留最近 2 条", () => {
		const notes = new FileSharedTaskNotes({ dir, maxEntries: 2 });
		notes.write({ iteration: 1, replySummary: "a", gatePassed: true, merged: true });
		notes.write({ iteration: 2, replySummary: "b", gatePassed: true, merged: true });
		notes.write({ iteration: 3, replySummary: "c", gatePassed: true, merged: true });
		const content = notes.read();
		expect(content).not.toContain("Iteration 1");
		expect(content).toContain("Iteration 2");
		expect(content).toContain("Iteration 3");
	});

	it("reviewVerdict/reviewIssues/error 字段写入", () => {
		const notes = new FileSharedTaskNotes({ dir });
		notes.write({
			iteration: 1,
			replySummary: "x",
			gatePassed: false,
			merged: false,
			reviewVerdict: "naughty",
			reviewIssues: ["slop", "missing test"],
			error: "merge conflict",
		});
		const content = notes.read();
		expect(content).toContain("naughty");
		expect(content).toContain("slop");
		expect(content).toContain("merge conflict");
	});

	it("文件落在 dir/SHARED_TASK_NOTES.md", () => {
		const notes = new FileSharedTaskNotes({ dir });
		notes.write({ iteration: 1, replySummary: "a", gatePassed: true, merged: true });
		expect(existsSync(join(dir, "SHARED_TASK_NOTES.md"))).toBe(true);
	});

	it("dir 不存在时 write 自动创建", () => {
		const notes = new FileSharedTaskNotes({ dir: join(dir, "sub") });
		notes.write({ iteration: 1, replySummary: "a", gatePassed: true, merged: true });
		expect(notes.read()).toContain("Iteration 1");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/loop/shared-task-notes.test.ts`
Expected: FAIL with "Cannot find module './shared-task-notes.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/loop/shared-task-notes.ts
/**
 * 跨迭代上下文桥(spec §4.4)。SHARED_TASK_NOTES.md 记每轮 Progress + Next Steps,
 * 下轮 agent prompt 注入 read() 内容,实现跨迭代记忆(anti-pattern 2)。
 *
 * 文件落在传入 dir(调用方用 .agentforge/loop/,spec D12,不污染 repo、不被 git 追踪)。
 * maxEntries 截断轮转:red-team 🟡5b,防 notes 无界增长撑爆 agent prompt。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface IterationProgress {
	iteration: number;
	replySummary: string;
	gatePassed: boolean;
	gateOutput?: string;
	reviewVerdict?: "nice" | "naughty";
	reviewIssues?: string[];
	merged: boolean;
	error?: string;
	nextSteps?: string;
}

export interface SharedTaskNotes {
	/** 读 SHARED_TASK_NOTES.md(不存在 → "")。 */
	read(): string;
	/** 追加一条 Progress 段;超 maxEntries 保留最近 N 条。 */
	write(progress: IterationProgress): void;
}

export interface FileSharedTaskNotesOptions {
	dir: string;
	/** 保留最近多少条 Progress 段。默认 20。 */
	maxEntries?: number;
}

const FILENAME = "SHARED_TASK_NOTES.md";

export class FileSharedTaskNotes implements SharedTaskNotes {
	private readonly filePath: string;
	private readonly maxEntries: number;

	constructor(opts: FileSharedTaskNotesOptions) {
		this.filePath = join(opts.dir, FILENAME);
		this.maxEntries = opts.maxEntries ?? 20;
	}

	read(): string {
		if (!existsSync(this.filePath)) return "";
		return readFileSync(this.filePath, "utf8");
	}

	write(progress: IterationProgress): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const existing = this.read();
		const updated = existing + formatProgress(progress);
		const trimmed = trimToMaxEntries(updated, this.maxEntries);
		writeFileSync(this.filePath, trimmed, "utf8");
	}
}

/** Progress → markdown 段。 */
function formatProgress(p: IterationProgress): string {
	const lines: string[] = [`## Iteration ${p.iteration}`];
	lines.push(`- Reply: ${p.replySummary}`);
	lines.push(
		`- Gate: ${p.gatePassed ? "passed" : "failed"}${p.gateOutput ? ` | ${truncate(p.gateOutput, 500)}` : ""}`,
	);
	if (p.reviewVerdict) {
		lines.push(
			`- Review: ${p.reviewVerdict}${p.reviewIssues?.length ? ` | ${p.reviewIssues.join("; ")}` : ""}`,
		);
	}
	lines.push(`- Merged: ${p.merged}`);
	if (p.error) lines.push(`- Error: ${truncate(p.error, 500)}`);
	if (p.nextSteps) lines.push(`- Next Steps: ${p.nextSteps}`);
	lines.push("");
	return lines.join("\n") + "\n";
}

/** 按 "## Iteration " 分段,保留最近 maxEntries 条(删最旧)。 */
function trimToMaxEntries(content: string, maxEntries: number): string {
	const parts = content.split(/^## Iteration /m);
	const header = parts[0] ?? "";
	const segments = parts.slice(1);
	if (segments.length <= maxEntries) return content;
	const kept = segments.slice(segments.length - maxEntries);
	return header + "## Iteration " + kept.join("## Iteration ");
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) + "…" : s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/loop/shared-task-notes.test.ts`
Expected: PASS(7 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/loop/shared-task-notes.ts packages/cli/src/loop/shared-task-notes.test.ts
git commit -m "feat(loop): Slice 6 Task 2 SharedTaskNotes 文件桥(读写+maxEntries 截断)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: GitOps(DryRunGitOps 本地真 git exec)

**Files:**
- Create: `packages/cli/src/loop/git-ops.ts`
- Test: `packages/cli/src/loop/git-ops.test.ts`

**Interfaces:**
- Consumes: 无(纯 child_process git exec)
- Produces: `MergeResult` / `GitOps` 接口 + `DryRunGitOps` 类。`LoopRunner`(Task 6)依赖全部方法;`loop-mode`(Task 7)构造 `DryRunGitOps({ cwd })`。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/loop/git-ops.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DryRunGitOps } from "./git-ops.js";

let dir: string;
let git: DryRunGitOps;

function sh(cmd: string): string {
	return execSync(cmd, { cwd: dir }).toString().trim();
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "gitops-"));
	sh("git init -b main");
	sh('git config user.email "t@t"');
	sh('git config user.name "t"');
	writeFileSync(join(dir, "README.md"), "init");
	sh("git add -A && git commit -m init");
	git = new DryRunGitOps({ cwd: dir });
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("DryRunGitOps", () => {
	it("currentBranch → main", async () => {
		expect(await git.currentBranch()).toBe("main");
	});

	it("isClean(无改动)→ true", async () => {
		expect(await git.isClean()).toBe(true);
	});

	it("hasChanges(无)→ false;(改文件后)→ true", async () => {
		expect(await git.hasChanges()).toBe(false);
		writeFileSync(join(dir, "a.txt"), "a");
		expect(await git.hasChanges()).toBe(true);
	});

	it("createBranch + checkout → currentBranch 切换", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		expect(await git.currentBranch()).toBe("feature");
	});

	it("commit(有改动)→ true 且 working tree 干净 + message 落盘", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "a.txt"), "a");
		const committed = await git.commit("add a");
		expect(committed).toBe(true);
		expect(await git.isClean()).toBe(true);
		expect(sh("git log -1 --pretty=%s")).toBe("add a");
	});

	it("commit(无改动)→ false", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		const committed = await git.commit("nothing");
		expect(committed).toBe(false);
	});

	it("merge feature → main:ok=true", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "a.txt"), "a");
		await git.commit("add a");
		await git.checkout("main");
		const r = await git.merge("feature");
		expect(r.ok).toBe(true);
	});

	it("merge 冲突 → ok=false, conflict truthy, main 恢复干净", async () => {
		writeFileSync(join(dir, "f.txt"), "main\n");
		sh("git add -A && git commit -m base");
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "f.txt"), "feature\n");
		await git.commit("feature-change");
		await git.checkout("main");
		writeFileSync(join(dir, "f.txt"), "main2\n");
		await git.commit("main-change");
		const r = await git.merge("feature");
		expect(r.ok).toBe(false);
		expect(r.conflict).toBeTruthy();
		// merge --abort 后 main 干净,可下轮操作
		expect(await git.isClean()).toBe(true);
	});

	it("diff(有未 commit 改动)→ 含改动文件名", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "a.txt"), "a");
		const d = await git.diff();
		expect(d).toContain("a.txt");
	});

	it("tag → git tag -l 含该 tag", async () => {
		await git.tag("loop-rollback-x");
		expect(sh("git tag -l")).toContain("loop-rollback-x");
	});

	it("deleteBranch → 分支删除", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "a.txt"), "a");
		await git.commit("add a");
		await git.checkout("main");
		await git.deleteBranch("feature");
		expect(sh("git branch -l")).not.toContain("feature");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/loop/git-ops.test.ts`
Expected: FAIL with "Cannot find module './git-ops.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/loop/git-ops.ts
/**
 * GitOps 接口 + DryRunGitOps 实现(spec §4.1)。
 *
 * DryRunGitOps:本地真 git exec(branch/checkout/add/commit/merge/tag),
 * 不 push/PR/建 PR。merge 冲突自动 --abort 恢复 main 干净(防 conflict 状态
 * 污染下轮)。用 node:child_process exec,跨平台。
 *
 * 未来若需 GitHub 支持:PR 模型(push/createPR/waitCI/mergePR)与本地
 * checkout-merge 序列不兼容,将重新设计接口(spec red-team 🟡4)。
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface MergeResult {
	ok: boolean;
	conflict?: string;
}

export interface GitOps {
	createBranch(name: string): Promise<void>;
	checkout(name: string): Promise<void>;
	/** 有 staged/unstaged changes 才 commit。返回是否实际 commit。 */
	commit(message: string): Promise<boolean>;
	/** merge 指定分支到当前分支。冲突 → { ok:false, conflict } 并自动 abort。 */
	merge(branch: string): Promise<MergeResult>;
	currentBranch(): Promise<string>;
	hasChanges(): Promise<boolean>;
	deleteBranch(name: string): Promise<void>;
	/** 未 commit 改动的 diff(供 review gate 评审)。 */
	diff(): Promise<string>;
	/** 打 tag(循环开始前记回滚点)。 */
	tag(name: string): Promise<void>;
	/** working tree 是否干净。 */
	isClean(): Promise<boolean>;
}

export interface DryRunGitOpsOptions {
	cwd: string;
}

export class DryRunGitOps implements GitOps {
	private readonly cwd: string;

	constructor(opts: DryRunGitOpsOptions) {
		this.cwd = opts.cwd;
	}

	private async run(args: string): Promise<string> {
		const { stdout } = await execAsync(`git ${args}`, { cwd: this.cwd });
		return stdout.toString().trim();
	}

	async createBranch(name: string): Promise<void> {
		await this.run(`checkout -b ${name}`);
	}

	async checkout(name: string): Promise<void> {
		await this.run(`checkout ${name}`);
	}

	async commit(message: string): Promise<boolean> {
		if (!(await this.hasChanges())) return false;
		await this.run(`add -A`);
		await this.run(`commit -m ${shellQuote(message)}`);
		return true;
	}

	async merge(branch: string): Promise<MergeResult> {
		try {
			await this.run(`merge --no-edit ${branch}`);
			return { ok: true };
		} catch (e) {
			const stderr = e instanceof Error ? e.message : String(e);
			let conflict = "merge conflict";
			try {
				const files = await this.run(`diff --name-only --diff-filter=U`);
				if (files) conflict = `conflict in: ${files}`;
				else conflict = stderr;
			} catch {
				conflict = stderr;
			}
			// abort 恢复 main 到合并前干净状态(防 conflict 状态污染下轮)。
			try {
				await this.run(`merge --abort`);
			} catch {
				// 可能已无 in-progress merge,忽略。
			}
			return { ok: false, conflict };
		}
	}

	async currentBranch(): Promise<string> {
		return this.run(`rev-parse --abbrev-ref HEAD`);
	}

	async hasChanges(): Promise<boolean> {
		const status = await this.run(`status --porcelain`);
		return status.length > 0;
	}

	async deleteBranch(name: string): Promise<void> {
		await this.run(`branch -D ${name}`);
	}

	async diff(): Promise<string> {
		return this.run(`diff HEAD`);
	}

	async tag(name: string): Promise<void> {
		await this.run(`tag ${name}`);
	}

	async isClean(): Promise<boolean> {
		return !(await this.hasChanges());
	}
}

/** 简单双引号转义(本 slice commit message 单行够用)。 */
function shellQuote(s: string): string {
	return `"${s.replace(/"/g, '\\"')}"`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/loop/git-ops.test.ts`
Expected: PASS(11 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/loop/git-ops.ts packages/cli/src/loop/git-ops.test.ts
git commit -m "feat(loop): Slice 6 Task 3 GitOps+DryRunGitOps(本地 git exec+merge abort)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Gate(LocalBuildGate exec commands)

**Files:**
- Create: `packages/cli/src/loop/gate.ts`
- Test: `packages/cli/src/loop/gate.test.ts`

**Interfaces:**
- Consumes: 无(纯 child_process exec)
- Produces: `GateResult` / `Gate` 接口 + `LocalBuildGate` 类。`LoopRunner`(Task 6)依赖 `gate.run()`;`loop-mode`(Task 7)构造 `LocalBuildGate({ cwd, commands? })`。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/loop/gate.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalBuildGate } from "./gate.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "gate-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("LocalBuildGate", () => {
	it("全部命令退出 0 → passed=true", async () => {
		const gate = new LocalBuildGate({ cwd: dir, commands: ['node -e "process.exit(0)"'] });
		const r = await gate.run();
		expect(r.passed).toBe(true);
	});

	it("命令退出非 0 → passed=false, output 含 stderr", async () => {
		const gate = new LocalBuildGate({
			cwd: dir,
			commands: ['node -e "console.error(42);process.exit(1)"'],
		});
		const r = await gate.run();
		expect(r.passed).toBe(false);
		expect(r.output).toContain("42");
	});

	it("多命令:第一个失败短路 → passed=false", async () => {
		const gate = new LocalBuildGate({
			cwd: dir,
			commands: ['node -e "process.exit(1)"', 'node -e "process.exit(0)"'],
		});
		const r = await gate.run();
		expect(r.passed).toBe(false);
	});

	it("多命令:全过 → passed=true", async () => {
		const gate = new LocalBuildGate({
			cwd: dir,
			commands: ['node -e "process.exit(0)"', 'node -e "process.exit(0)"'],
		});
		const r = await gate.run();
		expect(r.passed).toBe(true);
	});

	it("默认 commands 构造不 throw(不在测试里真跑 pnpm)", () => {
		const gate = new LocalBuildGate({ cwd: dir });
		expect(gate).toBeInstanceOf(LocalBuildGate);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/loop/gate.test.ts`
Expected: FAIL with "Cannot find module './gate.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/loop/gate.ts
/**
 * Gate 接口 + LocalBuildGate(spec §4.2)。
 *
 * LocalBuildGate:依次 exec commands,任一非 0 退出 → passed=false(短路)。
 * 默认 commands = ["pnpm -r typecheck", "pnpm -r test"](可配 gateCommands 降单包)。
 * output = 合并 stdout+stderr(失败时含错误,供 notes 喂下轮 agent)。
 *
 * 未来若需 CI 支持(gh pr checks)重新评估接口(spec red-team 🟡4)。
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface GateResult {
	passed: boolean;
	output: string;
}

export interface Gate {
	run(): Promise<GateResult>;
}

export interface LocalBuildGateOptions {
	cwd: string;
	commands?: string[];
}

const DEFAULT_COMMANDS = ["pnpm -r typecheck", "pnpm -r test"];

export class LocalBuildGate implements Gate {
	private readonly cwd: string;
	private readonly commands: string[];

	constructor(opts: LocalBuildGateOptions) {
		this.cwd = opts.cwd;
		this.commands = opts.commands ?? DEFAULT_COMMANDS;
	}

	async run(): Promise<GateResult> {
		const outputs: string[] = [];
		for (const cmd of this.commands) {
			try {
				const { stdout, stderr } = await execAsync(cmd, {
					cwd: this.cwd,
					maxBuffer: 10 * 1024 * 1024,
				});
				outputs.push(stdout.toString(), stderr.toString());
			} catch (e: unknown) {
				const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
				outputs.push(
					err.stdout?.toString() ?? "",
					err.stderr?.toString() ?? "",
					err.message ?? String(e),
				);
				return { passed: false, output: outputs.filter(Boolean).join("\n") };
			}
		}
		return { passed: true, output: outputs.filter(Boolean).join("\n") };
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/loop/gate.test.ts`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/loop/gate.ts packages/cli/src/loop/gate.test.ts
git commit -m "feat(loop): Slice 6 Task 4 Gate+LocalBuildGate(exec commands 短路判定)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: AgentRunner(InProcessAgentRunner,new harness per run)

**Files:**
- Create: `packages/cli/src/loop/agent-runner.ts`
- Test: `packages/cli/src/loop/agent-runner.test.ts`

**Interfaces:**
- Consumes: `@agentforge/harness` 的 `AgentForgeHarness` / `createMemorySession` / `createEventBus`(eval runTask 同构);`@earendil-works/pi-ai` 的 `AssistantMessageEventStream` + `@earendil-works/pi-agent-core` 的 `AssistantMessage` / `AssistantMessageEvent`(mock streamFn 契约,见 eval runner.test.ts)。
- Produces: `AgentRunResult` / `AgentRunOptions` / `AgentRunner` 接口 + `InProcessAgentRunner` 类。`LoopRunner`(Task 6)依赖 `agentRunner.run(prompt, {cwd, signal})`;`loop-mode`(Task 7)构造 `InProcessAgentRunner({provider, model, getApiKey, tools, systemPrompt, streamFn?, safety?, cwd?})`。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/loop/agent-runner.test.ts
import { describe, it, expect } from "vitest";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";
import { InProcessAgentRunner } from "./agent-runner.js";

/** 构造带 usage 的合法 AssistantMessage(契约同 eval runner.test.ts)。 */
function makeAssistantMessage(
	text: string,
	usage: { input: number; output: number; costTotal: number },
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic" as any,
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: usage.input,
			output: usage.output,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: usage.input + usage.output,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage.costTotal },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** mock streamFn:产出 start + done 事件,done 携带带 usage 的 AssistantMessage。 */
function makeMockStreamFn(
	text: string,
	usage: { input: number; output: number; costTotal: number },
) {
	return () => {
		const stream = new AssistantMessageEventStream();
		const message = makeAssistantMessage(text, usage);
		const startEvent: AssistantMessageEvent = { type: "start", partial: message };
		const doneEvent: AssistantMessageEvent = { type: "done", reason: "stop", message };
		queueMicrotask(() => {
			stream.push(startEvent);
			stream.push(doneEvent);
		});
		return stream;
	};
}

describe("InProcessAgentRunner", () => {
	it("run → 提取 reply / cost / tokensIn / tokensOut", async () => {
		const runner = new InProcessAgentRunner({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			getApiKey: () => "k",
			tools: [],
			systemPrompt: "",
			streamFn: makeMockStreamFn("hello", { input: 10, output: 5, costTotal: 0.02 }),
		});
		const r = await runner.run("do something", { cwd: process.cwd() });
		expect(r.reply).toBe("hello");
		expect(r.cost).toBeCloseTo(0.02, 6);
		expect(r.tokensIn).toBe(10);
		expect(r.tokensOut).toBe(5);
	});

	it("fresh context:多次 run 独立(新 harness per run,streamFn 闭包计数)", async () => {
		let callCount = 0;
		const streamFn = () => {
			callCount++;
			const stream = new AssistantMessageEventStream();
			const message = makeAssistantMessage(`reply-${callCount}`, {
				input: 1,
				output: 1,
				costTotal: 0.01,
			});
			const startEvent: AssistantMessageEvent = { type: "start", partial: message };
			const doneEvent: AssistantMessageEvent = { type: "done", reason: "stop", message };
			queueMicrotask(() => {
				stream.push(startEvent);
				stream.push(doneEvent);
			});
			return stream;
		};
		const runner = new InProcessAgentRunner({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			getApiKey: () => "k",
			tools: [],
			systemPrompt: "",
			streamFn,
		});
		const r1 = await runner.run("p1", { cwd: process.cwd() });
		const r2 = await runner.run("p2", { cwd: process.cwd() });
		expect(r1.reply).toBe("reply-1");
		expect(r2.reply).toBe("reply-2");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/loop/agent-runner.test.ts`
Expected: FAIL with "Cannot find module './agent-runner.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/loop/agent-runner.ts
/**
 * AgentRunner 接口 + InProcessAgentRunner(spec §4.3)。
 *
 * InProcessAgentRunner:每次 run 构造 fresh AgentForgeHarness(ADR-0001b in-process),
 * 注入 safety(不传 askHandler → ask 降级 deny,同 rpc)。**不注入**
 * instinct/auditor/verifier/compactor(spec D13 / red-team 🔴2):这三者跨迭代
 * 共享进程级状态(instinct store 订阅 events 写 observations、auditor 累积),
 * 会破坏 fresh context;循环迭代要纯 fresh。review gate 用独立 SantaVerifier
 * 实例(不经 harness.verify)。
 *
 * cost = sum 所有 AssistantMessage usage.cost.total(red-team ⚪6:覆盖迭代内
 * 多轮工具调用中间成本,不只 last);reply = 最后 AssistantMessage content
 * TextContent join。signal 透传 harness.prompt(signal)→ agent.abort。
 *
 * 借鉴 eval runTask 但改进 cost 提取(sum vs last)。
 */
import {
	AgentForgeHarness,
	createEventBus,
	createMemorySession,
} from "@agentforge/harness";
import type {
	AgentMessage,
	AssistantMessage,
} from "@earendil-works/pi-agent-core";

export interface AgentRunResult {
	reply: string;
	cost: number;
	tokensIn: number;
	tokensOut: number;
}

export interface AgentRunOptions {
	cwd: string;
	signal?: AbortSignal;
}

export interface AgentRunner {
	run(prompt: string, opts: AgentRunOptions): Promise<AgentRunResult>;
}

export interface InProcessAgentRunnerOptions {
	provider: string;
	model: string;
	getApiKey?: (provider: string) => string | Promise<string | undefined>;
	tools: any[];
	systemPrompt: string;
	streamFn?: any;
	safety?: any;
	cwd?: string;
}

export class InProcessAgentRunner implements AgentRunner {
	private readonly opts: InProcessAgentRunnerOptions;

	constructor(opts: InProcessAgentRunnerOptions) {
		this.opts = opts;
	}

	async run(prompt: string, runOpts: AgentRunOptions): Promise<AgentRunResult> {
		// fresh harness per run(D13:不注入 instinct/auditor/verifier/compactor)。
		const harness = new AgentForgeHarness({
			session: createMemorySession(),
			events: createEventBus(),
			tools: this.opts.tools,
			provider: this.opts.provider,
			model: this.opts.model,
			systemPrompt: this.opts.systemPrompt,
			getApiKey: this.opts.getApiKey,
			streamFn: this.opts.streamFn,
			safety: this.opts.safety,
			cwd: runOpts.cwd ?? this.opts.cwd,
			initialMessages: [],
		});

		await harness.prompt(prompt, runOpts.signal);

		const messages = harness.agent.state.messages;
		const assistants = messages.filter(isAssistantMessage);
		// cost/tokens = sum 所有 AssistantMessage(red-team ⚪6:覆盖多轮工具调用中间成本)。
		const cost = assistants.reduce(
			(sum, m) => sum + (m.usage?.cost?.total ?? 0),
			0,
		);
		const tokensIn = assistants.reduce((sum, m) => sum + (m.usage?.input ?? 0), 0);
		const tokensOut = assistants.reduce((sum, m) => sum + (m.usage?.output ?? 0), 0);
		// reply = 最后 AssistantMessage content TextContent join。
		const last = assistants[assistants.length - 1];
		const reply = last ? contentToText(last.content) : "";
		return { reply, cost, tokensIn, tokensOut };
	}
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return (
		m != null &&
		typeof m === "object" &&
		(m as { role?: string }).role === "assistant"
	);
}

function contentToText(content: AssistantMessage["content"]): string {
	let out = "";
	for (const block of content as ReadonlyArray<{ type?: string; text?: string }>) {
		if (block && block.type === "text") out += block.text ?? "";
	}
	return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/loop/agent-runner.test.ts`
Expected: PASS(2 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/loop/agent-runner.ts packages/cli/src/loop/agent-runner.test.ts
git commit -m "feat(loop): Slice 6 Task 5 AgentRunner+InProcessAgentRunner(new harness per run,cost=sum)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: LoopRunner(核心编排,全 mock 测试)

**Files:**
- Create: `packages/cli/src/loop/loop-runner.ts`
- Test: `packages/cli/src/loop/loop-runner.test.ts`

**Interfaces:**
- Consumes: `checkExit` / `LoopState` / `ExitConditionConfig`(Task 1);`GitOps`(Task 3);`Gate`(Task 4);`AgentRunner`(Task 5);`SharedTaskNotes`(Task 2);`Rubric` / `SantaVerifier`(`@agentforge/harness`,Task 7 构造 ReviewGate)。
- Produces: `ReviewGate` / `LoopConfig` / `LoopDeps` / `IterationResult` / `LoopResult` 类型 + `LoopRunner` 类。`loop-mode`(Task 7)依赖 `new LoopRunner(config, deps)` + `run(signal)`。

**plan 对 spec 的澄清:**
- `LoopConfig` 加 `cwd: string`(spec §4.6 漏列,agentRunner.run 需 cwd)。
- remote 同步断言(spec §5 🟡5e)**defer**:GitOps 接口未提供 remote 比较方法,dry-run 无 remote 不触发;future GitHub adapter 加 `isMainSyncedOrNoRemote()` 后补。LoopRunner.run 只 assert `isClean()` + `currentBranch()==="main"`(接口已有)。
- 每轮末尾统一 `gitOps.checkout("main")`(best-effort):成功 merge 后无操作;gate 失败/merge 冲突/review naughty/crash 后回 main,为下轮 createBranch from main 准备,避免分支残留。
- abort 在循环顶部检 `signal?.aborted`(checkExit 纯函数不含 abort,spec §7 印证)。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/loop/loop-runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { LoopRunner } from "./loop-runner.js";
import type { LoopDeps } from "./loop-runner.js";

/** 构造全 mock 的 LoopDeps。各方法默认 happy-path,测试里按需 override。 */
function makeMocks() {
	const gitOps = {
		isClean: vi.fn().mockResolvedValue(true),
		currentBranch: vi.fn().mockResolvedValue("main"),
		tag: vi.fn().mockResolvedValue(undefined),
		createBranch: vi.fn().mockResolvedValue(undefined),
		checkout: vi.fn().mockResolvedValue(undefined),
		commit: vi.fn().mockResolvedValue(true),
		merge: vi.fn().mockResolvedValue({ ok: true }),
		deleteBranch: vi.fn().mockResolvedValue(undefined),
		diff: vi.fn().mockResolvedValue(""),
		hasChanges: vi.fn().mockResolvedValue(true),
	};
	const gate = {
		run: vi.fn().mockResolvedValue({ passed: true, output: "ok" }),
	};
	const agentRunner = {
		run: vi.fn().mockResolvedValue({ reply: "done", cost: 0.01, tokensIn: 1, tokensOut: 1 }),
	};
	const notes = {
		read: vi.fn().mockReturnValue(""),
		write: vi.fn(),
	};
	return { gitOps, gate, agentRunner, notes };
}

describe("LoopRunner", () => {
	it("正常 1 轮:pass→merge→maxRuns=1 停", async () => {
		const m = makeMocks();
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 1 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.totalRuns).toBe(1);
		expect(result.stopReason).toBe("max-runs");
		expect(result.iterations).toHaveLength(1);
		expect(result.iterations[0].merged).toBe(true);
		expect(result.iterations[0].gatePassed).toBe(true);
		expect(m.gitOps.merge).toHaveBeenCalled();
		expect(result.rollbackTag).toMatch(/^loop-rollback-/);
	});

	it("gate 失败:不 merge,notes 写 gateOutput,maxRuns=2 跑 2 轮", async () => {
		const m = makeMocks();
		m.gate.run.mockResolvedValue({ passed: false, output: "test failed: x" });
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 2 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.totalRuns).toBe(2);
		expect(m.gitOps.merge).not.toHaveBeenCalled();
		expect(m.notes.write).toHaveBeenCalledWith(
			expect.objectContaining({ gatePassed: false, gateOutput: "test failed: x" }),
		);
		expect(result.iterations.every((i) => !i.merged)).toBe(true);
	});

	it("迭代崩溃:agentRunner throw → iterResult.error,继续下轮", async () => {
		const m = makeMocks();
		m.agentRunner.run.mockRejectedValue(new Error("agent boom"));
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 2 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.totalRuns).toBe(2);
		expect(result.iterations.every((i) => i.error === "agent boom")).toBe(true);
		expect(m.notes.write).toHaveBeenCalledWith(
			expect.objectContaining({ error: "agent boom" }),
		);
	});

	it("completion signal:reply 含 phrase→threshold=1 停", async () => {
		const m = makeMocks();
		m.agentRunner.run.mockResolvedValue({
			reply: "all done COMPLETED", cost: 0.01, tokensIn: 1, tokensOut: 1,
		});
		const runner = new LoopRunner(
			{
				prompt: "p",
				exit: { completionSignal: "COMPLETED", completionThreshold: 1 },
				cwd: process.cwd(),
			},
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.stopReason).toBe("completion-signal");
		expect(result.totalRuns).toBe(1);
	});

	it("maxCost 停", async () => {
		const m = makeMocks();
		m.agentRunner.run.mockResolvedValue({
			reply: "done", cost: 0.5, tokensIn: 1, tokensOut: 1,
		});
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 10, maxCost: 0.5 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.stopReason).toBe("max-cost");
		expect(result.totalRuns).toBe(1);
	});

	it("review naughty:不 commit/merge,notes 写 issues", async () => {
		const m = makeMocks();
		const verifier = {
			review: vi.fn().mockResolvedValue({
				verdict: "naughty",
				issues: [{ severity: "high", description: "slop" }],
				reviews: [],
			}),
		};
		const runner = new LoopRunner(
			{
				prompt: "p",
				exit: { maxRuns: 1 },
				cwd: process.cwd(),
				review: { rubric: { criteria: ["c"] }, verifier: verifier as any },
			},
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(m.gitOps.commit).not.toHaveBeenCalled();
		expect(m.gitOps.merge).not.toHaveBeenCalled();
		expect(result.iterations[0].reviewVerdict).toBe("naughty");
		expect(result.iterations[0].merged).toBe(false);
		expect(m.notes.write).toHaveBeenCalledWith(
			expect.objectContaining({ reviewVerdict: "naughty", reviewIssues: ["slop"] }),
		);
	});

	it("merge 冲突:不 merge,notes 写 conflict", async () => {
		const m = makeMocks();
		m.gitOps.merge.mockResolvedValue({ ok: false, conflict: "conflict in: f.ts" });
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 1 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.iterations[0].merged).toBe(false);
		expect(result.iterations[0].error).toBe("conflict in: f.ts");
		expect(m.notes.write).toHaveBeenCalledWith(
			expect.objectContaining({ error: "conflict in: f.ts" }),
		);
	});

	it("isClean 失败 → throw 不开始", async () => {
		const m = makeMocks();
		m.gitOps.isClean.mockResolvedValue(false);
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 1 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		await expect(runner.run()).rejects.toThrow("working tree not clean");
	});

	it("abort:signal 已 aborted → stopReason aborted,不跑迭代", async () => {
		const m = makeMocks();
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 5 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const ac = new AbortController();
		ac.abort();
		const result = await runner.run(ac.signal);
		expect(result.stopReason).toBe("aborted");
		expect(result.totalRuns).toBe(0);
		expect(m.agentRunner.run).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/loop/loop-runner.test.ts`
Expected: FAIL with "Cannot find module './loop-runner.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/loop/loop-runner.ts
/**
 * LoopRunner:continuous-PR 循环编排(spec §4.6 / §5)。
 *
 * 每迭代:checkExit → createBranch → checkout → notes.read → agentRunner.run →
 * (review?) → commit → gate → merge? → notes.write → checkout main。
 * 迭代级 try/catch 兜底(spec D10),error 进 notes 喂下轮(anti-pattern 3)。
 * signal 透传 agentRunner(harness.prompt(signal)→agent.abort);abort 在循环顶部检。
 *
 * 开始前:assert isClean + currentBranch==="main" + tag 回滚点(spec 🔴1)。
 * 结束(任何 stopReason):输出回滚 tag + git reset --hard 恢复提示。
 */
import { checkExit } from "./exit-condition.js";
import type { ExitConditionConfig, LoopState } from "./exit-condition.js";
import type { GitOps } from "./git-ops.js";
import type { Gate } from "./gate.js";
import type { AgentRunner } from "./agent-runner.js";
import type { SharedTaskNotes } from "./shared-task-notes.js";
import type { Rubric, SantaVerifier } from "@agentforge/harness";

export interface ReviewGate {
	rubric: Rubric;
	verifier: SantaVerifier;
}

export interface LoopConfig {
	prompt: string;
	exit: ExitConditionConfig;
	review?: ReviewGate;
	/** 默认 "continuous-pr/iter"。 */
	branchPrefix?: string;
	/** agentRunner.run 的 cwd(plan 补,spec §4.6 漏列)。 */
	cwd: string;
}

export interface LoopDeps {
	gitOps: GitOps;
	gate: Gate;
	agentRunner: AgentRunner;
	notes: SharedTaskNotes;
}

export interface IterationResult {
	iteration: number;
	branch: string;
	reply: string;
	cost: number;
	gatePassed: boolean;
	reviewVerdict?: "nice" | "naughty";
	merged: boolean;
	error?: string;
}

export interface LoopResult {
	iterations: IterationResult[];
	totalCost: number;
	totalRuns: number;
	stopReason: string;
	rollbackTag: string;
}

export class LoopRunner {
	constructor(
		private readonly config: LoopConfig,
		private readonly deps: LoopDeps,
	) {}

	async run(signal?: AbortSignal): Promise<LoopResult> {
		// 开始前断言(spec 🔴1:防污染 main + 记回滚点)。
		if (!(await this.deps.gitOps.isClean())) {
			throw new Error("working tree not clean; commit or stash before loop");
		}
		if ((await this.deps.gitOps.currentBranch()) !== "main") {
			throw new Error("loop must start on main branch");
		}
		// remote 同步断言 defer:GitOps 接口未提供方法,dry-run 无 remote 不触发;
		// future GitHub adapter 加 isMainSyncedOrNoRemote() 后补(spec §5 🟡5e)。
		const rollbackTag = `loop-rollback-${Date.now()}`;
		await this.deps.gitOps.tag(rollbackTag);

		const state: LoopState = {
			runs: 0,
			cost: 0,
			durationMs: 0,
			consecutiveCompletionSignals: 0,
			consecutiveGateFailures: 0,
		};
		const iterations: IterationResult[] = [];
		let stopReason = "";
		const branchPrefix = this.config.branchPrefix ?? "continuous-pr/iter";

		for (let iteration = 1; ; iteration++) {
			// abort 在循环顶部检(checkExit 纯函数不含 abort)。
			if (signal?.aborted) {
				stopReason = "aborted";
				break;
			}
			const exit = checkExit(state, this.config.exit);
			if (exit.stop) {
				stopReason = exit.reason;
				break;
			}

			const branch = `${branchPrefix}-${iteration}`;
			const iterResult: IterationResult = {
				iteration,
				branch,
				reply: "",
				cost: 0,
				gatePassed: false,
				merged: false,
			};
			const t0 = Date.now();
			let skipCommitMerge = false;

			try {
				await this.deps.gitOps.createBranch(branch);
				await this.deps.gitOps.checkout(branch);
				const notesContent = this.deps.notes.read();
				const { reply, cost } = await this.deps.agentRunner.run(
					buildPrompt(this.config.prompt, notesContent),
					{ cwd: this.config.cwd, signal },
				);
				iterResult.reply = reply;
				iterResult.cost = cost;

				// completion signal
				if (
					this.config.exit.completionSignal &&
					reply.includes(this.config.exit.completionSignal)
				) {
					state.consecutiveCompletionSignals++;
				} else {
					state.consecutiveCompletionSignals = 0;
				}

				// optional review gate(spec §4.7)
				if (this.config.review) {
					const diff = await this.deps.gitOps.diff();
					const output = reply + (diff ? `\n\n[diff]\n${diff}` : "");
					const reviewResult = await this.config.review.verifier.review(
						output,
						this.config.review.rubric,
					);
					iterResult.reviewVerdict = reviewResult.verdict;
					if (reviewResult.verdict === "naughty") {
						skipCommitMerge = true;
						this.deps.notes.write({
							iteration,
							replySummary: truncate(reply),
							gatePassed: false,
							merged: false,
							reviewVerdict: "naughty",
							reviewIssues: reviewResult.issues.map((i) => i.description),
						});
					}
				}

				if (!skipCommitMerge) {
					await this.deps.gitOps.commit(truncate(reply));
					const gateResult = await this.deps.gate.run();
					iterResult.gatePassed = gateResult.passed;
					if (gateResult.passed) {
						state.consecutiveGateFailures = 0;
						await this.deps.gitOps.checkout("main");
						const mergeResult = await this.deps.gitOps.merge(branch);
						if (mergeResult.ok) {
							try {
								await this.deps.gitOps.deleteBranch(branch);
							} catch {
								// non-fatal(spec 🟡5a):分支名带 iteration 不影响下轮
							}
							iterResult.merged = true;
							this.deps.notes.write({
								iteration,
								replySummary: truncate(reply),
								gatePassed: true,
								merged: true,
							});
						} else {
							iterResult.error = mergeResult.conflict;
							this.deps.notes.write({
								iteration,
								replySummary: truncate(reply),
								gatePassed: true,
								merged: false,
								error: mergeResult.conflict,
							});
						}
					} else {
						state.consecutiveGateFailures++;
						this.deps.notes.write({
							iteration,
							replySummary: truncate(reply),
							gatePassed: false,
							merged: false,
							gateOutput: gateResult.output,
						});
					}
				}
			} catch (err) {
				iterResult.error = err instanceof Error ? err.message : String(err);
				this.deps.notes.write({
					iteration,
					replySummary: "",
					merged: false,
					error: iterResult.error,
				});
			}

			// 回 main(为下轮 createBranch from main 准备;best-effort)。
			try {
				await this.deps.gitOps.checkout("main");
			} catch {
				// 可能已在 main 或 working tree 冲突;忽略,下轮 createBranch 会暴露。
			}

			state.runs++;
			state.cost += iterResult.cost;
			state.durationMs += Date.now() - t0;
			iterations.push(iterResult);
		}

		// 结束输出回滚提示(spec 🔴1)。
		console.log(`循环结束(${stopReason})。回滚点 tag: ${rollbackTag}`);
		console.log(`  如需恢复循环前 main 状态: git reset --hard ${rollbackTag}`);

		return {
			iterations,
			totalCost: state.cost,
			totalRuns: state.runs,
			stopReason,
			rollbackTag,
		};
	}
}

/** prompt + notes + 指令(anti-pattern 2:跨迭代 context 桥)。 */
function buildPrompt(prompt: string, notes: string): string {
	if (!notes) return prompt;
	return `${prompt}\n\n[Previous iterations notes]\n${notes}\n\n读上方 notes 了解之前迭代的进展与失败,在此基础上继续。产出后由编排器自动记录本轮进度。`;
}

function truncate(s: string, max = 200): string {
	return s.length > max ? s.slice(0, max) + "…" : s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/loop/loop-runner.test.ts`
Expected: PASS(9 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/loop/loop-runner.ts packages/cli/src/loop/loop-runner.test.ts
git commit -m "feat(loop): Slice 6 Task 6 LoopRunner(核心编排+try/catch+回滚 tag+9 场景 mock)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: LoopMode(argv 解析 + wiring)+ index.ts 路由

**Files:**
- Create: `packages/cli/src/loop/loop-mode.ts`
- Test: `packages/cli/src/loop/loop-mode.test.ts`
- Modify: `packages/cli/src/index.ts`(加 `loop` 子命令路由)

**Interfaces:**
- Consumes: `DryRunGitOps`(Task 3);`LocalBuildGate`(Task 4);`InProcessAgentRunner`(Task 5);`FileSharedTaskNotes`(Task 2);`LoopRunner` / `LoopConfig` / `LoopDeps` / `ReviewGate`(Task 6);`createSantaVerifier` / `Rubric`(`@agentforge/harness`)。
- Produces: `LoopModeOptions` / `ParsedLoopArgs` 类型 + `parseLoopArgs(argv)` 纯函数 + `runLoopMode(argv, opts)` 入口。`index.ts` 路由调用 `runLoopMode`。

**plan 对 spec 的澄清:**
- `LoopModeOptions` 加 `tools?` / `safety?` / `systemPrompt?`(spec §4.8 漏列,InProcessAgentRunner 构造需)。`tools` 由调用方(index.ts)注入,复用 cli 现有 tools 构造(见 `print-mode.ts`);loop-mode 本身不构造 tools。先用 `[]` 验骨架,自举验证再按需加 tools。
- `parseLoopArgs` 含 `--provider` / `--model`(覆盖 opts 默认)。
- `--gate-commands` 逗号分隔多命令(如 `"pnpm -r typecheck,pnpm -r test"`)。

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/loop/loop-mode.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-agent-core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parseLoopArgs, runLoopMode } from "./loop-mode.js";

function makeMockStreamFn(text: string) {
	return () => {
		const stream = new AssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "anthropic" as any,
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage: {
				input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		const startEvent: AssistantMessageEvent = { type: "start", partial: message };
		const doneEvent: AssistantMessageEvent = { type: "done", reason: "stop", message };
		queueMicrotask(() => {
			stream.push(startEvent);
			stream.push(doneEvent);
		});
		return stream;
	};
}

function makeTempRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "loopmode-"));
	execSync("git init -b main", { cwd: dir });
	execSync('git config user.email "t@t"', { cwd: dir });
	execSync('git config user.name "t"', { cwd: dir });
	writeFileSync(join(dir, "README.md"), "init");
	execSync("git add -A && git commit -m init", { cwd: dir });
	return dir;
}

describe("parseLoopArgs", () => {
	it("解析各 flag", () => {
		const r = parseLoopArgs(["--prompt", "do x", "--max-runs", "3", "--max-cost", "0.5", "--review"]);
		expect(r.prompt).toBe("do x");
		expect(r.maxRuns).toBe(3);
		expect(r.maxCost).toBe(0.5);
		expect(r.review).toBe(true);
	});

	it("--gate-commands 逗号分隔多命令", () => {
		const r = parseLoopArgs(["--gate-commands", "pnpm -r typecheck,pnpm -r test"]);
		expect(r.gateCommands).toEqual(["pnpm -r typecheck", "pnpm -r test"]);
	});

	it("--completion-signal + --completion-threshold", () => {
		const r = parseLoopArgs(["--completion-signal", "DONE", "--completion-threshold", "2"]);
		expect(r.completionSignal).toBe("DONE");
		expect(r.completionThreshold).toBe(2);
	});
});

describe("runLoopMode", () => {
	let dir: string;
	beforeEach(() => {
		dir = makeTempRepo();
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("集成:临时 repo + mock streamFn + --max-runs 1 → 1 轮 merge,stopReason max-runs", async () => {
		const result = await runLoopMode(
			["--prompt", "do x", "--max-runs", "1", "--gate-commands", 'node -e "process.exit(0)"'],
			{
				getApiKey: () => "k",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				cwd: dir,
				streamFn: makeMockStreamFn("done"),
			},
		);
		expect(result.totalRuns).toBe(1);
		expect(result.stopReason).toBe("max-runs");
		expect(result.iterations[0].merged).toBe(true);
	});

	it("无退出条件 → 默认 maxRuns=1", async () => {
		const result = await runLoopMode(
			["--prompt", "do x", "--gate-commands", 'node -e "process.exit(0)"'],
			{
				getApiKey: () => "k",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				cwd: dir,
				streamFn: makeMockStreamFn("done"),
			},
		);
		expect(result.stopReason).toBe("max-runs");
		expect(result.totalRuns).toBe(1);
	});

	it("缺 --prompt → throw", async () => {
		await expect(
			runLoopMode(["--max-runs", "1"], {
				getApiKey: () => "k",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				cwd: dir,
			}),
		).rejects.toThrow("requires --prompt");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/cli test -- src/loop/loop-mode.test.ts`
Expected: FAIL with "Cannot find module './loop-mode.js'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/loop/loop-mode.ts
/**
 * loop-mode:argv 解析 + 构造默认 LoopDeps + 接 santa + 跑 LoopRunner(spec §4.8)。
 *
 * runLoopMode(argv, opts):parseLoopArgs → 强制至少一个退出条件(默认 maxRuns=1,
 * 防 anti-pattern 1)→ 构造 DryRunGitOps/LocalBuildGate/InProcessAgentRunner/
 * FileSharedTaskNotes [+ createSantaVerifier if --review] → LoopRunner.run → 返 LoopResult。
 *
 * tools 由调用方(index.ts)注入,复用 cli 现有 tools 构造(见 print-mode.ts);
 * 默认 [](reply-only,验骨架)。safety 同理(默认不注入,ask 降级 deny)。
 */
import { join } from "node:path";
import { DryRunGitOps } from "./git-ops.js";
import { LocalBuildGate } from "./gate.js";
import { InProcessAgentRunner } from "./agent-runner.js";
import { FileSharedTaskNotes } from "./shared-task-notes.js";
import { LoopRunner } from "./loop-runner.js";
import type { ReviewGate } from "./loop-runner.js";
import type { ExitConditionConfig } from "./exit-condition.js";
import type { LoopResult } from "./loop-runner.js";
import { createSantaVerifier } from "@agentforge/harness";
import type { Rubric } from "@agentforge/harness";

export interface LoopModeOptions {
	prompt?: string;
	getApiKey: (provider: string) => string | Promise<string | undefined>;
	provider: string;
	model: string;
	cwd?: string;
	streamFn?: any;
	tools?: any[];
	safety?: any;
	systemPrompt?: string;
}

export interface ParsedLoopArgs {
	prompt?: string;
	maxRuns?: number;
	maxCost?: number;
	maxDurationMs?: number;
	completionSignal?: string;
	completionThreshold?: number;
	review?: boolean;
	gateCommands?: string[];
	provider?: string;
	model?: string;
}

export function parseLoopArgs(argv: string[]): ParsedLoopArgs {
	const r: ParsedLoopArgs = {};
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--prompt": r.prompt = argv[++i]; break;
			case "--max-runs": r.maxRuns = Number(argv[++i]); break;
			case "--max-cost": r.maxCost = Number(argv[++i]); break;
			case "--max-duration": r.maxDurationMs = Number(argv[++i]); break;
			case "--completion-signal": r.completionSignal = argv[++i]; break;
			case "--completion-threshold": r.completionThreshold = Number(argv[++i]); break;
			case "--review": r.review = true; break;
			case "--gate-commands": r.gateCommands = argv[++i]?.split(","); break;
			case "--provider": r.provider = argv[++i]; break;
			case "--model": r.model = argv[++i]; break;
		}
	}
	return r;
}

const DEFAULT_REVIEW_RUBRIC: Rubric = {
	criteria: [
		"改动符合 prompt 意图",
		"不破坏现有测试/类型",
		"无明显 slop(无用类型测试/过度防御)",
	],
};

export async function runLoopMode(argv: string[], opts: LoopModeOptions): Promise<LoopResult> {
	const parsed = parseLoopArgs(argv);
	const cwd = opts.cwd ?? process.cwd();
	const prompt = parsed.prompt ?? opts.prompt;
	if (!prompt) throw new Error("loop mode requires --prompt");

	const provider = parsed.provider ?? opts.provider;
	const model = parsed.model ?? opts.model;

	const exit: ExitConditionConfig = {
		maxRuns: parsed.maxRuns,
		maxCost: parsed.maxCost,
		maxDurationMs: parsed.maxDurationMs,
		completionSignal: parsed.completionSignal,
		completionThreshold: parsed.completionThreshold,
	};
	// 强制至少一个退出条件(默认 maxRuns=1,防 anti-pattern 1)。
	const hasExit =
		exit.maxRuns != null ||
		exit.maxCost != null ||
		exit.maxDurationMs != null ||
		exit.completionSignal != null;
	if (!hasExit) exit.maxRuns = 1;

	const gitOps = new DryRunGitOps({ cwd });
	const gate = new LocalBuildGate({ cwd, commands: parsed.gateCommands });
	const agentRunner = new InProcessAgentRunner({
		provider,
		model,
		getApiKey: opts.getApiKey,
		tools: opts.tools ?? [],
		systemPrompt: opts.systemPrompt ?? "",
		streamFn: opts.streamFn,
		safety: opts.safety,
		cwd,
	});
	const notes = new FileSharedTaskNotes({ dir: join(cwd, ".agentforge", "loop") });

	let review: ReviewGate | undefined;
	if (parsed.review) {
		const verifier = createSantaVerifier({
			provider,
			model,
			getApiKey: opts.getApiKey,
			streamFn: opts.streamFn,
			cwd,
		});
		review = { rubric: DEFAULT_REVIEW_RUBRIC, verifier };
	}

	const runner = new LoopRunner({ prompt, exit, review, cwd }, { gitOps, gate, agentRunner, notes });
	return runner.run();
}
```

- [ ] **Step 4: Modify index.ts(加 loop 子命令路由)**

在 `packages/cli/src/index.ts` 的 `main()` 中,`const getApiKey = getApiKeyFromEnv;` 之后、`if (hasPrintFlag)` 之前插入:

```ts
	// loop 子命令(优先于 -p/--rpc flag):agentforge loop --prompt ... --max-runs ...
	// spec D5:子命令清晰,未来 agentforge rfc-dag 同构。
	const hasLoopSubcommand = argv[0] === "loop";
	if (hasLoopSubcommand) {
		const { runLoopMode } = await import("./loop/loop-mode.js");
		await runLoopMode(argv.slice(1), {
			getApiKey,
			provider: "deepseek",
			model: "deepseek-chat",
		});
		return;
	}
```

> 注:`provider` / `model` 默认 deepseek(agentforge 默认,见 env-config.ts);用户可经 `--provider` / `--model` 覆盖。`tools` 默认 `[]`(reply-only);自举验证(Task 8)需 agent 真改文件时,在此传入复用 cli tools 构造的 tools(见 `print-mode.ts`)。

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @agentforge/cli test -- src/loop/loop-mode.test.ts`
Expected: PASS(6 tests)。

- [ ] **Step 6: Run full cli typecheck + test(回归)**

Run: `pnpm --filter @agentforge/cli typecheck && pnpm --filter @agentforge/cli test`
Expected: typecheck 0 error;全部 cli 测试 PASS(含新 loop/ 7 文件 + 原有 cli 测试;harness/shared/eval 不受影响,395 基线不动)。

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/loop/loop-mode.ts packages/cli/src/loop/loop-mode.test.ts packages/cli/src/index.ts
git commit -m "feat(loop): Slice 6 Task 7 LoopMode(argv 解析+wiring+--review santa)+index.ts 路由

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: 真对话自举验证(手动,非自动化)

**Files:** 无新文件(spec §7「真对话自举验证」)

这是 spec §7 的手动验证步骤——在 agentforge 自身上跑完整循环,验证循环编排骨架 + SHARED_TASK_NOTES 桥 + 退出条件。**不写自动化测试**(真 LLM 调用,非确定性)。

- [ ] **Step 1: 构造一个有 API key 的终端,跑自举**

在 agentforge repo(pi 分支,working tree 干净)跑:

```bash
# 先验骨架(reply-only,tools=[]):agent 不改文件,但走完整 branch→commit→gate→merge→notes
DEEPSEEK_API_KEY=<key> pnpm --filter @agentforge/cli exec agentforge loop \
  --prompt "报告 packages/harness/src/adr.ts 的导出列表,reply 中含 DONE" \
  --max-runs 2 \
  --completion-signal DONE \
  --gate-commands 'node -e "process.exit(0)"'
```

Expected:
- 控制台输出每轮 iteration 摘要
- `循环结束(...)。回滚点 tag: loop-rollback-<ts>` + `git reset --hard` 提示
- `.agentforge/loop/SHARED_TASK_NOTES.md` 含 `## Iteration 1` / `## Iteration 2` 段
- `git log --oneline` 见 iter 分支 merge 回 main 的 commit(或 reply-only 无改动则无新 commit,但 merge "Already up to date" 不报错)

- [ ] **Step 2: 验证 SHARED_TASK_NOTES 跨迭代桥**

检查 `.agentforge/loop/SHARED_TASK_NOTES.md` 含两轮 Progress 段;第 2 轮 agent reply 应体现见过第 1 轮 notes(若 prompt 引导)。

- [ ] **Step 3: 验证回滚 tag**

```bash
git tag -l "loop-rollback-*"   # 见循环前打的 tag
git reset --hard loop-rollback-<ts>   # 验证可恢复循环前 main 状态(可选,验后 reset 回 pi)
```

- [ ] **Step 4: 验证 gate 失败保护**

```bash
# gate 故意失败 → 不 merge,notes 写 gateOutput,下轮
DEEPSEEK_API_KEY=<key> pnpm --filter @agentforge/cli exec agentforge loop \
  --prompt "reply anything" \
  --max-runs 2 \
  --gate-commands 'node -e "process.exit(1)"'
```

Expected:每轮 `gatePassed=false`,`gitOps.merge` 未调用(检查 `git log` 无 iter commit 进 main),`SHARED_TASK_NOTES.md` 含 `Gate: failed` + gateOutput。

- [ ] **Step 5: (可选)带 tools 的真改动验证**

若 Step 1 的 reply-only 骨架通过,后续可加 tools(复用 `print-mode.ts` 的 tools 构造,传入 `runLoopMode` 的 opts.tools 或 index.ts 路由),prompt 改为「给 `packages/harness/src/adr.ts` 补一个边界测试」,`--gate-commands "pnpm --filter @agentforge/harness test"`,验 agent 真改文件 → commit → gate(test pass)→ merge → main 上见新测试。**此步需先补 tools 注入,留作后续完善**(本 plan 范围:骨架验证)。

- [ ] **Step 6: 记录自举结果**

在 commit message 或 PR 描述记自举验证结果(通过/失败 + SHARED_TASK_NOTES 截图摘录)。无需 commit 代码(本 task 无代码变更)。

---

## Self-Review

**1. Spec coverage**(spec 各节 → task):
- §4.1 GitOps → Task 3 ✅
- §4.2 Gate → Task 4 ✅
- §4.3 AgentRunner → Task 5 ✅(D13 不注入 instinct/auditor/verifier/compactor 实现)
- §4.4 SharedTaskNotes → Task 2 ✅(maxEntries 截断)
- §4.5 ExitCondition → Task 1 ✅(五条件 + consecutiveGateFailures)
- §4.6 LoopRunner → Task 6 ✅(try/catch + 回滚 tag + signal)
- §4.7 review gate → Task 6(实现)+ Task 7(wiring)✅
- §4.8 loop-mode + index.ts → Task 7 ✅
- §5 数据流 → Task 6 实现 ✅
- §6 错误处理 → Task 6 try/catch + 各分支 ✅
- §7 测试策略 → Task 1-7 测试 + Task 8 自举 ✅
- D1-D13 → 各 task 实现 ✅(D11 harness 零改动:Task 1-7 全落 cli/src/loop/ + index.ts,不改 harness/shared/eval)
- red-team 🔴1 回滚 tag → Task 6 ✅;🔴2 不注入 instinct/auditor → Task 5 D13 ✅;🟡3 连败退出 → Task 1 ✅;🟡5 各盲点 → Task 2/3/6 ✅

**2. Placeholder scan**:无 TBD/TODO;"复用 cli tools 构造(见 print-mode.ts)"是给执行者的具体文件指引(非 placeholder,执行者读 print-mode.ts 实现);Task 8 Step 5 明确标注"留作后续完善"且属可选范围外。

**3. Type consistency**:
- `checkExit` / `LoopState` / `ExitConditionConfig`(Task 1)→ Task 6 import 一致 ✅
- `GitOps`(Task 3)→ Task 6 `LoopDeps.gitOps: GitOps` 一致 ✅
- `AgentRunner.run(prompt, {cwd, signal})`(Task 5)→ Task 6 调用一致 ✅
- `SharedTaskNotes.read()/write(IterationProgress)`(Task 2)→ Task 6 调用一致 ✅(IterationProgress 字段)
- `LoopConfig.cwd`(Task 6 plan 补)→ Task 7 构造传 cwd 一致 ✅
- `ReviewGate {rubric, verifier}`(Task 6)→ Task 7 构造一致 ✅
- `LoopResult.rollbackTag`(Task 6)→ Task 7 返回一致 ✅

**4. 已知 limitation(plan 诚实标注)**:
- remote 同步断言 defer(GitOps 接口未提供方法,dry-run 无 remote 不触发;Task 6 注明)
- gate 独立性:dry-run 跑 agent 改过的 test(spec §1 根因,非 plan bug)
- tools 注入:默认 [](reply-only),真改动验证留 Task 8 Step 5 后续

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-26-slice6-continuous-pr.md`. Two execution options:

**1. Subagent-Driven(推荐)** — 我 dispatch fresh subagent per task,task 间 review,快速迭代。Slice 6 有 8 task,Task 1-7 各自独立可测,适合逐 task 派发 + 两阶段 review。Task 8 自举验证我手动跑(真 LLM)。

**2. Inline Execution** — 在本 session 用 executing-plans 批量执行 + checkpoint review。

Which approach?

> **注(AGENTS.md)**:分支 `pi`,commit message 末尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`,仅在用户要求时 commit/push。本 plan 各 Task 的 commit step 是 TDD 频繁提交;执行时按 step commit,但**不 push**(pi 无 remote)。
