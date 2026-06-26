# Slice 6:continuous-PR 循环模式设计

- **Date**: 2026-06-26
- **Slice**: 6(ARCH §8 Slice 6 循环模式——本 slice 只做 continuous-PR,RFC-DAG 留后续)
- **Status**: Design v2(red-team Oracle 审已吸收 2🔴Blocking + 3🟡Important + 1⚪Advisory + 2 根因洞察,待 plan)
- **依据**: ARCH §8 Slice 6 / §6 映射表(`continuous-agent-loop` → cli 工作流);compendium 循环模式谱系模式 4「Continuous Claude PR Loop」(research/ecc-agent-architecture-compendium.md §4,行 1451-1554)+ §「Anti-Patterns」(行 1824-1840)
- **前置**: Slice 0-5/7 完成(395 测试绿,4 包 shared/harness/cli/eval typecheck+build 过);cli 三模式 print/repl/rpc(index.ts flag-based 路由);harness 10 模块全建(含 Verification `SantaVerifier` / Audit / Instinct);eval `runTask` 已验证 per-iteration cost 从 `harness.agent.state.messages` 最后 AssistantMessage `usage.cost.total` 取
- **决策来源**: brainstorming 2026-06-26(7 项决策:范围/目标-git/agent 形态/方案/CLI/review/worktree-resumable)

---

## 1. 背景与动机

ARCH §8 Slice 6 = 循环模式(continuous-PR + RFC-DAG)。两者在 compendium 循环模式谱系里是独立模式,复杂度差距大:

- **continuous-PR**(模式 4,Medium):单 agent 迭代循环——分支→跑→commit→PR→等 CI→修→merge→回 main,核心创新是 `SHARED_TASK_NOTES.md` 跨迭代上下文桥,退出条件 max-runs/cost/duration/completion-signal。
- **RFC-DAG**(模式 6,High):RFC→AI 分解依赖 DAG→分层质量管线→merge queue with eviction→SQLite resumable。

本 slice 做 **continuous-PR**(先链路后能力,YAGNI),RFC-DAG 留后续独立 slice。compendium 原文用 `claude -p`(外部子进程,每迭代 fresh context);agentforge 落地为 **in-process per 迭代**(新 `AgentForgeHarness` 实例 + SHARED_TASK_NOTES 文件桥 + try/catch 兜底,复用 ADR-0001b in-process 传统)。

**自举 dry-run**:agentforge 仓库本身无 remote,gh PR 需真 GitHub repo+CI。本 slice 在 agentforge 自身上验证循环链路:不 push/PR,改用本地 branch+commit+`LocalBuildGate`(`pnpm -r typecheck`+`test`)替代 CI,merge 回 main 在本地。git/CI 操作抽象为接口,留真 GitHub adapter 位。

**harness 零改动**:本 slice 全部新代码落 `packages/cli/src/loop/`,不改 harness/shared/eval(`InProcessAgentRunner` 用现有 `new AgentForgeHarness`,`--review` 用现有 `SantaVerifier.review`),不碰已绿的 395 测试,风险隔离。

**两个根因局限**(red-team 指出,诚实标注):
- **自举验证的是循环编排骨架,非 continuous-PR 完整模式**:dry-run 不覆盖 PR 评审/CI 等待/远程 merge 冲突/rebase 等 continuous-PR 核心张力。本 slice 验证的是「分支→agent→commit→gate→merge→notes」循环编排骨架 + SHARED_TASK_NOTES 桥 + 退出条件;真 continuous-PR 模式验证留 GitHub 支持后。
- **gate 独立性**:`LocalBuildGate` 跑的是 agent 改过的 test(agent 既是运动员又是裁判),dry-run 非独立验证。真 GitHub loop 有远程 CI(独立环境)+ PR review 双重独立验证;dry-run 两者皆无,只有 `--review` santa 独立 reviewer 部分弥补。

## 2. 范围

**纳入**:
- `LoopRunner`(纯逻辑编排 + 退出条件 + 错误兜底)
- `GitOps` 接口 + `DryRunGitOps`(本地真 git exec)实现
- `Gate` 接口 + `LocalBuildGate`(`pnpm -r typecheck`+`test`)实现
- `AgentRunner` 接口 + `InProcessAgentRunner`(new harness per 迭代)实现
- `SharedTaskNotes`(`SHARED_TASK_NOTES.md` 读写,放 `.agentforge/loop/`)
- `ExitCondition`(maxRuns/cost/duration/completionSignal)
- 可选 `--review` gate(复用 `SantaVerifier.review`)
- CLI 子命令 `agentforge loop` + `index.ts` 路由
- `LoopResult`/`IterationResult` 类型(cli 内部,不动 shared)

**defer**(YAGNI,留后续 slice):
- RFC-DAG(DAG 分解/分层质量管线/merge queue eviction/SQLite resumable)
- 真 GitHub PR/CI(`GitHubGitOps`/`CiGate` adapter——本 slice 留接口位不实现)
- 子进程 `--isolate`(in-process 先打通,需强隔离时再加)
- `--worktree` 并行隔离(本 slice 主 repo 切分支串行;worktree 并行留 RFC-DAG)
- SQLite resumable(continuous-PR 靠 SHARED_TASK_NOTES 文件桥;SQLite 是 RFC-DAG 特性)
- `ci-retry-max` auto-fix pass(gate 失败记 notes 喂下轮,不自动重试——anti-pattern 3)
- 循环事件 emit(LoopRunner 只返 `LoopResult` + console 输出,不 emit harness 事件;事件化留后续)
- `--disable-commits` dry-run 开关(DryRunGitOps 本身不 push,本地 commit/merge 真做以验证链路;纯无 git 开关留后续)

## 3. 核心决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 范围 = continuous-PR only,RFC-DAG 留后续 | Medium vs High;先链路后能力(ARCH §1);单 spec 可控;RFC-DAG 的 merge queue/rebase/CI 概念在 continuous-PR 简化成型 |
| D2 | 自举 dry-run + 本地 gate + gitOps 抽象(留 GitHub adapter) | agentforge 无 remote,gh PR 需真 GitHub;本地 gate 复用 build/test;gitOps 接口留 GitHub adapter 不锁死;可立即自举验证 |
| D3 | in-process per 迭代(new harness + SHARED_TASK_NOTES 桥 + try/catch) | ADR-0001b in-process 传统;可测(mock streamFn 沿用 Slice 3/eval);fresh context 靠新实例 + 文件桥(不依赖进程隔离);单 agent 串行无并行隔离需求;低成本无进程重启 |
| D4 | 分层抽象(LoopRunner + GitOps/Gate/AgentRunner 接口注入) | 本 slice 难点是循环+git 的 TDD,分层注入每层可 mock;各层独立可换真 GitHub;复用 santa/eval 不硬套;符合 ARCH §1/§4 模块化 |
| D5 | CLI = 子命令 `agentforge loop` | loop 多 flag,子命令清晰;未来 `agentforge rfc-dag` 同构;index.ts 检测 `argv[0]==="loop"` 路由(子命令优先于 -p/--rpc flag) |
| D6 | review gate = 可选 `--review` 复用 `SantaVerifier.review` | 复用 Slice 3 模块;默认 off;rubric 评审 reply+diff;naughty 记 issue 不 merge |
| D7 | worktree = 主 repo 切分支串行(不做 --worktree 并行) | YAGNI;continuous-PR 串行单 agent,主 repo 切 `continuous-pr/iter-N` 分支跑→merge 回 main;worktree 并行留 RFC-DAG |
| D8 | resumable = SHARED_TASK_NOTES 文件桥,不做 SQLite | continuous-PR 靠文件桥跨迭代;SQLite resumable 是 RFC-DAG 特性;中断后重跑靠 notes 保留进度 |
| D9 | 退出条件 = maxRuns / maxCost / maxDuration / completionSignal(threshold) | anti-pattern 1(无退出条件无限循环);四条件任一命中即停,`LoopResult.stopReason` 记原因 |
| D10 | 错误兜底 = 迭代 try/catch + error context 进 notes 喂下轮 | anti-pattern 3(不盲目 retry 同一失败);捕获 error 写 notes,下轮 agent 可见上轮失败可修 |
| D11 | harness 零改动,全落 cli/src/loop/ | InProcessAgentRunner 用现有 `new AgentForgeHarness`,review 用现有 SantaVerifier;不碰 395 测试,风险隔离 |
| D12 | SHARED_TASK_NOTES 放 `.agentforge/loop/`(非 repo 根) | 避免污染 repo working tree + 不被 git 追踪(agentforge 已用 `.agentforge/sessions/`);agent 读写该路径 |
| D13 | InProcessAgentRunner 不注入 instinct/auditor/verifier/compactor | red-team 🔴2:这三者跨迭代共享进程级状态(instinct store 订阅 events 写 observations、auditor 累积)破坏 fresh context;循环迭代要纯 fresh;review 用独立 SantaVerifier 不经 harness.verify;compactor 单迭代单 prompt 通常不超窗 |

## 4. 组件设计

### 4.1 GitOps 接口(`packages/cli/src/loop/git-ops.ts`)

```ts
export interface MergeResult {
  ok: boolean;
  conflict?: string;   // 冲突时附 git merge 冲突信息
}

export interface GitOps {
  createBranch(name: string): Promise<void>;
  checkout(name: string): Promise<void>;
  /** 有 staged/unstaged changes 才 commit。返回是否实际 commit。 */
  commit(message: string): Promise<boolean>;
  /** merge 指定分支到当前分支(main)。冲突 → { ok:false, conflict }。 */
  merge(branch: string): Promise<MergeResult>;
  currentBranch(): Promise<string>;
  hasChanges(): Promise<boolean>;
  deleteBranch(name: string): Promise<void>;
  /** 未 commit 改动的 diff(供 review gate 评审代码改动)。 */
  diff(): Promise<string>;
  /** 打 tag(循环开始前记回滚点,red-team 🔴1)。 */
  tag(name: string): Promise<void>;
  /** working tree 是否干净(无未提交改动)——循环开始前检查。 */
  isClean(): Promise<boolean>;
}

/**
 * DryRunGitOps:本地真 git exec(git branch/checkout/add/commit/merge),
 * 不 push/PR/建 PR。构造注入 { cwd }。
 * 用 node:child_process exec,跨平台 git 命令。失败 throw(含 stderr)。
 */
export class DryRunGitOps implements GitOps { /* ... */ }
```

本 slice 只实现 DryRunGitOps。未来若需 GitHub 支持:因 PR 模型(push/createPR/waitCI/mergePR)与本地 checkout-merge 序列不兼容,将重新设计接口,不复用 GitOps(red-team 🟡4)。

### 4.2 Gate 接口(`packages/cli/src/loop/gate.ts`)

```ts
export interface GateResult {
  passed: boolean;
  output: string;   // 合并 stdout+stderr(失败时含错误)
}

export interface Gate {
  run(): Promise<GateResult>;
}

/**
 * LocalBuildGate:依次 exec commands,任一非 0 退出 → passed=false。
 * 默认 commands = ["pnpm -r typecheck", "pnpm -r test"](可配)。
 * 构造注入 { cwd, commands? }。
 */
export class LocalBuildGate implements Gate { /* ... */ }
```

本 slice 只实现 LocalBuildGate。未来若需 CI 支持(`gh pr checks`)重新评估接口(red-team 🟡4)。

### 4.3 AgentRunner 接口(`packages/cli/src/loop/agent-runner.ts`)

```ts
export interface AgentRunResult {
  reply: string;
  cost: number;       // last AssistantMessage.usage.cost.total
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

/**
 * InProcessAgentRunner:每次 run 构造 fresh AgentForgeHarness(in-process,
 * ADR-0001b),注入 safety(不传 askHandler → ask 降级 deny,同 rpc)。
 * **不注入** instinct/auditor/verifier(red-team 🔴2):这三者跨迭代共享进程级
 * 状态(instinct store 订阅 events 写 observations、auditor 累积),会破坏
 * fresh context;循环迭代要纯 fresh。review gate 用独立 SantaVerifier 实例
 * (不经 harness.verify)。compactor 默认亦不注入(单迭代单 prompt 通常不超窗)。
 * 借鉴 eval runTask 但改进(red-team ⚪6):cost = sum 所有 AssistantMessage
 * usage.cost.total(不只 last,覆盖迭代内多轮工具调用中间成本);reply = 最后
 * AssistantMessage content TextContent join。
 * 构造注入 { provider, model, getApiKey, tools, systemPrompt, streamFn?,
 *   safety?, cwd? }。
 */
export class InProcessAgentRunner implements AgentRunner { /* ... */ }
```

### 4.4 SharedTaskNotes(`packages/cli/src/loop/shared-task-notes.ts`)

```ts
export interface IterationProgress {
  iteration: number;
  replySummary: string;     // agent reply 摘要(首行/前 N 字符)
  gatePassed: boolean;
  gateOutput?: string;      // gate 失败时的输出
  reviewVerdict?: "nice" | "naughty";
  reviewIssues?: string[];
  merged: boolean;
  error?: string;           // 迭代崩溃/merge 冲突
  nextSteps?: string;
}

export interface SharedTaskNotes {
  /** 读 SHARED_TASK_NOTES.md(首次/不存在 → "")。 */
  read(): string;
  /** 追加一条 Progress + Next Steps 段(anti-pattern 2:跨迭代 context 桥)。 */
  write(progress: IterationProgress): void;
}

/**
 * FileSharedTaskNotes:读写 .agentforge/loop/SHARED_TASK_NOTES.md。
 * 构造注入 { dir }(默认 <cwd>/.agentforge/loop),{ maxEntries? }(默认 20)。
 * read 注入 agent prompt;write 编排器在迭代末尾调。
 * **截断轮转**(red-team 🟡5b):write 追加后若 Progress 段超 maxEntries,
 * 保留最近 maxEntries 条(删最旧),防 notes 无界增长撑爆 agent prompt。
 */
export class FileSharedTaskNotes implements SharedTaskNotes { /* ... */ }
```

### 4.5 ExitCondition(`packages/cli/src/loop/exit-condition.ts`)

```ts
export interface LoopState {
  runs: number;
  cost: number;
  durationMs: number;
  consecutiveCompletionSignals: number;
  consecutiveGateFailures: number;   // red-team 🟡3:连败计数
}

export interface ExitConditionConfig {
  maxRuns?: number;
  maxCost?: number;
  maxDurationMs?: number;
  completionSignal?: string;
  completionThreshold?: number;   // 默认 1
  maxConsecutiveGateFailures?: number;   // 默认 3(red-team 🟡3:连败提前停防 cost 失控)
}

export interface ExitDecision {
  stop: boolean;
  reason: string;   // "max-runs" / "max-cost" / "max-duration" / "completion-signal" / "max-consecutive-gate-failures" / "aborted" / ""
}

/** 纯函数:五条件任一命中 → stop。无任何条件 → 永不停(调用方应至少配 maxRuns)。 */
export function checkExit(state: LoopState, config: ExitConditionConfig): ExitDecision;
```

### 4.6 LoopRunner(`packages/cli/src/loop/loop-runner.ts`)

```ts
export interface ReviewGate {
  rubric: Rubric;
  verifier: SantaVerifier;
}

export interface LoopConfig {
  prompt: string;
  exit: ExitConditionConfig;
  review?: ReviewGate;        // --review
  branchPrefix?: string;      // 默认 "continuous-pr/iter"
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
  rollbackTag: string;   // red-team 🔴1:循环前 main 回滚点 tag
}

/**
 * LoopRunner:驱动迭代循环。每迭代:branch→agent→(review?)→commit→gate→merge?
 * →notes→exitCheck。迭代级 try/catch 兜底(D10),error 进 notes 喂下轮。
 * signal 透传 agentRunner(harness.prompt(signal)→agent.abort)。
 */
export class LoopRunner {
  constructor(config: LoopConfig, deps: LoopDeps);
  async run(signal?: AbortSignal): Promise<LoopResult>;
}
```

### 4.7 review gate(复用 SantaVerifier)

`--review` 时 `LoopConfig.review = { rubric, verifier: createSantaVerifier(deps) }`。每迭代 agent 产出后:
- `output` = agent reply 为主 + `gitOps.diff()` 辅助(未 commit 改动,超长截断;**diff 空(如 agent 内部自 commit)时退化 reply-only**,red-team 🟡5d)
- `reviewResult = await verifier.review(output, rubric)`
- `verdict === "nice"` → 继续 commit→gate→merge;`naughty` → 记 `issues` 进 notes,跳过 commit/merge,下轮

默认 rubric(可配):「改动符合 prompt 意图;不破坏现有测试/类型;无明显 slop(无用类型测试/过度防御)」。

### 4.8 CLI loop-mode(`packages/cli/src/loop/loop-mode.ts`)+ index.ts 路由

```ts
export interface LoopModeOptions {
  prompt: string;
  maxRuns?: number;
  maxCost?: number;
  maxDurationMs?: number;
  completionSignal?: string;
  completionThreshold?: number;
  review?: boolean;
  gateCommands?: string[];
  getApiKey: (provider: string) => string | Promise<string | undefined>;
  provider: string;
  model: string;
  cwd?: string;
  streamFn?: any;   // 测试注入
}

/** 解析 argv(--prompt/--max-runs/...)→ 构造 LoopConfig + LoopDeps
 *  (DryRunGitOps/LocalBuildGate/InProcessAgentRunner/FileSharedTaskNotes
 *  [+ createSantaVerifier if --review])→ LoopRunner.run → 输出 LoopResult 摘要。 */
export async function runLoopMode(argv: string[], opts: LoopModeOptions): Promise<LoopResult>;
```

`index.ts` 路由(子命令优先):

```ts
const hasLoopSubcommand = argv[0] === "loop";
if (hasLoopSubcommand) {
  await runLoopMode(argv.slice(1), { getApiKey });
  return;
}
// ...原有 print/rpc/repl flag 检测
```

## 5. 数据流(一次迭代)

```
LoopRunner.run:
  开始前:
    assert gitOps.isClean()(working tree 干净,防污染)
    assert gitOps.currentBranch() === "main"(在 main 上)
    assert main 与 origin/main 一致或无 remote(red-team 🟡5e:防未 push commit 卷入 iter 分支)
    rollbackTag = `loop-rollback-${Date.now()}`
    await gitOps.tag(rollbackTag)   // red-team 🔴1:记回滚点
  state = { runs:0, cost:0, durationMs:0, consecutiveCompletionSignals:0, consecutiveGateFailures:0 }
  for iteration = 1; ; iteration++:
    exit = checkExit(state, config.exit)
    if exit.stop: break with stopReason
    branch = `${branchPrefix}-${iteration}`
    iterResult = { iteration, branch, reply:"", cost:0, gatePassed:false, merged:false }
    try:
      await gitOps.createBranch(branch); await gitOps.checkout(branch)
      notesContent = notes.read()
      fullPrompt = buildPrompt(config.prompt, notesContent)   // prompt + notes + 指令(读 notes、产出后由编排器写)
      t0 = now
      { reply, cost } = await agentRunner.run(fullPrompt, { cwd, signal })
      iterResult.reply = reply; iterResult.cost = cost
      // completion signal
      if config.exit.completionSignal && reply.includes(config.exit.completionSignal):
        state.consecutiveCompletionSignals++
      else: state.consecutiveCompletionSignals = 0
      // optional review gate
      if config.review:
        output = reply + (await gitOps.diff())   // 未 commit 改动全文(超长截断)
        reviewResult = await config.review.verifier.review(output, config.review.rubric)
        iterResult.reviewVerdict = reviewResult.verdict
        if reviewResult.verdict === "naughty":
          notes.write({ iteration, replySummary, reviewVerdict:"naughty",
                        reviewIssues: reviewResult.issues, merged:false })
          continue   // 不 commit/merge,下轮
      // commit(有 changes 才;无 changes 返 false,仍继续 gate 验证现状)
      await gitOps.commit(replySummary)
      // gate
      { passed, output: gateOutput } = await gate.run()
      iterResult.gatePassed = passed
      if passed:
        state.consecutiveGateFailures = 0   // red-team 🟡3:pass 重置
        await gitOps.checkout("main")
        mergeResult = await gitOps.merge(branch)
        if mergeResult.ok:
          try { await gitOps.deleteBranch(branch) }   // red-team 🟡5a:失败 non-fatal
          catch (e) { /* 记 warning,分支名带 iteration 不影响下轮 */ }
          iterResult.merged = true
        else:
          iterResult.error = mergeResult.conflict
          notes.write({ iteration, replySummary, gatePassed:true, merged:false,
                        error: mergeResult.conflict })
      else:
        state.consecutiveGateFailures++   // red-team 🟡3:连败计数
        notes.write({ iteration, replySummary, gatePassed:false,
                      gateOutput, merged:false })
    catch err:
      iterResult.error = err.message
      notes.write({ iteration, replySummary:"", merged:false, error: err.message })
    state.runs++; state.cost += iterResult.cost; state.durationMs += (now - t0)
    iterations.push(iterResult)
  // red-team 🔴1:任何 stopReason 结束,输出回滚 tag + 恢复提示
  console.log(`循环结束(${exit.reason})。回滚点 tag: ${rollbackTag}`)
  console.log(`  如需恢复循环前 main 状态: git reset --hard ${rollbackTag}`)
  return { iterations, totalCost: state.cost, totalRuns: state.runs, stopReason: exit.reason, rollbackTag }
```

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| 迭代崩溃(agent throw) | try/catch 记 `iterResult.error` + `notes.write({error})`,继续下轮(不 commit/merge);error context 喂下轮(anti-pattern 3) |
| gate 失败 | 不 merge,`gateOutput` 进 notes,下轮 agent 可见「上轮 test 挂 X」可修 |
| merge 冲突 | `mergeResult.ok=false` + `conflict` 进 notes + `iterResult.error`,不 merge,分支保留,下轮 |
| cost/duration 超限 | `checkExit` 停,`stopReason="max-cost"`/`"max-duration"` |
| maxRuns 达到 | `stopReason="max-runs"` |
| completion signal | reply 含 magic phrase → `consecutiveCompletionSignals++` → 达 `completionThreshold` 停(`stopReason="completion-signal"`) |
| Ctrl-C / abort | `signal` 透传 `agentRunner`→`harness.prompt(signal)`→`agent.abort`;`checkExit` 亦检 `signal.aborted`→`stopReason="aborted"` |
| Safety ask | 循环 agent 注入 safety 不传 askHandler → ask 降级 deny(`safety:ask-no-handler`,同 rpc);agent 收到 block 换允许工具 |
| working tree 不干净 | 循环开始前 `isClean()` assert 失败 → throw,不开始(防污染 main) |
| 无任何退出条件 | `checkExit` 永不停——`runLoopMode` 强制至少一个退出条件,默认 `maxRuns=1`(用户应显式 `--max-runs` 覆盖),避免 anti-pattern 1 |
| main 与 origin/main 不一致(有 remote) | 循环前断言失败 → throw,不开始(防未 push commit 卷入 iter 分支,red-team 🟡5e) |
| 连续 gate 失败 | `consecutiveGateFailures` 达 `maxConsecutiveGateFailures`(默认 3)→ 停,`stopReason="max-consecutive-gate-failures"`(red-team 🟡3) |
| deleteBranch 失败 | non-fatal,记 warning;分支名带 iteration 不影响下轮 createBranch(red-team 🟡5a) |
| 循环运行时用户操作同 repo | inherent 竞态(isClean t0 检查后 t1 checkout 有窗口);文档化警告:循环运行时勿在另一工具操作同 repo(red-team 🟡5c) |
| 循环结束(任何 stopReason) | 输出回滚 tag + `git reset --hard <tag>` 恢复提示(red-team 🔴1) |

## 7. 测试策略(TDD)

- **loop-runner.test.ts**(核心,全 mock):mock GitOps/Gate/AgentRunner/SharedTaskNotes,测:
  - 正常 1 轮:pass→merge→maxRuns=1 停
  - gate 失败:不 merge,notes 写 gateOutput,下轮
  - 迭代崩溃:try/catch 记 error,继续下轮
  - completion signal:reply 含 phrase→threshold 停
  - maxCost/maxDuration 停
  - review naughty:不 commit/merge,notes 写 issues
  - review nice:commit→gate→merge
  - merge 冲突:不 merge,notes 写 conflict
  - abort:signal 透传 + 停
  - isClean 失败:throw 不开始
- **git-ops.test.ts**:临时 git repo(`mkdtemp`+`git init`)测 DryRunGitOps 真 createBranch/commit/merge/冲突/hasChanges/isClean
- **gate.test.ts**:临时 repo 写 pass/fail 脚本测 LocalBuildGate(commands 退出码→passed)
- **agent-runner.test.ts**:mock streamFn 测 InProcessAgentRunner harness 构造 + reply/usage/cost 提取(沿用 eval runTask 测试法)
- **shared-task-notes.test.ts**:tmpdir 测 read(空/有内容)/write(追加)
- **exit-condition.test.ts**:纯函数测 maxRuns/cost/duration/completionSignal 各阈值 + 无条件永不停
- **loop-mode.test.ts**:argv 解析 + wiring(构造各默认实现)+ --review 接 santa
- **真对话自举验证**:agentforge 自身,prompt 如「给 packages/harness/src/adr.ts 补一个边界测试」,max-runs 2-3,dry-run 跑通完整循环(branch→agent→commit→gate→merge→notes),验证 SHARED_TASK_NOTES 跨迭代 + 退出条件
- **回归**:395 → +N(全在 cli/loop,不动 harness/shared/eval)

## 8. 陷阱

- vitest development condition vs tsc dist:本 slice 主要改 cli(新 loop/ 目录),cli 内部类型不跨包;但 index.ts 路由改后需 cli typecheck+build。若 InProcessAgentRunner 复用 harness export 不需改 harness dist
- GateGuard 拦新文件/编辑,陈述 4 事实(谁调用/Grep 无现有/数据文件字段/引用用户指令)
- git exec 跨平台(Windows):`node:child_process exec` + `cwd`,git 命令本身跨平台;路径用正斜杠
- `pnpm -r typecheck`+`test` 全包慢(循环每轮跑全量 gate)——`gateCommands` 可配降为单包
- agent 改 agentforge 自身代码可能破坏 test→gate 失败→不 merge→正常(循环自我保护)
- SHARED_TASK_NOTES 放 `.agentforge/loop/`(D12),不污染 repo、不被 git 追踪
- 循环分支名 `continuous-pr/iter-N` 合法;merge 后 deleteBranch
- merge 到 main:需 repo 在 main 分支;循环开始前 `isClean()` + `currentBranch()==="main"` 检查
- cost 累计:每迭代从 last AssistantMessage `usage.cost.total` 取(eval 验证路径)
- in-process fresh context:每迭代 `new AgentForgeHarness` + `createMemorySession()` + `initialMessages:[]`,fresh
- safety ask 降级 deny:循环无交互通道,注入 safety 不传 askHandler(同 rpc 模式)
- Ctrl-C:process SIGINT→`AbortController`→signal 透传 `harness.prompt(signal)`+LoopRunner 停;`signal.aborted` 检查
- `runLoopMode` 须强制至少一个退出条件(默认 maxRuns=1 或要求显式 --max-runs),防 anti-pattern 1
- fresh context(red-team 🔴2):InProcessAgentRunner 不注入 instinct/auditor/verifier(跨迭代进程级状态泄漏),只注入 safety+基础;compactor 亦不注入
- gate 独立性(red-team 根因):LocalBuildGate 跑 agent 改过的 test(agent 运动员兼裁判),dry-run 非独立验证;真独立需 GitHub CI,--review santa 独立 reviewer 部分弥补
- 循环-用户竞态(red-team 🟡5c):循环运行时勿在另一工具(IDE/另一 agentforge)操作同 repo

## 9. red-team Oracle 变更记录(v1 → v2)

| red-team finding | 级别 | v2 处理 |
|---|---|---|
| dry-run 仍真改用户本地 main,无回滚,与「自举安全」矛盾 | 🔴 Blocking | 循环前 `gitOps.tag(loop-rollback-<ts>)` 记回滚点 + isClean/currentBranch/main-origin 断言;任何 stopReason 结束输出回滚 tag + `git reset --hard` 恢复提示;LoopResult 加 rollbackTag |
| 「fresh context」未验证——instinct/auditor 进程级单例跨迭代泄漏 | 🔴 Blocking | D13:InProcessAgentRunner 不注入 instinct/auditor/verifier/compactor;review 用独立 SantaVerifier 不经 harness.verify;§4.3 注入列表明确只剩 safety+基础 |
| agent 破坏自身 test→gate 永失败→空转烧预算;缺连败退出 | 🟡 Important | ExitCondition 加 consecutiveGateFailures + maxConsecutiveGateFailures(默认 3);连败提前停,stopReason="max-consecutive-gate-failures" |
| 过度抽象:4 接口为 2 实现付费;GitOps「留 GitHub adapter」空头承诺 | 🟡 Important | 删所有「留 X adapter 位」空头承诺(GitOps/Gate 改「未来需 X 重新评估接口」);接口本身保留(可测+真实需要) |
| §9 避重就轻漏 4 盲点 | 🟡 Important | (a) deleteBranch 失败 non-fatal+分支名带 iteration 避冲突;(b) SHARED_TASK_NOTES maxEntries=20 截断轮转;(c) 循环-用户竞态文档化警告;(d) review output reply 为主+diff 辅助(空退化 reply-only);(e) 循环前断言 main 与 origin/main 一致或无 remote |
| cost 取 last AssistantMessage 漏算多轮工具调用中间成本 | ⚪ Advisory | InProcessAgentRunner cost = sum 所有 AssistantMessage usage(不只 last) |
| gate 独立性:LocalBuildGate 跑 agent 改过的 test(agent 运动员兼裁判) | 根因洞察 | §1/§8 诚实标注:dry-run gate 非独立验证;真独立需 GitHub CI;--review santa 独立 reviewer 部分弥补 |
| 自举验证的是循环骨架非 continuous-PR 完整模式 | 根因洞察 | §1 诚实标注:dry-run 不覆盖 PR/CI/远程冲突/rebase 核心张力,验证循环编排骨架;真模式验证留 GitHub 支持后 |

**claim-verification 全通过**(red-team 独立验证):harness.ts HarnessOptions/prompt(signal)/instinct-auditor 订阅、verification.ts SantaVerifier.review/createSantaVerifier、eval runner cost 提取、cli flag 路由、ARCH §8/§6、compendium 行 1451-1554/1824-1840——均与实际代码/文件相符,无虚假引用。

## 10. 范围边界汇总

本 slice = continuous-PR(Medium)+ 自举 dry-run + in-process + 分层抽象 + 子命令 CLI + 可选 santa review。**不做**:RFC-DAG、真 GitHub PR/CI、子进程隔离、worktree 并行、SQLite resumable、ci-retry-max、循环事件 emit。harness/shared/eval 零改动,全落 `cli/src/loop/`。
