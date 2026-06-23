# Slice 3 Verification 设计

> 日期: 2026-06-23
> 状态: Approved（设计已批准，待写实现计划）
> 关联: ARCHITECTURE.md §4.8 Verification / §8 Slice 3 / ADR-0001b / compendium santa-method + verification-loop
> 范围: Slice 3 第一批——Verification 模块（in-process SantaVerifier）。RPC 模式排下一独立 slice。

## 1. 背景与目标

agentforge Slice 3 = 对抗验证（Verification santa 双 reviewer + fix loop）+ RPC 模式。经 brainstorm，本批分批推进：**先 Verification，RPC 排下一 slice**。

Verification 落地 compendium `santa-method`（双独立审查 + verdict gate + fix-until-nice）+ `verification-loop`（确定性阶段）。基于 pi 核心 `Agent` spawn in-process 独立 reviewer（ADR-0001b 已定）。

目标：建 `harness/src/verification.ts` 模块，实现 SantaVerifier 接口 + createSantaVerifier 默认实现，可独立 TDD（mock streamFn 跑 reviewer），cli 本批不接通。

## 2. 决策汇总（brainstorm 已定）

| 决策点 | 选择 | 依据 |
|---|---|---|
| 范围 (a) | 分批，Verification 先行；RPC 排下一 slice | 核心价值优先、可测、风险可控 |
| 挂载点 (c) | harness 模块 + verify() 方法，cli 留后 | 遵循 safety/compaction 模式；cli 接通留后续（类比 ADR-0001d） |
| fix loop (b) | verifier 只评审，fix loop 外部编排（review + verifyUntilNice(fixFn)） | 符合 ARCH §4.8 接口；可独立 TDD |
| reviewer 输出 | 工具强制结构化（submit_review 工具） | 契合 pi Agent 工具范式；gate 可靠可测 |
| reviewer 形态 | in-process 独立 Agent 实例 | ADR-0001b 已定 |

## 3. 架构概览

`packages/harness/src/verification.ts` 新模块，遵循 safety/compaction 既定模式：独立 `.ts` + `SantaVerifier` 接口 + `createSantaVerifier` 默认实现 + `HarnessOptions.verifier?` 可选注入。

reviewer = in-process 独立 `Agent` 实例（ADR-0001b），配 `submit_review` 工具强制结构化产出。本 slice cli 不接通，端到端用 harness 测试（mock streamFn）。verifier 可选注入，未注入时 harness 无 verify 行为，向后兼容，不破坏现有 193 测试。

## 4. 组件与接口

### 4.1 类型

```ts
interface Rubric {
  criteria: string[];      // 通过/失败判定标准
  context?: string;        // 可选背景（如任务描述、约束）
}

interface Issue {
  severity: "high" | "medium" | "low";
  description: string;
  suggestion?: string;
}

interface ReviewerVerdict {
  verdict: "nice" | "naughty";
  issues: Issue[];
}

interface ReviewResult {
  verdict: "nice" | "naughty";      // gate 后最终裁决
  issues: Issue[];                   // 合并去重后的 issues
  reviews: ReviewerVerdict[];        // 两 reviewer 各自原始裁决（透明，供 audit）
}

type FixFn = (output: string, issues: Issue[]) => Promise<string>;

interface VerifyUntilNiceResult {
  output: string;                    // 最终（可能经 fix 修订的）output
  verdict: "nice" | "naughty";       // 收敛结果
  rounds: number;                    // 实际轮次
  history: ReviewResult[];           // 每轮 review 结果
}
```

### 4.2 submit_review 工具

TypeBox schema，reviewer agent 唯一工具：

```ts
parameters: Type.Object({
  verdict: Type.Union([Type.Literal("nice"), Type.Literal("naughty")]),
  issues: Type.Array(Type.Object({
    severity: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
    description: Type.String(),
    suggestion: Type.Optional(Type.String()),
  })),
})
```

`execute` 把 args 存入 reviewer 会话状态供 verifier 提取。reviewer agent 只配此工具。

### 4.3 SantaVerifier 接口

```ts
interface SantaVerifier {
  review(output: string, rubric: Rubric): Promise<ReviewResult>;

  verifyUntilNice(
    initialOutput: string,
    rubric: Rubric,
    fixFn: FixFn,
    maxRounds?: number,   // 默认 3
  ): Promise<VerifyUntilNiceResult>;
}

createSantaVerifier(deps: {
  provider: string;
  model: string;
  getApiKey?: (provider: string) => string | Promise<string | undefined>;
  streamFn?: any;                          // 测试 mock；真对话不传走默认
  reviewerSystemPromptBuilder?: (rubric: Rubric, output: string) => string;  // 默认 builder
  cwd?: string;
}): SantaVerifier
```

### 4.4 harness 集成

- `HarnessOptions` 加 `verifier?: SantaVerifier`。
- `AgentForgeHarness` 加：
  - `verify(output: string, rubric: Rubric): Promise<ReviewResult>`——委托 `this.verifier.review`，符合 ARCH §4.8 接口。未注入 verifier 时 throw `"no verifier configured"`。
  - `get verifier(): SantaVerifier | undefined`——高级用法访问 `verifyUntilNice`。
- `harness.prompt` **不**自动触发 verifier（被动工具，调用方显式调）。

## 5. 数据流

### 5.1 单轮 review(output, rubric)

1. spawn 2 个独立 `new Agent({initialState:{messages:[], systemPrompt: reviewerSystemPromptBuilder(rubric, output), tools:[submitReviewTool], model}})`——无共享上下文、同 rubric。
2. 各自 `agent.prompt("Review the output against the rubric. Call submit_review with your verdict and issues.")` + `waitForIdle`。
3. 从每个 agent state 提取 `submit_review` 工具调用结果 → `ReviewerVerdict`。
4. gate：两 reviewer 都 nice → nice；任一 naughty → naughty；issues 合并。
5. 返回 `ReviewResult{verdict, issues, reviews}`。

### 5.2 fix loop verifyUntilNice(initialOutput, rubric, fixFn, maxRounds=3)

```
output = initialOutput
history = []
for round in 1..maxRounds:
  result = await review(output, rubric)   // 每轮 fresh reviewer（review 内 new Agent）
  history.push(result)
  if result.verdict === "nice":
    return {output, verdict:"nice", rounds:round, history}
  output = await fixFn(output, result.issues)   // 调用方修订
return {output, verdict:"naughty", rounds:maxRounds, history}   // 未收敛
```

## 6. verdict gate 与错误处理

- **gate 语义**：AND——两 reviewer 都 nice 才 nice，任一 naughty 即 naughty；issues 合并（不去重，保留全部；`reviews` 字段保留各自原始裁决供 audit）。
- **reviewer 未调 submit_review**（agent 正常完成但未产出结构化裁决）：该 reviewer 保守判 naughty + issue `{severity:"high", description:"reviewer did not submit structured review"}`（santa 原则：不放过）。
- **reviewer agent 报错**（任一 reviewer 在 `prompt`/`waitForIdle` 过程抛错，如 streamFn 失败）：`review()` 整体抛错，不吞，让调用方处理。与"未调 submit_review"区分：报错=异常抛出，未调=正常完成但不合规→保守 naughty。
- **fixFn 抛错**：`verifyUntilNice` 抛错，不吞。
- **maxRounds 未收敛**：返回 `verdict:"naughty"` + 最后 issues + history，调用方决定下一步。

## 7. 测试策略（TDD，per-test RED-GREEN-REFACTOR）

项目硬约束：无失败测试不写生产代码，严格 per-test RED（Slice 1 classifySkill 教训）。

### 7.1 review()

- 2 reviewer 都 nice → verdict nice，issues 空
- 1 nice 1 naughty → verdict naughty（gate AND），issues 含 naughty reviewer 的
- 2 naughty → verdict naughty，issues 合并
- reviewer 未调 submit_review → 保守 naughty + 对应 issue
- fresh reviewer：每次 review 调用 new 2 Agent（spy 构造计数 = 2 × review 次数）

### 7.2 verifyUntilNice()

- 第 1 轮 nice → rounds=1，verdict nice
- fixFn 修订后第 2 轮 nice → rounds=2
- maxRounds=3 未收敛 → verdict naughty，rounds=3，history 长度 3
- fixFn 收到上一轮 issues
- 每轮 fresh reviewer（review 内 new Agent）
- maxRounds 可注入（测试用 1/2/3）

### 7.3 harness 集成

- 注入 verifier 后 `harness.verify(output, rubric)` 透传 review 结果
- 未注入 verifier `harness.verify` throw `"no verifier configured"`
- 不破坏现有 193 测试（verifier 可选）

### 7.4 其他

- `submit_review` 工具 schema 正确（TypeBox）
- `reviewerSystemPromptBuilder(rubric, output)` 拼接正确（含 criteria + output）
- mock：streamFn 模拟 reviewer agent 调 submit_review（构造 tool call）；fixFn mock 控制修订输出

## 8. 范围边界（本 slice 不做）

- RPC 模式（JSONL over stdio）——排下一独立 slice
- cli `verify` 子命令/skill——留后续（本 slice harness 模块 + 测试）
- reviewer read-only 工具（read/grep/glob）——本 slice 纯文本评审，工具留后
- harness.prompt 自动触发 verifier——被动工具，调用方显式调
- 强隔离（RPC spawn 独立进程）——ADR-0001b Revisit 触发时

## 9. 默认值（可调）

- maxRounds = 3
- gate = AND（both nice 才 nice）
- Rubric = `{criteria: string[], context?: string}`
- reviewer 无工具（仅 submit_review）
- reviewer 未 submit → 保守 naughty

## 10. 关联

- ARCHITECTURE.md §4.8 Verification（接口 sketch）、§8 Slice 3 路线图
- ADR-0001b（subagent spawn 形态：in-process Agent 默认）
- compendium `santa-method`（双独立审查 + verdict gate + fix-until-nice）、`verification-loop`（确定性阶段）
- 既有模式参考：`safety.ts`（可选注入 + HarnessOptions）、`compaction.ts`（deps 注入 + mock streamFn）
