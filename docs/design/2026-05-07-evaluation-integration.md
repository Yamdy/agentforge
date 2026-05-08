# AgentForge v2 — Evaluation 集成

> 2026-05-07 | 基于 Anthropic "Demystifying evals for AI agents" + LangChain Better-Harness

## 设计前提

来自两份资料的核心洞察：

| 洞察 | 来源 | 对 AgentForge 的影响 |
|------|------|---------------------|
| Agent Harness 和 Eval Harness 是镜像结构——共享工具定义、Backend、Trace | Anthropic | Phase Pipeline 同时服务于 Agent 执行和 Eval 执行 |
| `pass@k` (能力) vs `pass^k` (稳定性) | Anthropic | 框架内置 Trial Runner，自动管理 k 次重复 |
| Transcript (交互记录) vs Outcome (最终状态) | Anthropic | Phase Pipeline 自动记录 Transcript，BackendProtocol 提供 Outcome |
| 评估数据 = 训练信号 → 自主改进 Agent Harness | Better-Harness | 框架内置 `Optimizer`——通过 eval 结果自动改进 harness 的 hooks/配置 |
| 六步闭环 (收集→划分→基线→迭代→审核→部署) | Better-Harness | 作为框架能力暴露：`agent.baseline()`, `agent.compare()`, `agent.optimize()` |

## 1. 两个 Harness 的统一

Anthropic 将 Agent Harness 和 Evaluation Harness 分开描述，但 AgentForge 的核心洞察是：**它们共享基础设施**。

```
                      ┌─────────────────────────┐
                      │     AgentForge Core      │
                      │                          │
                      │  Phase Pipeline          │
                      │  BackendProtocol         │
                      │  TraceContext            │
                      │  AgentControls           │
                      │                          │
                      └──────────┬───────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
    ┌─────────▼──────────┐              ┌───────────▼──────────┐
    │  Agent Harness     │              │  Eval Harness        │
    │  (生产执行)         │              │  (评估执行)           │
    │                    │              │                      │
    │  AgentLoop         │              │  TrialRunner         │
    │  run(input)        │              │  run(task, k=5)      │
    │  → 单次执行         │              │  → 并发 k 次         │
    │  → 流式输出         │              │  → 聚合结果           │
    │  → 实际副作用       │              │  → 计算 pass@k/pass^k│
    └────────────────────┘              └──────────────────────┘
```

两种执行复用同一套 Phase Pipeline、同一套工具定义、同一个 BackendProtocol。区别在于 Eval 使用 StateBackend（隔离、可重置），Agent 使用 FilesystemBackend。

## 2. Trial 数据模型

```typescript
// src/evaluation/trial.ts

/**
 * 任务定义——单个测试用例。
 * 有明确的输入和成功标准。
 */
interface Task {
  id: string;
  name: string;
  description: string;

  /** 输入 */
  input: string | Message[];

  /** 初始状态（StateBackend 的文件） */
  setup?: (backend: StateBackend) => Promise<void>;

  /** 成功标准——一个或多个评分器 */
  graders: Grader[];

  /** 关键工具（运行此 Task 需要的工具） */
  tools?: ToolDefinition[];

  /** 期望的最终状态 */
  expectedOutcome?: Partial<ExpectedOutcome>;
}

/**
 * 期望的最终状态——任务环境在 Agent 执行完后的状态。
 * 这是 Anthropic 所说的 Outcome。
 */
interface ExpectedOutcome {
  /** 期望的最终文件内容 */
  files?: Record<string, string>;
  /** 期望创建/删除的文件 */
  fileExists?: string[];
  fileNotExists?: string[];
  /** 期望的最终输出文本（精确或包含） */
  outputContains?: string[];
  outputMatches?: RegExp;
  /** 期望的工具调用序列（按序） */
  expectedToolSequence?: string[];
  /** 禁止的工具调用 */
  forbiddenTools?: string[];
  /** 最大允许步数 */
  maxSteps?: number;
  /** 最大允许延迟（ms） */
  maxLatencyMs?: number;
}

/**
 * 评分器——量化 Agent 在某方面的表现。
 * 一个 Task 可以有多个 Grader。
 */
interface Grader {
  name: string;
  description: string;
  weight?: number;  // 默认 1.0

  /**
   * 对单次 Trial 的结果打分。
   * 
   * 接收 Transcript（完整的交互记录）+ Outcome（最终环境状态）。
   * 返回 0-1 分数 + 原因。
   */
  score(trial: TrialResult): Promise<GraderResult>;
}

interface GraderResult {
  score: number;   // 0-1
  reason: string;
  passed: boolean; // score >= threshold
  dimensions?: Record<string, number>;
}

/**
 * 单次 Trial 的结果。
 */
interface TrialResult {
  taskId: string;
  trialId: string;
  trialIndex: number;  // 第几次尝试 (1..k)

  /** Agent 的最终输出文本 */
  output: string;

  /** 完整的交互记录——Transcript */
  transcript: Transcript;

  /** 最终环境状态——Outcome */
  outcome: BackendSnapshot;

  /** 执行元数据 */
  status: 'success' | 'error' | 'aborted' | 'timeout';
  error?: SerializedError;
  durationMs: number;
  steps: number;
  tokens: TokenUsage;
  cost: CostBreakdown;
}

/**
 * Transcript——单次 Trial 的完整交互记录。
 * 
 * Phase Pipeline 在执行时自动产生每条 Entry。
 */
interface Transcript {
  trialId: string;
  entries: TranscriptEntry[];

  /** Phase 级别的聚合视图 */
  phases: {
    beforeLLM: PhaseRecord[];
    afterLLM: PhaseRecord[];
    beforeTool: PhaseRecord[];
    afterTool: PhaseRecord[];
    onError: PhaseRecord[];
  };
}

interface TranscriptEntry {
  timestamp: number;
  type: 'llm:request' | 'llm:chunk' | 'llm:response'
      | 'tool:request' | 'tool:result'
      | 'hook:start' | 'hook:end' | 'hook:abort'
      | 'phase:start' | 'phase:end'
      | 'state:change';
  data: unknown;
  spanId?: string;  // 关联到 Trace Span
}

interface PhaseRecord {
  phaseName: string;
  hookName: string;
  input: unknown;
  output: unknown;
  aborted: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Backend 快照——Outcome 的具象化。
 */
interface BackendSnapshot {
  files: Record<string, string>;
  fileList: string[];
}
```

## 3. Trial Runner

```typescript
// src/evaluation/trial-runner.ts

interface TrialRunnerConfig {
  /** 重复次数 */
  trials: number;

  /** 最大并发（默认 1，顺序执行以避免状态干扰） */
  concurrency?: number;

  /** 超时（ms） */
  timeout?: number;

  /** 是否在每次 Trial 间重置 Backend */
  resetBackend?: boolean;

  /** 运行时 Hook——与 Agent 执行相同的 Phase Pipeline */
  phases: PhaseRegistry;

  /** LLM 配置 */
  model: ModelConfig;

  /** 工具 */
  tools: ToolDefinition[];
}

interface TrialRunnerResult {
  taskId: string;
  taskName: string;

  /** 所有 Trial 的结果 */
  trials: TrialResult[];

  /** pass@k：k 次中至少成功一次 */
  passAtK: number;

  /** pass^k：k 次中全部成功 */
  passPowerK: number;

  /** 平均指标 */
  avgScore: number;
  avgDurationMs: number;
  avgSteps: number;
  avgTokens: TokenUsage;
  avgCost: CostBreakdown;

  /** 每个 Grader 的得分 */
  graderScores: Record<string, {
    scores: number[];
    avgScore: number;
    passCount: number;  // 达到阈值的次数
  }>;

  /** 失败分析 */
  failureAnalysis: FailureAnalysis;
}

/**
 * 失败分析——Better-Harness 优化循环的输入。
 * 从失败 Trial 的 Transcript 中提取模式。
 */
interface FailureAnalysis {
  /** 失败的 Trial */
  failedTrials: TrialResult[];

  /** 按失败模式分类 */
  categories: FailureCategory[];

  /** 自动检测到的回归 */
  regressions: Regression[];
}

interface FailureCategory {
  name: string;          // 如 "permission_denied", "tool_not_found", "wrong_reasoning"
  count: number;
  trials: string[];      // trialId 列表
  commonPattern?: string;// 检测到的共同模式
  suggestion?: string;   // 改进建议
}

interface Regression {
  taskId: string;
  previousScore: number;
  currentScore: number;
  delta: number;
  severity: 'minor' | 'major' | 'critical';
}

/**
 * TrialRunner——运行 Task 并聚合结果。
 */
class TrialRunner {
  constructor(config: TrialRunnerConfig);

  /** 运行单个 Task */
  async run(task: Task): Promise<TrialRunnerResult>;

  /** 运行 Task 集合 */
  async runAll(tasks: Task[]): Promise<TrialRunnerResult[]>;
}

// 使用示例：
const runner = new TrialRunner({
  trials: 5,          // k=5，计算 pass@5 和 pass^5
  concurrency: 2,     // 2 个并行（StateBackend 隔离）
  timeout: 60_000,
  resetBackend: true, // 每次 Trial 后重置 Backend
  phases: myPhases,
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [bashTool, filesystemTool, searchTool],
});

const result = await runner.run(myTask);
console.log(`pass@5=${result.passAtK}, pass^5=${result.passPowerK}`);
for (const cat of result.failureAnalysis.categories) {
  console.log(`${cat.name}: ${cat.count} failures — ${cat.suggestion}`);
}
```

## 4. 评估与 Phase Pipeline 的关系

Phase Pipeline 在两个方向都起作用：

### 4.1 执行方向（Agent + Eval 共用）

```
Trial 执行 = Agent 执行 + 自动录制 Transcript

phase('beforeLLM').run()  ──→ TranscriptEntry: phase:start(beforeLLM)
  hook('memory').fn()      ──→ TranscriptEntry: hook:start(memory)
  hook('memory').return    ──→ TranscriptEntry: hook:end(memory)  
  hook('permission').fn()  ──→ TranscriptEntry: hook:start(permission)
  hook('permission').abort ──→ TranscriptEntry: hook:abort(permission)
phase return               ──→ TranscriptEntry: phase:end(beforeLLM)

LLM call                   ──→ TranscriptEntry: llm:request
for chunk                  ──→ TranscriptEntry: llm:chunk × N
                           ──→ TranscriptEntry: llm:response

phase('afterLLM').run()    ──→ 类似记录...

Tool execution             ──→ TranscriptEntry: tool:request / tool:result
```

**关键：Transcript 是 Phase Pipeline 的自动副产物，不需要手动录制。**

### 4.2 评分方向（Grader 使用 Phase 信息）

```typescript
// Grader 可以利用 Phase 级别的信息做精细评分：

const permissionGrader: Grader = {
  name: 'permission-safety',
  async score(trial) {
    // 检查每个 beforeTool Phase 中 permission hook 的行为
    const toolPhases = trial.transcript.phases.beforeTool;
    let correctBlocks = 0;
    let missedBlocks = 0;

    for (const phase of toolPhases) {
      const hook = phase.hookName === 'permission';
      const toolCall = phase.input as ToolCall;

      if (isDangerousTool(toolCall) && phase.aborted) {
        correctBlocks++;  // 正确阻止了危险操作
      }
      if (isDangerousTool(toolCall) && !phase.aborted) {
        missedBlocks++;   // 漏掉了危险操作
      }
    }

    const score = correctBlocks / (correctBlocks + missedBlocks + 1);
    return { score, passed: missedBlocks === 0, reason: `Blocked ${correctBlocks}, missed ${missedBlocks}` };
  }
};
```

## 5. Better-Harness 优化循环

```typescript
// src/evaluation/optimizer.ts

/**
 * Optimizer — 通过评估结果自动改进 Agent 的 Hook 配置。
 * 这是 Better-Harness 六步循环的第 4 步（自主迭代）的实现。
 */
interface Optimizer {
  /**
   * 分析失败 Trial 的 Transcript，提出 Hook 改进建议。
   * 
   * 改进类型：
   * - 添加新的 Hook（如发现漏掉的权限检查）
   * - 调整现有 Hook 的 priority
   * - 修改 Hook 的参数（如调整 rate-limit 阈值）
   * - 优化 beforeLLM 的系统提示词注入
   */
  analyze(result: TrialRunnerResult): OptimizationPlan;

  /**
   * 应用优化方案到 PhaseRegistry。
   * 返回新的 PhaseRegistry（不修改原注册表）。
   */
  apply(plan: OptimizationPlan, phases: PhaseRegistry): PhaseRegistry;

  /**
   * 验证优化方案：运行优化集，检查是否有回归。
   */
  verify(plan: OptimizationPlan, optSet: Task[], phases: PhaseRegistry): VerificationResult;
}

interface OptimizationPlan {
  /** 自动生成的改进 */
  changes: OptimizerChange[];

  /** 改进原因（引用具体的失败 Trial） */
  rationale: string;

  /** 预估影响 */
  expectedImpact: {
    passAtKDelta: number;  // pass@k 预期变化
    passPowerKDelta: number;
    affectedTasks: string[];
  };
}

type OptimizerChange =
  | { type: 'add-hook'; phase: PhaseName; hook: Hook<unknown> }
  | { type: 'remove-hook'; phase: PhaseName; hookName: string }
  | { type: 'reorder'; phase: PhaseName; hookName: string; newPriority: number }
  | { type: 'modify-hook'; phase: PhaseName; hookName: string; patch: Partial<Hook<unknown>> }
  | { type: 'add-tool'; tool: ToolDefinition }
  | { type: 'modify-system-prompt'; patch: string }
  | { type: 'adjust-rate-limit'; newLimit: number }
  | { type: 'adjust-permission-policy'; rule: PermissionRule };

interface VerificationResult {
  passed: boolean;
  regressions: Regression[];
  improvedTasks: string[];
  unchangedTasks: string[];
}

/**
 * Better-Harness 六步循环的实现：
 * 
 * const opt = createOptimizer();
 * 
 * // 1. 收集数据
 * const tasks = loadEvalTasks();
 * 
 * // 2. 划分数据
 * const { optSet, testSet } = splitData(tasks, 0.7);
 * 
 * // 3. 建立基线
 * const baseline = await runner.runAll(testSet);
 * 
 * // 4. 自主迭代
 * let currentPhases = baselinePhases;
 * for (let i = 0; i < maxIterations; i++) {
 *   const plan = await opt.analyze(await runner.runAll(optSet));
 *   if (plan.expectedImpact.passAtKDelta < threshold) break;
 *   
 *   currentPhases = opt.apply(plan, currentPhases);
 *   const verified = await opt.verify(plan, optSet, currentPhases);
 *   if (!verified.passed) break;
 * }
 * 
 * // 5. 人工审核
 * const approved = await humanReview(currentPhases);
 * 
 * // 6. 部署
 * if (approved) deploy(currentPhases);
 */
```

## 6. Agent 公共接口扩展

```typescript
// 在现有 Agent 接口上新增评估能力：

interface Agent {
  // ... 现有方法

  // ── 评估 ──

  /**
   * 对单个 Task 运行 k 次 Trial，返回聚合结果。
   * 
   * @example
   * const result = await agent.evaluate(task, { trials: 5 });
   * console.log(result.passAtK, result.passPowerK);
   */
  evaluate(task: Task, options?: EvalOptions): Promise<TrialRunnerResult>;

  /**
   * 批量评估。
   */
  evaluateAll(tasks: Task[], options?: EvalOptions): Promise<TrialRunnerResult[]>;

  /**
   * 建立基线——运行测试集，返回基线结果。
   * 之后可以用 compare() 比较。
   */
  baseline(testSet: Task[]): Promise<BaselineResult>;

  /**
   * 与之前的基线比较，检测回归。
   */
  compare(baseline: BaselineResult, current: TrialRunnerResult[]): RegressionReport;
}
```

## 7. 与当前 Evaluation 模块的差异

| | 当前 (v1) | v2 |
|---|---|---|
| 评估时机 | post-hoc——Agent 执行完后独立评估 | 内嵌——Phase Pipeline 自动录制 Transcript |
| 评分粒度 | Agent 最终输出 | 任何 Phase / Hook / Tool 调用 |
| 重复执行 | 手动 for 循环 | `TrialRunner.run(task, { trials: 5 })` |
| `pass@k` / `pass^k` | 无 | 内置 |
| 失败分析 | 无 | `FailureAnalysis` + 自动分类 |
| 优化闭环 | 无 | `Optimizer.analyze()` → `Optimizer.apply()` → `Optimizer.verify()` |
| 回归检测 | 无 | `agent.baseline()` → `agent.compare()` |
| Backend 隔离 | 无（直接操作磁盘） | StateBackend（隔离、可重置） |

## 8. 实施优先级

评估是最难在后期补救的能力——因为它需要 Phase Pipeline、BackendProtocol、Transcript 录制三者协同。建议顺序：

```
P0: Phase Pipeline（评估依赖它来录制 Transcript）
P1: BackendProtocol（评估依赖 StateBackend 做隔离）
P2: Transcript 录制（Phase.run() 自动录制）
P3: TrialRunner + Task + Grader
P4: pass@k / pass^k 计算
P5: FailureAnalysis + Optimizer（Better-Harness 闭环）
```
