# Slice 6:RFC-DAG 循环模式设计

- **Date**: 2026-06-27
- **Slice**: 6(ARCH §8 Slice 6 循环模式——continuous-PR 已完成,RFC-DAG 本 slice)
- **Status**: Design v2(red-team Oracle 审已吸收 2🔴Blocking + 4🟡Important + 2⚪Advisory + 1 smell,待 plan)
- **依据**: ARCH §8 Slice 6 / §6 映射表(`ralphinho-rfc-pipeline` → cli 工作流 RFC-DAG);compendium `ralphinho-rfc-pipeline` skill(7 stage pipeline + unit spec + complexity tiers + merge queue rules + recovery + outputs,`research/ecc-agent-architecture-compendium.md` 循环模式谱系模式 6)
- **前置**: Slice 0-5/7 + Slice 6 continuous-PR 完成(395+ loop 测试绿,4 包 typecheck+build 过)。continuous-PR 已建可复用抽象(见 `docs/superpowers/specs/2026-06-26-slice6-continuous-pr-design.md`):`GitOps`/`DryRunGitOps`、`Gate`/`LocalBuildGate`、`AgentRunner`/`InProcessAgentRunner`、`SharedTaskNotes`、`ExitCondition`、`LoopRunner`、`LoopMode`、`--review`(`SantaVerifier`)、`createLoopAgentDeps`(6 工具)、`--base-branch`
- **决策来源**: brainstorming 2026-06-27(范围=DAG 骨架 MVP / DAG 分解=AI 全自动 / approach=新 RfcDagRunner 复用子组件 / 失败策略=retry with context / resumable=文件 defer SQLite / merge=fast-forward defer rebase)

---

## 1. 背景与动机

ARCH §8 Slice 6 = 循环模式(continuous-PR + RFC-DAG)。continuous-PR(模式 4,Medium)已完成——单 agent 串行迭代循环 + `SHARED_TASK_NOTES` 桥。本 slice 做 RFC-DAG(模式 6,High)。

RFC-DAG(compendium `ralphinho-rfc-pipeline`):RFC → AI 分解依赖 DAG → 拓扑调度 → per-unit worktree 隔离 → 分层质量管线 → merge queue → final verify。相对 continuous-PR 的升级:① RFC→AI 分解多 unit DAG(continuous-PR 是单 prompt 多迭代)② worktree 隔离(continuous-PR 是主 repo 切分支串行)③ merge queue(依赖满足才 merge)④ resumable ⑤ recovery。

**MVP 范围决策**(brainstorming):类比 continuous-PR「先链路后能力 + 自举 dry-run」成功模式,本 slice 做 **DAG 骨架 MVP**——AI 分解 + 拓扑串行调度 + worktree 隔离 + merge queue 骨架 + 自举 dry-run。Defer:真并行(先串行拓扑一次一个 unit)、SQLite resumable(先文件)、recovery eviction(先轻量 retry with context)、rebase(串行 fast-forward 免冲突)。

**自举 dry-run**:agentforge 无 remote,本 slice 本地验证 DAG 编排骨架:本地 git worktree(非 GitHub PR)+ `LocalBuildGate`(`pnpm -r typecheck`+`test`)+ 本地 merge 回 baseBranch。git/gate/worktree 操作抽象为接口,留真 GitHub/CI adapter 位。

**harness/shared/eval/loop 零改动**:全部新代码落 `packages/cli/src/rfc-dag/`,复用 `loop/` export 的子组件(`GitOps`/`Gate`/`AgentRunner`/`createLoopAgentDeps`/`SantaVerifier`/`ExitCondition`),不碰已绿测试,风险隔离。复用通过 **factory 模式**适配多 cwd(GitOps/Gate 单 cwd → RFC-DAG per-worktree 多 cwd),不改 continuous-PR 接口。

**两个根因局限**(诚实标注,类比 continuous-PR):
- **自举验证的是 DAG 编排骨架,非 RFC-DAG 完整模式**:dry-run 不覆盖真并行多 unit / 远程 merge queue eviction / SQLite resumable 完整语义 / rebase 冲突。本 slice 验证「decompose→拓扑调度→worktree→agent→gate→merge→final verify」编排骨架 + 文件 resumable + 轻量 retry;真 RFC-DAG 模式(并行/recovery/SQLite/rebase)留后续。
- **gate 独立性**:`LocalBuildGate` 跑 agent 改过的 test(agent 运动员兼裁判),dry-run 非独立验证;`--review` santa 独立 reviewer 部分弥补。
- **DAG 分解质量未校验**:graph-validity(无环/依赖存在)只抓 malformed,不抓 missing dependency/wrong granularity/semantic-wrong。MVP 无分解质量信号,valid-but-wrong DAG 跑完产 broken units(retry 烧 budget);人工确认 DAG defer,max-units 是唯一护栏。
- **resumable 是 partial**:文件 `state.json` 只帮 crash 恢复(跳过已 merged),不帮 logical 恢复(failed unit 无 regenerate narrowed scope——recovery defer);single failed unit 终止 RFC 价值,下游 skipped。

## 2. 范围

**纳入**:
- `DagDecomposer`(RFC→unit DAG,AI 全自动 + 拓扑校验)
- `DagScheduler`(拓扑序 + 依赖满足 + 串行 + failed 下游 skipped)
- `WorktreeOps` 接口 + `DryRunWorktreeOps`(git worktree add/remove 真执行)
- `RfcDagState`(文件 resumable,`.agentforge/rfc-dag/state.json`)
- `RfcDagRunner`(编排 + 退出条件 + 错误兜底)
- merge queue 骨架(fast-forward merge,依赖满足才 merge)
- 可选 `--review` gate(复用 `SantaVerifier`)
- CLI 子命令 `agentforge rfc-dag` + `index.ts` 路由
- `ExitCondition` 复用(整体 maxRuns/cost/duration)
- 轻量 retry with context(`maxUnitRetries` 默认 2)

**defer**(YAGNI,留后续 slice):
- 真并行多 unit(MVP 串行拓扑一次一个)
- SQLite resumable(MVP 文件 `state.json`)
- recovery eviction(evict + snapshot + regenerate narrowed scope + retry;MVP 轻量 retry 同 unit)
- rebase(MVP 串行 fast-forward 免冲突;rebase 是并行 merge queue 需求)
- 真 GitHub PR/CI(adapter 位不实现)
- 子进程 `--isolate`(in-process 先打通)
- DAG 分解人工确认(MVP AI 全自动)
- 循环事件 emit(`RfcDagRunner` 只返 `RfcDagResult` + console,不 emit harness 事件)

## 3. 核心决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 范围 = DAG 骨架 MVP,defer 真并行/SQLite/recovery/rebase | High 复杂度;先链路后能力(ARCH §1);类比 continuous-PR 成功模式;单 spec 可控 |
| D2 | 自举 dry-run + 本地 worktree + LocalBuildGate + 接口抽象 | agentforge 无 remote;本地 worktree 复用 git;接口留 GitHub adapter 不锁死 |
| D3 | AI 全自动 DAG 分解(agent 读 RFC→unit list + 拓扑校验) | 验证 AI 分解能力是 RFC-DAG 核心;类比 continuous-PR agent 自驱;人工确认留后续 |
| D4 | approach = 新 RfcDagRunner + 复用 continuous-PR 子组件 | `LoopRunner`(单 prompt 多迭代)与 `RfcDagRunner`(多 unit DAG)编排模型不同;复用子组件但不复用 `LoopRunner` 编排;SRP + 风险隔离(不威胁已绿测试) |
| D5 | 串行拓扑(一次一个 unit) | MVP defer 真并行;串行天然免 merge 冲突(每 unit 从最新 baseBranch 切→fast-forward);in-process 串行无并发安全需求 |
| D6 | worktree 隔离(新 `WorktreeOps` 接口,不动 `loop/git-ops.ts`) | 每 unit 独立 worktree + branch(`rfc-dag/<unit-id>`);不动 continuous-PR `GitOps` 接口,风险隔离 |
| D7 | resumable = 文件 `state.json`(defer SQLite) | MVP 轻量持久化 DAG 状态 + unit 进度;中断重跑跳过已 merged;SQLite 留后续 |
| D8 | 失败策略 = retry with context(`maxUnitRetries` 默认 2)+ 达上限 failed | 类比 continuous-PR「error 进 notes 喂下轮」;轻量 retry 非 recovery(不 regenerate scope);依赖 failed 下游 skipped |
| D9 | merge = fast-forward(串行免冲突),defer rebase | 串行拓扑每 unit 从最新 baseBranch 切→merge fast-forward 无冲突;rebase 是并行需求留后续 |
| D10 | review = 可选 `--review` 复用 `SantaVerifier`,naughty → retry(带 issues) | 复用 Slice 3 模块;naughty 与 gate 统一 retry 策略 |
| D11 | harness/shared/eval/loop 零改动,全落 `cli/src/rfc-dag/` | 复用 `loop/` export 子组件;不碰已绿测试,风险隔离 |
| D12 | 不注入 instinct/auditor/verifier/compactor(fresh context,类比 continuous-PR D13) | unit agent 纯 fresh;review 用独立 `SantaVerifier` 不经 `harness.verify` |
| D13 | 多 cwd 适配 = factory 模式(`gitOpsFactory`/`gateFactory`) | continuous-PR `GitOps`/`Gate` 单 cwd;RFC-DAG per-worktree 多 cwd;factory 多实例复用 `DryRunGitOps`/`LocalBuildGate`,不改接口 |
| D14 | CLI = 子命令 `agentforge rfc-dag` | 类比 `loop`;`index.ts` 检测 `argv[0]==="rfc-dag"` 路由(子命令优先) |

## 4. 组件设计

### 4.1 DagDecomposer(`packages/cli/src/rfc-dag/dag-decomposer.ts`)

```ts
export interface WorkUnit {
  id: string;
  dependsOn: string[];        // 依赖的 unit id 列表
  scope: string;              // 工作范围描述
  acceptanceTests: string[];  // 验收标准
  riskLevel: 1 | 2 | 3;       // compendium complexity tiers(1 单文件/2 多文件/3 schema-auth-perf-security)
  rollbackPlan: string;
}
export interface Dag { units: WorkUnit[]; }

export interface DagDecomposer {
  /** agent 读 RFC → 产 unit list JSON → parse(剥围栏+brace-fallback)→ 拓扑校验。失败 throw。 */
  decompose(rfc: string): Promise<Dag>;
}
```
- 用 `InProcessAgentRunner`(复用)读 RFC,产 JSON unit list;`parse` 剥 markdown 围栏 + brace-fallback(类比 instinct `parseInstinctsJson`,防 LLM 包 ```json)。
- 拓扑校验:无环(DFS)+ 依赖 id 存在 + ≥1 unit + max-units guardrail(默认 ≤20,防 mega-decomposition)。校验失败 throw(decompose 失败)。
- **语义校验限制**(诚实标注):graph-validity 只抓 malformed graph,不抓 missing dependency(单 unit 静默假设他 unit 输出)/wrong granularity/semantic-wrong scope。MVP 无分解质量信号,valid-but-wrong DAG 跑完产 broken units(retry 烧 budget);人工确认 DAG defer,max-units 是唯一质量护栏。
- 构造注入 `{ agentRunner, decomposePrompt? }`。

### 4.2 DagScheduler(`packages/cli/src/rfc-dag/dag-scheduler.ts`)

```ts
export type UnitStatus = "pending" | "running" | "merged" | "failed" | "skipped";
export interface UnitState { id: string; status: UnitStatus; attempts: number;
  lastError?: string; lastGateOutput?: string; lastReviewIssues?: string[]; }   // retry 上下文(并入 state,不引入独立 notes)

export interface DagScheduler {
  /** 下一个可跑 unit:status=pending 且所有 dependsOn status=merged。串行一次一个。无则 null。 */
  next(): WorkUnit | null;
  /** 标记 unit 状态。failed → 下游 next() 时自动标 skipped(依赖未满足)。 */
  mark(id: string, status: UnitStatus): void;
  status(id: string): UnitState;
  allDone(): boolean;   // 无 pending/running
}
```
- 纯逻辑(可 mock)。构造注入 `{ dag, state }`(从 `RfcDagState` 恢复)。

### 4.3 WorktreeOps(`packages/cli/src/rfc-dag/worktree-pool.ts`)

```ts
export interface WorktreeOps {
  /** git worktree add --force <path> -B <branch>(--force 清路径残留[崩溃后 worktree 目录已注册],-B 重建 branch 残留)。注意:worktree 路径残留用 --force,≠ checkout -B branch 残留——两者不同 git 机制。 */
  addWorktree(path: string, branch: string): Promise<void>;
  /** git worktree remove --force <path>(失败 non-fatal 记 warning;残留下次 addWorktree --force 清)。 */
  removeWorktree(path: string): Promise<void>;
}
```
- `DryRunWorktreeOps`:本地真 git worktree exec(`git worktree add/remove`)。构造注入 `{ cwd }`。
- 每 unit:`<repo>/.agentforge/worktrees/<unit-id>` + branch `rfc-dag/<unit-id>`。
- **不动 `loop/git-ops.ts`**(新接口,风险隔离)。

### 4.4 RfcDagState(`packages/cli/src/rfc-dag/rfc-dag-state.ts`)

```ts
export interface RfcDagStateData {
  dag: Dag;
  units: Record<string, UnitState>;
  rollbackTag: string;
}
export interface RfcDagState {
  data: RfcDagStateData;
  load(): RfcDagStateData | null;   // 不存在 → null
  save(): void;                      // .agentforge/rfc-dag/state.json
  reset(): void;                     // 删文件(新 run 开始)
  markUnit(id: string, status: UnitStatus, attempts?: number,
    context?: { lastError?: string; lastGateOutput?: string; lastReviewIssues?: string[] }): void;  // 写 retry 上下文
}
```
- 文件 resumable(defer SQLite)。中断重跑 `load` → 跳过已 `merged`,从 `pending`/`failed` 恢复。
- retry 上下文(`lastError`/`lastGateOutput`/`lastReviewIssues`)并入 `UnitState`(不引入独立 `SharedTaskNotes`,简化 + 随 resumable 持久化)。
- 构造注入 `{ dir }`(默认 `<cwd>/.agentforge/rfc-dag`)。

### 4.5 RfcDagRunner(`packages/cli/src/rfc-dag/rfc-dag-runner.ts`)

```ts
export interface RfcDagConfig {
  rfc: string;
  exit: ExitConditionConfig;        // 复用 continuous-PR
  review?: ReviewGate;              // --review(复用 continuous-PR ReviewGate)
  maxUnitRetries?: number;          // 默认 2
  baseBranch?: string;              // 默认 main(与 LoopConfig 一致;自举 pi repo 用 --base-branch pi 显式传)
  branchPrefix?: string;            // 默认 "rfc-dag"
}
export interface RfcDagDeps {
  /** DryRunGitOps 多实例(非改接口):主 repo(checkout/merge/tag/isClean/currentBranch)+ per-worktree(commit/diff)。 */
  gitOpsFactory: (cwd: string) => GitOps;
  worktreeOps: WorktreeOps;         // 新
  /** LocalBuildGate 多实例:per-worktree gate + final verify(主 repo)。 */
  gateFactory: (cwd: string) => Gate;
  agentRunner: AgentRunner;         // 复用(run 已带 cwd)
  decomposer: DagDecomposer;        // 新
  state: RfcDagState;               // 新
}
export interface UnitResult {
  unitId: string; status: UnitStatus; attempts: number;
  reply?: string; cost: number; gatePassed: boolean;
  reviewVerdict?: "nice" | "naughty"; error?: string;
}
export interface RfcDagResult {
  units: UnitResult[]; totalCost: number; stopReason: string; rollbackTag: string;
}
export class RfcDagRunner {
  constructor(config: RfcDagConfig, deps: RfcDagDeps);
  async run(signal?: AbortSignal): Promise<RfcDagResult>;
}
```
- 编排:decompose → state 持久化 → loop(`scheduler.next` → worktree → agent → review? → commit → gate → merge → state)→ final verify → 输出。
- unit 级 try/catch 兜底(D8),error/gate/review 失败进 notes 喂 retry。signal 透传 agentRunner。

### 4.6 review gate(复用 SantaVerifier)

`--review` 时 `RfcDagConfig.review = { rubric, verifier }`。每 unit agent 产出后:
- `output` = agent reply 为主 + `wtGitOps.diff()` 辅助(未 commit 改动,超长截断;空退化 reply-only,类比 continuous-PR)。**reviewer 不在 worktree cwd 跑**(continuous-PR `createDefaultReviewerRun` 构造 Agent 不传 cwd,reviewer 在主 repo cwd)——靠 diff text 看 worktree 改动(intentional design,非 latent bug);`createSantaVerifier` 的 cwd 对 default reviewerRun 不生效,RFC-DAG 继承。
- `verdict==="nice"` → commit→gate→merge;`naughty` → 记 `issues` 到 `state`(`lastReviewIssues`),retry(带 issues 上下文),达 `maxUnitRetries` 标 failed。

默认 rubric(可配):「unit 改动符合 scope/acceptanceTests;不破坏现有测试/类型;无明显 slop」。

### 4.7 CLI rfc-dag-mode(`packages/cli/src/rfc-dag/rfc-dag-mode.ts`)+ index.ts 路由

```ts
export interface RfcDagModeOptions {
  rfc: string;               // --rfc <file|->(- 从 stdin 读 RFC)
  maxRuns?: number; maxCost?: number; maxDurationMs?: number;
  review?: boolean; maxUnitRetries?: number; baseBranch?: string;
  gateCommands?: string[];
  getApiKey: (provider: string) => string | Promise<string | undefined>;
  provider: string; model: string; cwd?: string; streamFn?: any;
}
/** 解析 argv(--rfc/--base-branch/--max-unit-retries/--review/...) → 构造 RfcDagConfig + RfcDagDeps
 *  (gitOpsFactory/gateFactory/worktreeOps/DryRunWorktreeOps/InProcessAgentRunner/DagDecomposer
 *  /RfcDagState [+ createSantaVerifier if --review])→ RfcDagRunner.run → 输出 RfcDagResult 摘要。 */
export async function runRfcDagMode(argv: string[], opts: RfcDagModeOptions): Promise<RfcDagResult>;
```
`index.ts` 路由(子命令优先,与 `loop` 并列):
```ts
if (argv[0] === "rfc-dag") { await runRfcDagMode(argv.slice(1), { getApiKey }); return; }
if (argv[0] === "loop") { await runLoopMode(argv.slice(1), { getApiKey }); return; }
// ...原有 print/rpc/repl flag 检测
```

## 5. 数据流(DAG 执行)

```
RfcDagRunner.run:
  repoCwd = config.cwd ?? process.cwd()
  worktreesDir = `${repoCwd}/.agentforge/worktrees`
  repoGitOps = gitOpsFactory(repoCwd)
  开始前:
    assert repoGitOps.isClean()
    assert repoGitOps.currentBranch() === config.baseBranch
    rollbackTag = `rfc-dag-rollback-${Date.now()}`
    await repoGitOps.tag(rollbackTag)
    state.reset()   // 新 run 重置(类比 notes reset)
  decompose:
    dag = await decomposer.decompose(config.rfc)   // AI 产 unit DAG + 拓扑校验
    state.data = { dag, units: initPending(dag), rollbackTag }
    state.save()
  scheduler = new DagScheduler(dag, state)   // 恢复:state 已 merged 的跳过
  // ExitCondition(state2)是 cost/duration 保险;主退出 = scheduler.next()===null(allDone)
  state2 = { runs:0, cost:0, durationMs:0, consecutiveCompletionSignals:0, consecutiveGateFailures:0 }  // 复用 LoopState 全 5 字段(后 2 counter per-unit 模型未用,但 checkExit 要求存在;runs=unit 执行次数含 retry)
  loop:
    while unit = scheduler.next():            // 主退出:null = allDone
      exit = checkExit(state2, config.exit)   // 保险:cost/duration/maxRuns 超限停
      if exit.stop: break with stopReason
      wt = `${worktreesDir}/${unit.id}`
      branch = `${config.branchPrefix}/${unit.id}`
      attempts = state.status(unit.id).attempts
      wtGitOps = gitOpsFactory(wt)
      gate = gateFactory(wt)
      try:
        await worktreeOps.addWorktree(wt, branch)   // 从最新 baseBranch 切,依赖 unit 代码已含
        notesContent = buildNotes(unit, state)   // 读 state.units[unit.id].last*(retry 上下文)
        mergedDepsContext = unit.dependsOn.map(id => `${id}: ${dag.find(u=>u.id===id)?.scope}`).join("; ")  // 提示依赖 unit(代码已在 worktree)
        prompt = buildUnitPrompt(config.rfc, unit, notesContent, mergedDepsContext)
        t0 = now
        { reply, cost } = await agentRunner.run(prompt, { cwd: wt, signal })   // 6 工具真改文件
        // optional review gate
        if config.review:
          output = reply + truncate(wtGitOps.diff())
          reviewResult = await config.review.verifier.review(output, config.review.rubric)
          if reviewResult.verdict === "naughty":
            if attempts+1 > config.maxUnitRetries: scheduler.mark(unit.id, "failed")
            else: state.markUnit(unit.id, "pending", attempts+1, { lastReviewIssues: reviewResult.issues })
            await worktreeOps.removeWorktree(wt); state.save(); continue
        // commit(有 changes 才;worktree branch 内)
        await wtGitOps.commit(replySummary)
        // gate
        gateResult = await gate.run()
        if gateResult.passed:
          await repoGitOps.checkout(config.baseBranch)
          mergeResult = await repoGitOps.merge(branch)   // DryRunGitOps.merge 非 --ff-only;baseBranch 前进时可能 merge commit/冲突 → 冲突 retryable
          if mergeResult.ok:
            scheduler.mark(unit.id, "merged")
          else:   // 冲突(罕见,外部竞态)
            if attempts+1 > config.maxUnitRetries: scheduler.mark(unit.id, "failed")
            else: state.markUnit(unit.id, "pending", attempts+1, { lastError: mergeResult.conflict })
        else:
          if attempts+1 > config.maxUnitRetries: scheduler.mark(unit.id, "failed")
          else: state.markUnit(unit.id, "pending", attempts+1, { lastGateOutput: gateResult.output })
      catch err:
        if attempts+1 > config.maxUnitRetries: scheduler.mark(unit.id, "failed")
        else: state.markUnit(unit.id, "pending", attempts+1, { lastError: err.message })
      await worktreeOps.removeWorktree(wt)   // non-fatal
      state2.runs++; state2.cost += cost; state2.durationMs += (now - t0)
      state.save()
    // final verify(全量集成,主 repo)
    await repoGitOps.checkout(config.baseBranch)
    finalGate = gateFactory(repoCwd)
    finalResult = await finalGate.run()
    console.log(`RFC-DAG 结束(${stopReason})。回滚 tag: ${rollbackTag}`)
    console.log(`  git reset --hard ${rollbackTag}`)
    return { units: collectUnitResults(state), totalCost: state2.cost, stopReason: exit.reason, rollbackTag }
```

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| decompose 失败(产不出合法 DAG/校验不通过) | throw,停,输出回滚 tag + `git reset` 提示 |
| unit agent 崩溃 | try/catch 记 notes,retry(attempts++),达 `maxUnitRetries`(默认 2)标 failed |
| unit gate 失败 | 记 gate 输出 notes,retry,达上限标 failed |
| review naughty | 记 issues notes,retry(带 issues 上下文),达上限标 failed(与 gate 统一) |
| merge 冲突/非 fast-forward(baseBranch 前进) | `DryRunGitOps.merge` 非 --ff-only;冲突时 `git merge --abort` 回 baseBranch + 记 conflict → retry;retry `addWorktree --force -B` 重建 branch 重置到最新 base(discard 旧 attempt commits,context 靠 last*),达上限标 failed |
| 依赖 unit failed | scheduler 下游 unit 标 `skipped`(依赖未满足,不跑) |
| cost/duration/maxRuns 超限 | `checkExit` 停,stopReason 对应 |
| Ctrl-C / abort | signal 透传 agentRunner→harness.prompt(signal)→agent.abort,stopReason="aborted" |
| working tree 不干净 | 开始前 `isClean()` assert 失败 throw,不开始 |
| worktree 残留(上次中断/崩溃) | `addWorktree` 用 `git worktree add --force -B`(--force 清路径残留,-B 重建 branch);worktree 路径残留机制 ≠ checkout -B branch 残留 |
| removeWorktree 失败 | non-fatal 记 warning;worktree 残留下次 `-B` 重建 |
| 无任何退出条件 | RFC-DAG 主退出 = `scheduler.allDone()`(所有 unit done/failed/skipped),`maxUnitRetries` 限 retry 防单 unit 无限;`ExitCondition`(cost/duration/maxRuns)是额外保险超限强制停,非主退出(与 continuous-PR 不同) |
| 整体结束(任何 stopReason) | 输出回滚 tag + `git reset` 提示 + unit scorecards |
| 循环运行时用户操作同 repo | inherent 竞态;文档化警告:RFC-DAG 运行时勿在另一工具操作同 repo(类比 continuous-PR) |

## 7. 测试策略(TDD)

- **dag-decomposer.test.ts**:mock agentRunner 产 unit list JSON,测 parse(剥围栏+brace-fallback,类比 instinct)+ 拓扑校验(无环/依赖 id 存在/空 DAG/循环依赖 throw/非法 dependsOn id)
- **dag-scheduler.test.ts**:拓扑序 `next` + 依赖满足判定 + 串行(一次一个)+ failed 下游 skipped + `allDone`
- **worktree-pool.test.ts**:临时 git repo(`mkdtemp`+`git init`)测 addWorktree/removeWorktree/残留 `-B` 重建/clean
- **rfc-dag-state.test.ts**:tmpdir 测 save/load/reset/skip 已 merged unit(恢复语义)
- **rfc-dag-runner.test.ts**(全 mock 编排):正常 DAG 3 unit(含依赖)全 merge + final verify / unit gate 失败 retry→pass / retry 达上限 failed + 下游 skipped / decompose 失败 throw + 回滚 / resumable 恢复跳过已 merged / review naughty→retry→nice merge / 回滚 tag 输出 / abort 透传 / isClean 失败 throw / merge 冲突 retry
- **rfc-dag-mode.test.ts**:argv 解析(`--rfc`/`--base-branch`/`--max-unit-retries`/`--review`)+ wiring(构造各默认实现)+ index.ts 路由(`argv[0]==="rfc-dag"`)
- **真对话自举验证**:agentforge 自身,RFC 如「给 `packages/harness/src/adr.ts` 补边界测试 + 给 `audit.ts` 补边界测试」(2 unit 无依赖)或「重构 X 后补测试」(2 unit 有依赖),AI 分解,跑通 decompose→worktree→agent→commit→gate→merge→final verify,验证 DAG 调度 + worktree 隔离 + resumable
- **回归**:395+ → +N(全 cli/rfc-dag,不动 harness/shared/eval/loop)

## 8. 陷阱

- vitest development condition vs tsc dist:本 slice 新 `cli/src/rfc-dag/` 目录,cli 内部类型不跨包;但 `index.ts` 路由改后需 cli typecheck+build。复用 harness export 不需改 harness dist
- GateGuard 拦新文件/编辑,陈述 4 事实(谁调用/Grep 无现有/数据文件字段/引用用户指令)
- git worktree 跨平台(Windows):`node:child_process exec` + `cwd`,git worktree 命令跨平台;路径用正斜杠;worktree 在 `.agentforge/`(gitignore)
- InProcessAgentRunner `cwd` 注入 worktree 路径(agent 在 worktree 改文件);复用 `createLoopAgentDeps` 6 工具
- fresh context(D12):unit agent 不注入 instinct/auditor/verifier/compactor(类比 continuous-PR D13)
- decompose agent 产 JSON:剥围栏 parse(类比 instinct `parseInstinctsJson`,防 LLM 包 ```json 致 parse 抛错静默返 [])
- cost 累计:sum 所有 AssistantMessage usage(复用 InProcessAgentRunner,不只 last)
- gate 独立性:同 continuous-PR(`LocalBuildGate` 跑 agent 改过的 test,agent 运动员兼裁判;`--review` santa 独立 reviewer 部分弥补)
- 串行降低冲突概率但不保证:`DryRunGitOps.merge` 非 --ff-only,baseBranch 前进(并发编辑/前 unit merge)时可能 merge commit 或冲突(red-team 🔴2);冲突 retryable;真 GitHub adapter 需 --ff-only/rebase(non-quiescent baseBranch 的 correctness,非仅并行 feature)
- 多 cwd factory:`gitOpsFactory`/`gateFactory` 多实例,主 repo + per-worktree;勿共享单 cwd 实例
- ExitCondition 复用:state2 须全 5 字段(`LoopState` 要求 `consecutiveCompletionSignals`/`consecutiveGateFailures`,per-unit 模型未用但必填,red-team 🔴1)
- worktree 残留:`addWorktree` 用 `git worktree add --force -B`(--force 清路径残留 ≠ checkout -B branch 残留,red-team 🟡3);`removeWorktree --force` non-fatal;崩溃留 orphan worktree 需 --force 清
- merge 到 baseBranch:需主 repo 在 baseBranch;循环开始前 `isClean()` + `currentBranch()===baseBranch` 检查
- `runRfcDagMode` 须强制至少一个退出条件,防 anti-pattern 1(无退出条件无限循环)
- Ctrl-C:process SIGINT→`AbortController`→signal 透传 `harness.prompt(signal)`+RfcDagRunner 停
- safety ask 降级 deny:unit agent 注入 safety 不传 askHandler(同 rpc/loop,无交互通道)

## 9. 范围边界汇总

本 slice = RFC-DAG MVP(AI 分解 + 拓扑串行 + worktree 隔离 + merge queue 骨架 + 文件 resumable + 轻量 retry + 自举 dry-run + 可选 santa review)。**不做**:真并行、SQLite resumable、recovery eviction、rebase、真 GitHub PR/CI、子进程隔离、人工确认 DAG、循环事件 emit。harness/shared/eval/loop 零改动,全落 `cli/src/rfc-dag/`。

## 10. red-team Oracle 变更记录(v1 → v2)

| red-team finding | 级别 | v2 处理 |
|---|---|---|
| `state2` 3 字段不匹配 `LoopState` 5 字段(`consecutiveCompletionSignals`/`consecutiveGateFailures` 非可选),`checkExit(state2,…)` 不 typecheck | 🔴 Blocking | §5 state2 全 5 字段(后 2 counter per-unit 未用但 LoopState 要求);§8 加陷阱 |
| "fast-forward 串行免冲突"是文档谎言:`DryRunGitOps.merge` 用 `--no-edit` 非 `--ff-only`,baseBranch 前进(并发/前 unit merge)时非 FF | 🔴 Blocking | 删"免冲突"绝对语言;merge 非 ff 当 retryable conflict;§5/§6/§8 诚实标注;escalation:真 GitHub 需 --ff-only/rebase(correctness for non-quiescent baseBranch,非仅并行 feature) |
| worktree 残留 `-B` 是 branch flag(checkout -B)非 worktree flag;`git worktree add` 路径已注册(崩溃后)需 `--force`,spec 混淆两机制 | 🟡 Important | §4.3 `addWorktree` 用 `git worktree add --force -B`(--force 清路径残留,-B 重建 branch);删错误 checkout -B 类比;§6/§8 修正;崩溃 orphan worktree 靠 --force 清 |
| DAG 校验结构对但语义未校验(missing dep/granularity/semantic-wrong),MVP 核心是 AI 分解却无质量信号 | 🟡 Important | §4.1 加 max-units guardrail(≤20)+ §1 诚实标注语义校验限制(valid-but-wrong DAG 烧 budget) |
| `--review` reviewer 不在 worktree cwd(`createDefaultReviewerRun` 构造 Agent 不传 cwd),靠 diff text 是 intentional 但未声明 | 🟡 Important | §4.6 明确 reviewer 靠 diff text 看 worktree 改动(intentional design);`createSantaVerifier` cwd 对 default reviewerRun 不生效,RFC-DAG 继承 |
| defer recovery+rebase 留 failed unit 故事缺失(resumable 只帮 crash 恢复,不帮 logical 恢复;single failed unit 终止 RFC) | 🟡 Important | §1 诚实标注 resumable partial(failed unit 无 regenerate,下游 skipped) |
| `git merge --abort` 隐藏状态突变 + retry discard 旧 attempt commits 未声明 | ⚪ Advisory | §6 merge 行明确:冲突 `--abort` 回 baseBranch,retry `--force -B` 重建 discard 旧 commits,context 靠 last* |
| `baseBranch` 默认 "pi"(repo-specific 硬编码)vs `LoopConfig` "main" | ⚪ Advisory | §4.5 默认改 "main"(与 LoopConfig 一致),自举用 `--base-branch pi` 显式传 |
| factory 模式(D13)justified,非 over-engineering(DryRunGitOps/LocalBuildGate 已有 {cwd},factory 是最低复杂度选择) | ⚪ Advisory | 不改(确认合理) |

**claim-verification 全通过**(red-team 独立验证):continuous-PR 抽象签名——`GitOps`(createBranch/checkout/commit/merge/currentBranch/hasChanges/deleteBranch/diff/tag/isClean)+ `DryRunGitOps{cwd}`(多实例)+ `Gate.run()`(无参)+ `LocalBuildGate{cwd,commands?}` + `AgentRunner.run(prompt,{cwd,signal})` + `ExitConditionConfig`(maxRuns/maxCost/maxDurationMs/completionSignal/completionThreshold/maxConsecutiveGateFailures)+ `ReviewGate{rubric,verifier}` + `checkExit(state,config)` + `createLoopAgentDeps`(6 工具)+ `SantaVerifier.review(output,rubric)→{verdict,issues}`——均存在且匹配。continuous-PR 引用(D13 不注入 instinct/auditor/verifier/compactor / --base-branch / notes reset / createBranch -B 问题④)全对。**load-bearing 复用声明成立**。
