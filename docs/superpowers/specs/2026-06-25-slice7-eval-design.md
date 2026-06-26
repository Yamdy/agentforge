# Slice 7:eval 包设计

- **Date**: 2026-06-25
- **Slice**: 7(ARCH §8 Slice 7 评测)
- **Status**: Design(red-team Oracle 审后修订 v2,待 plan)
- **依据**: ARCH §8 Slice 7 / §6;compendium `agent-eval` + `agentic-engineering`(eval-first)
- **前置**: Slice 0-5 完成(355 测试绿);@agentforge/harness + @agentforge/cli 就绪
- **red-team**: Oracle 审完成,吸收 1 Blocking + 4 Important + 3 Advisory(见 §8)

---

## 1. 背景与动机

compendium eval-first:agent 质量靠测量(completion rate / cost / wall-clock),非主观判断。agentforge 至 Slice 5 靠真对话手动验证(T10)。Slice 7 建 `@agentforge/eval` 包:task suite + runner + metrics,供 agentforge 自我评测 + head-to-head(不同 config 对比)。

## 2. 范围

**纳入**:
- `@agentforge/eval` 包:Task/Result/Metrics 类型 + Runner(跑 AgentForgeHarness on task)+ metrics(completion rate / cost / wall-clock;pass@3 可选 `--repeats`)
- 2-3 示例 task(验框架)
- head-to-head runner(单变量 diff,见 D5)
- CLI(`agentforge eval --suite <dir> --config a.json --config b.json [--repeats N]`)
- 报告(JSON + markdown)

**defer**(red-team Important 4/5):
- 完整生产 task suite(本 slice 2-3 示例验框架;pass@3 默认 off,待有方差任务再启)
- `retries` metric(red-team Blocking 1:pi 不暴露 retry 计数,drop)
- 自动 task 生成 / CI 门禁 / 多框架对比

## 3. 核心决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | eval 包独立 `@agentforge/eval`,依赖 harness | ARCH §3;eval 消费 harness |
| D2 | Task = prompt + acceptanceChecks(声明式,优先)+ tools + timeout | eval-first:可验证 completion 标准;声明式 check 安全(red-team ⚪ 7:避免任意函数) |
| D3 | Runner 跑 `harness.prompt(task.prompt)` → 从 `harness.agent.state.messages` 最后 AssistantMessage 提取 reply/usage → acceptance | red-team 🟡 2:prompt() 返 void,数据源明确;复用 harness |
| D4 | metrics:completion rate / cost(`usage.cost.total`)/ wall-clock;pass@3 可选(`--repeats`,默认 1) | red-team 🔴 1:drop retries(pi 不暴露);🟡 5:pass@3 默认 off(确定性任务测噪声) |
| D5 | head-to-head:`EvalConfig` **单变量 diff**(provider 或 model 或 systemPrompt 之一),多变量文档标注不可归因 | red-team 🟡 6:变量隔离 |
| D6 | 报告 JSON + markdown(stdout/文件,不进 git) | 可机读+人读 |

## 4. 组件设计

### 4.1 类型(`packages/eval/src/types.ts`)

```ts
export interface Task {
  id: string;
  prompt: string;
  acceptanceChecks: AcceptanceCheck[];   // 声明式(red-team ⚪ 7:避免任意函数)
  tools?: string[];
  timeout?: number;
  setup?: (sandbox: string) => Promise<void>;
  teardown?: (sandbox: string) => Promise<void>;
}

export interface AcceptanceCheck {
  kind: "file-exists" | "file-contains" | "exit-zero";
  path?: string;        // 相对 sandbox
  contains?: string;
  command?: string;     // exit-zero
}

export interface TaskResult {
  taskId: string;
  reply: string;
  passed: boolean;
  tokensIn: number;
  tokensOut: number;
  cost: number;         // usage.cost.total(pi 预算,不重算)
  wallClockMs: number;
  error?: string;
  // red-team 🔴 1:drop retries(pi 不暴露)
}

export interface EvalConfig {
  name: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  // head-to-head 单变量 diff(见 D5)
}

export interface SuiteResult { config: EvalConfig; results: TaskResult[]; metrics: Metrics; }

export interface Metrics {
  completionRate: number;
  pass1: number;            // 单跑通过率
  pass3?: number;           // --repeats 3 时填
  totalTokens: number;
  totalCost: number;
  avgWallClockMs: number;
  // drop avgRetries(red-team 🔴 1)
}
```

### 4.2 Runner + 数据源(`packages/eval/src/runner.ts`)

```ts
export interface RunOpts { repeats?: number; sandboxDir?: string; }
export async function runSuite(tasks: Task[], config: EvalConfig, opts?: RunOpts): Promise<SuiteResult>;
export async function runTask(task: Task, config: EvalConfig, sandbox: string): Promise<TaskResult>;
```

**数据源**(red-team 🟡 2/3 修正,明确提取路径):
- `reply`:harness.prompt() 返 void 后,读 `harness.agent.state.messages`,取最后 `AssistantMessage`,content text join
- `tokensIn`:`message.usage.input`(pi-ai types.d.ts:189-204)
- `tokensOut`:`message.usage.output`
- `cost`:`message.usage.cost.total`(pi 预算,不重算 Model.cost,避免单位混淆)
- `wallClockMs`:`Date.now()` 包 `await harness.prompt(...)`
- `passed`:acceptanceChecks 全过(file-exists/contains 在 sandbox 相对路径;exit-zero 跑 command 退出码 0)

`runTask`:setup sandbox(tmpdir)→ 构造 AgentForgeHarness(provider/model/tools/systemPrompt,getApiKey from cli env-config)→ `const t0=Date.now(); await harness.prompt(task.prompt); const t1=Date.now()` → 提取 reply/usage → acceptanceChecks → teardown → TaskResult。

`runSuite`:跑全部 task(repeats 默认 1,`--repeats 3` 时每 task 跑 3 次算 pass3)→ 聚合 metrics。

### 4.3 head-to-head(`packages/eval/src/head-to-head.ts`)

```ts
export async function runHeadToHead(tasks: Task[], configs: EvalConfig[], opts?: RunOpts): Promise<SuiteResult[]>;
export function compare(results: SuiteResult[]): string;   // markdown 对比表(configs 单变量 diff)
```

### 4.4 示例 task(`packages/eval/src/tasks/`)

- `read-file-name.ts`:prompt "读 <sandbox>/package.json 报告 name",acceptance file-contains package.json name
- `edit-add-comment.ts`:prompt "给 <sandbox>/a.ts 顶部加 `// edited`",acceptance file-contains a.ts "// edited"
- `run-test.ts`:prompt "跑 <sandbox> 测试报告结果",acceptance exit-zero(`pnpm test`)

### 4.5 CLI(`packages/eval/src/cli.ts`)

`agentforge eval --suite <dir> --config a.json --config b.json [--repeats N] [--sandbox <dir>]` → head-to-head → stdout markdown + JSON 报告。

### 4.6 包结构

`packages/eval/`(package.json + tsconfig + src/{types,runner,head-to-head,cli,tasks/*}.ts + tests)。pnpm-workspace.yaml 含 packages/*。依赖 @agentforge/harness + @agentforge/cli(env-config)。

## 5. 测试策略(TDD)

- **types.test.ts**:Task/Result/Metrics 类型
- **runner.test.ts**:runTask(mock streamFn 返 AssistantMessage with usage,验 reply/tokens/cost/wallClock 提取 + acceptance);runSuite 聚合 metrics;repeats=3 pass3
- **acceptance.test.ts**:file-exists/file-contains/exit-zero(tmpdir sandbox)
- **head-to-head.test.ts**:两 config(mock)→ compare markdown
- **real-harness smoke test**(red-team ⚪ 8):mock streamFn 返带 `usage` 的真实 AssistantMessage,验 runTask 提取路径(prompt→messages→usage)
- **回归**:355 → +N(eval 独立)

## 6. 陷阱

- vitest development condition vs tsc dist:eval 依赖 harness,改 harness 后 rebuild dist
- eval 跑真实 LLM 需 key;本地/CI 需 key
- sandbox 隔离:setup 写文件限定 sandbox(tmpdir),exit-zero command 在 sandbox cwd 跑
- `usage.cost.total` 单位(pi 预算,不重算)
- GateGuard 拦新文件/编辑,陈述 4 事实

## 7. red-team 接入点(已审,见 §8)

- ~~retries~~ → drop(pi 不暴露)
- ~~prompt() void 数据源未文档化~~ → §4.2 数据源子节
- ~~cost 公式~~ → usage.cost.total(pi 预算)
- ~~pass@3 噪声~~ → 默认 off,--repeats 可选
- ~~head-to-head 变量隔离~~ → D5 单变量 diff
- ~~mock 保真~~ → real-harness smoke test

## 8. red-team Oracle 变更记录(v1 → v2)

| finding | 级别 | v2 处理 |
|---|---|---|
| retries 不可收集(pi 只暴露 maxRetries 配置) | 🔴 Blocking | drop retries/avgRetries |
| prompt() void,reply/tokens/cost 提取未文档化 | 🟡 Important | §4.2 数据源子节(从 harness.agent.state.messages + usage) |
| cost 公式未给(单位) | 🟡 Important | usage.cost.total(pi 预算,不重算) |
| 2-3 示例 task theater | 🟡 Important | 保留(验框架),生产 task suite defer |
| pass@3 噪声(确定性任务) | 🟡 Important | 默认 repeats=1,--repeats 可选 |
| head-to-head 变量隔离未强制 | 🟡 Important | D5 单变量 diff |
| sandbox 任意代码安全 | ⚪ Advisory | 声明式 acceptanceChecks(避免任意函数);setup/teardown 自用 scope |
| mock 不 catch real-harness bug | ⚪ Advisory | 加 real-harness smoke test(mock streamFn + usage) |
| eval premature | ⚪ Advisory | 框架 + 2-3 示例,生产 suite defer(drop pass@3/retries) |
