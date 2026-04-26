# 可观测 & 管控能力

> 生产化必备：全链路埋点、状态机标准化、配置热更新、性能优化、上下文管理。

---

## 1. 全链路埋点标准化

### 1.1 埋点事件矩阵

| 埋点项 | 事件类型 | 计算方式 | 设计状态 |
|--------|---------|---------|---------|
| 每轮 Loop | `agent.step` | 计数 | ✅ 已设计 |
| Loop 总耗时 | `agent.start` → `agent.complete` | 时间差 | ✅ 已设计 |
| LLM 耗时 | `llm.request` → `llm.response` | 时间差 | ✅ 已设计 |
| Token 消耗 | `llm.response.usage` | 直接读取 | ✅ 已设计 |
| Tool 耗时 | `tool.call` → `tool.result` | 时间差 | ✅ 已设计 |
| Skill 加载耗时 | `tool.call`（load_skill）| 时间差 | ✅ 已设计 |
| 重试次数 | `agent.retry` 事件计数 | 累加 | ✅ 已设计 |
| 暂停时长 | `agent.paused` → `agent.resumed` | 时间差 | ✅ 已设计 |
| SubAgent 耗时 | `subagent.start` → `subagent.complete` | 时间差 | ✅ 已设计 |
| MCP 调用耗时 | `tool.call`（MCP 工具）| 时间差 | ✅ 已设计 |

### 1.2 内存与资源监控

```typescript
// src/observability/resource-monitor.ts

import { Observable, interval, map } from 'rxjs';

export interface ResourceMetrics {
  timestamp: number;
  
  // 内存
  memory: {
    heapUsed: number;      // 已用堆内存
    heapTotal: number;     // 总堆内存
    external: number;      // 外部内存（C++ 对象）
    rss: number;           // 驻留集大小
  };
  
  // CPU（可选，Node.js 环境）
  cpu?: {
    user: number;          // 用户态 CPU 时间
    system: number;        // 内核态 CPU 时间
  };
  
  // 事件循环延迟（Node.js）
  eventLoopDelay?: number;
}

export class ResourceMonitor {
  private intervalMs: number;
  
  constructor(intervalMs: number = 10000) {
    this.intervalMs = intervalMs;
  }
  
  /** 资源指标流 */
  get metrics$(): Observable<ResourceMetrics> {
    return interval(this.intervalMs).pipe(
      map(() => this.collect()),
    );
  }
  
  /** 采集当前资源指标 */
  collect(): ResourceMetrics {
    const mem = process.memoryUsage();
    
    const metrics: ResourceMetrics = {
      timestamp: Date.now(),
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rss: mem.rss,
      },
    };
    
    // CPU 使用（Node.js）
    if (process.cpuUsage) {
      const cpu = process.cpuUsage();
      metrics.cpu = {
        user: cpu.user,
        system: cpu.system,
      };
    }
    
    return metrics;
  }
  
  /** 采集快照（单次） */
  snapshot(): ResourceMetrics {
    return this.collect();
  }
}
```

### 1.3 埋点事件类型扩展

```typescript
// 扩展 AgentEventType

// 资源监控事件
'agent.resource',      // 周期性资源指标

// 详细耗时事件（可选，高频）
'llm.latency',         // LLM 调用延迟详情
'tool.latency',        // 工具调用延迟详情
```

---

## 2. 状态机标准化

### 2.1 六状态模型

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agent 状态机（6 状态）                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                          ┌─────────┐                            │
│                          │ pending │ ← 初始状态                  │
│                          └────┬────┘                            │
│                               │ run()                            │
│                               ▼                                  │
│  ┌─────────┐    pause()   ┌─────────┐    error                  │
│  │ paused  │ ←─────────── │ running │ ──────────────────────┐   │
│  └────┬────┘               └────┬────┘                      │   │
│       │                         │ complete()                 │   │
│       │ resume()                │ cancel()                   │   │
│       │                         │                            │   │
│       │         ┌───────────────┼───────────────┐            │   │
│       │         ▼               ▼               ▼            │   │
│       └─────────────────────────────────────────────────────┘│   │
│                         │                       │            │   │
│                         ▼                       ▼            ▼   │
│                   ┌──────────┐           ┌──────────┐    ┌───────┐│
│                   │completed │           │cancelled │    │ error ││
│                   └──────────┘           └──────────┘    └───────┘│
│                                                                  │
│  状态特性：                                                       │
│  - pending/running/paused：可转换                                 │
│  - completed/cancelled/error：终止态，不可转换                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 状态转换规则

```typescript
// src/core/state-machine.ts

export type AgentState = 
  | 'pending'    // 初始态，等待启动
  | 'running'    // 运行中
  | 'paused'     // 已暂停
  | 'completed'  // 正常结束
  | 'cancelled'  // 外部取消
  | 'error';     // 错误终止

export const StateTransitions: Record<AgentState, AgentState[]> = {
  pending:    ['running'],
  running:    ['paused', 'completed', 'cancelled', 'error'],
  paused:     ['running', 'cancelled'],
  completed:  [],  // 终止态
  cancelled:  [],  // 终止态
  error:      [],  // 终止态
};

export class StateMachine {
  private state: AgentState = 'pending';
  private stateSubject = new BehaviorSubject<AgentState>('pending');
  private transitionHooks: Map<string, StateTransitionHook[]> = new Map();
  
  get current(): AgentState {
    return this.state;
  }
  
  get state$(): Observable<AgentState> {
    return this.stateSubject.asObservable();
  }
  
  /** 尝试转换状态 */
  transition(newState: AgentState): boolean {
    const allowed = StateTransitions[this.state];
    
    if (!allowed.includes(newState)) {
      return false;  // 非法转换
    }
    
    const oldState = this.state;
    
    // 执行前置钩子
    this.executeHooks('before', oldState, newState);
    
    // 执行转换
    this.state = newState;
    this.stateSubject.next(newState);
    
    // 发出状态变更事件
    this.emitStateEvent(oldState, newState);
    
    // 执行后置钩子
    this.executeHooks('after', oldState, newState);
    
    return true;
  }
  
  /** 检查是否为终止态 */
  isTerminal(): boolean {
    return ['completed', 'cancelled', 'error'].includes(this.state);
  }
}

export interface StateTransitionHook {
  (phase: 'before' | 'after', from: AgentState, to: AgentState): void;
}
```

---

## 3. 配置热更新

### 3.1 响应式配置模式

```typescript
// src/config/runtime-config.ts

import { BehaviorSubject, Observable } from 'rxjs';

export class RuntimeConfig {
  private configSubject: BehaviorSubject<AgentConfig>;
  
  constructor(initialConfig: AgentConfig) {
    const validated = AgentConfigSchema.parse(initialConfig);
    this.configSubject = new BehaviorSubject(validated);
  }
  
  /** 配置流（响应式） */
  get config$(): Observable<AgentConfig> {
    return this.configSubject.asObservable();
  }
  
  /** 当前配置快照 */
  get current(): AgentConfig {
    return this.configSubject.value;
  }
  
  /** 更新配置（部分更新） */
  update(partial: Partial<AgentConfig>): void {
    const newConfig = AgentConfigSchema.parse({
      ...this.configSubject.value,
      ...partial,
    });
    this.configSubject.next(newConfig);
  }
  
  /** 监听特定字段变化 */
  watch<K extends keyof AgentConfig>(
    key: K,
  ): Observable<AgentConfig[K]> {
    return this.config$.pipe(
      map(config => config[key]),
      distinctUntilChanged(),
    );
  }
}
```

### 3.2 Agent 集成热更新

```typescript
// 使用示例
const agent = createAgent({ name: 'my-agent', timeout: 30000, ... });

// 运行时热更新
agent.onConfigChange('timeout', (newTimeout, oldTimeout) => {
  console.log(`Timeout changed: ${oldTimeout} → ${newTimeout}`);
});

// 修改配置
agent.updateConfig({ timeout: 60000 });  // 后续 run() 使用新值
```

---

## 4. 管道模板复用

### 4.1 问题背景

```typescript
// ❌ 当前：每次 run() 都重建管道
agent.run(input1).pipe(timeout(30000), retry(3), tracer());  // 建管道1
agent.run(input2).pipe(timeout(30000), retry(3), tracer());  // 建管道2（相同）

// 性能开销：
// - 每次创建新的 Operator 链
// - 闭包重复创建
// - GC 压力
```

### 4.2 管道模板模式

```typescript
// src/core/pipeline-template.ts

/** 管道模板 */
export interface PipelineTemplate<T, R> {
  /** 应用模板到源流 */
  apply(source: Observable<T>): Observable<R>;
  
  /** 组合另一个模板 */
  compose<RR>(other: PipelineTemplate<R, RR>): PipelineTemplate<T, RR>;
}

/** 创建管道模板 */
export function createPipeline<T, R>(
  ...operators: OperatorFunction<T, R>[]
): PipelineTemplate<T, R> {
  return {
    apply: (source) => operators.reduce((s, op) => op(s), source),
    
    compose: <RR>(other: PipelineTemplate<R, RR>): PipelineTemplate<T, RR> => ({
      apply: (source) => other.apply(operators.reduce((s, op) => op(s), source)),
      compose: undefined as never,
    }),
  };
}

/** 预定义管道模板 */
export const PipelineTemplates = {
  /** 标准生产管道 */
  production: <T>(config: {
    timeout?: number;
    retry?: number;
    tracer?: Tracer;
  } = {}) => createPipeline<T, T>(
    config.timeout ? timeout(config.timeout) : identity,
    config.retry ? retry(config.retry) : identity,
    config.tracer ? tapEvent(config.tracer) : identity,
  ),
  
  /** 调试管道 */
  debug: <T>() => createPipeline<T, T>(
    tap((event) => console.log('[DEBUG]', event)),
  ),
};
```

---

## 5. 上下文管理与压缩

### 5.1 分级记忆模型

```
┌─────────────────────────────────────────────────────────────────┐
│                      分级记忆架构                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Tier 0: 始终保留（Constitutional）                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • System Prompt                                          │    │
│  │ • 已加载的 constitutional/safety 类别 Skill              │    │
│  │ • 用户核心约束（不可丢弃）                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Tier 1: 近期窗口（Recent Window）                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • 最近 N 轮对话（默认 N=5）                                │    │
│  │ • 最近工具调用及结果                                       │    │
│  │ • 不压缩，保持完整性                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Tier 2: 压缩历史（Compressed History）                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • 总结摘要（LLM 生成）                                     │    │
│  │ • 关键决策记录（keyDecisions）                             │    │
│  │ • 保留的用户约束（preservedContext）                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 CompactionManager 设计

```typescript
// src/memory/compaction.ts

/**
 * 压缩策略类型
 */
export const CompactionStrategySchema = z.enum([
  'truncate-oldest',      // 简单截断（默认）
  'summarize',            // LLM 总结压缩（可选）
  'importance-weighted',  // 重要性加权（未来）
]);
export type CompactionStrategy = z.infer<typeof CompactionStrategySchema>;

/**
 * 压缩配置
 */
export const CompactionConfigSchema = z.object({
  /** 是否启用压缩 */
  enabled: z.boolean().default(true),
  
  /** 触发阈值（Token 百分比，默认 80%） */
  triggerThreshold: z.number().min(0.5).max(0.95).default(0.8),
  
  /** 压缩策略 */
  strategy: CompactionStrategySchema.default('truncate-oldest'),
  
  /** 保留配置 */
  preserve: z.object({
    systemPrompt: z.boolean().default(true),
    lastNUserMessages: z.number().int().min(1).default(5),
    lastNToolResults: z.number().int().min(0).default(10),
    constitutionalSkills: z.boolean().default(true),
  }).default({}),
});

export class CompactionManager {
  private config: CompactionConfig;
  
  constructor(config: Partial<CompactionConfig>) {
    this.config = CompactionConfigSchema.parse(config);
  }
  
  /**
   * 检查是否需要压缩
   */
  needsCompaction(context: CompactionContext): boolean {
    if (!this.config.enabled) return false;
    
    const threshold = this.config.triggerThreshold * context.maxTokens;
    return context.currentTokenEstimate >= threshold;
  }
  
  /**
   * 执行压缩
   */
  async compact(context: CompactionContext): Promise<CompactionResult> {
    // 实现压缩逻辑...
  }
}
```

### 5.3 与 Agent Loop 集成

```typescript
// 在 Agent 中集成 CompactionManager

class Agent {
  private compactionManager: CompactionManager;
  
  async handleLLMRequest(
    event: AgentEvent,
    state: AgentState,
  ): Promise<Observable<StepContext>> {
    let messages = state.messages;
    
    // 检查是否需要压缩
    const context: CompactionContext = {
      sessionId: this.sessionId,
      messages,
      currentTokenEstimate: this.estimateTokens(messages),
      maxTokens: this.config.maxContextTokens ?? 128000,
    };
    
    if (this.compactionManager.needsCompaction(context)) {
      // 发出压缩开始事件
      emitEvent({ type: 'compaction.start', ... });
      
      // 执行压缩
      const result = await this.compactionManager.compact(context);
      messages = result.messages;
      
      // 发出压缩完成事件
      emitEvent({
        type: 'compaction.complete',
        timestamp: Date.now(),
        sessionId: this.sessionId,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
      });
    }
    
    // 继续正常 LLM 请求流程...
  }
}
```

---

## 6. 设计约束清单

| 约束 | 描述 | 违反后果 |
|------|------|---------|
| **埋点全覆盖** | 所有核心路径必须有事件 | 盲区无法排查问题 |
| **状态机强制** | 所有状态变更通过 `StateMachine` | 状态混乱，难以追踪 |
| **热更新用 Observable** | 配置源必须是 `Observable<Config>` | 静态配置无法更新 |
| **管道模板复用** | 高频场景使用预构建模板 | 性能浪费、GC 压力 |
| **资源监控周期** | 内存监控间隔 ≤ 10s | 内存泄漏发现滞后 |
| **资源告警必设** | 生产环境必须配置内存告警 | OOM 时无预警 |
| **终止态不可逆** | completed/cancelled/error 不允许转换 | 状态机混乱 |

---

## 7. Agent 评估系统 (P2)

> 基于 LangSmith Evaluation、AgentScope Benchmark、DeepAgents Evaluation 的设计模式，实现 Agent 行为评估与质量保证。

### 7.1 设计动机

当前缺少评估能力：
- ❌ 无输出质量评估：不知道 Agent 输出是否满足要求
- ❌ 无轨迹分析：无法分析 Agent 行为路径
- ❌ 无基准对比：无法与历史版本对比性能
- ❌ 无离线评估：生产环境无法事后评估

### 7.2 IEvaluator 接口

```typescript
// src/evaluation/interfaces.ts

import { z } from 'zod';

/** 评估结果 */
export const EvaluationResultSchema = z.object({
  /** 评估 ID */
  evaluationId: z.string(),
  /** 会话 ID */
  sessionId: z.string(),
  /** 评估类型 */
  evaluatorType: z.string(),
  /** 评分 (0-1) */
  score: z.number().min(0).max(1),
  /** 是否通过阈值 */
  passed: z.boolean(),
  /** 评估注释 */
  comment: z.string().optional(),
  /** 详细指标 */
  metrics: z.record(z.string(), z.number()).optional(),
  /** 评估时间戳 */
  timestamp: z.number(),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

/** 评估上下文 */
export interface EvaluationContext {
  /** 会话 ID */
  sessionId: string;
  /** 完整事件轨迹 */
  events: AgentEvent[];
  /** 最终输出 */
  output: string;
  /** 用户输入 */
  input: string;
  /** 预期输出 (如果有) */
  expectedOutput?: string;
  /** 评估配置 */
  config: EvaluationConfig;
}

/** 评估器接口 */
export interface IEvaluator {
  /** 评估器名称 */
  name: string;
  
  /** 评估器类型 */
  type: EvaluatorType;
  
  /** 执行评估 */
  evaluate(ctx: EvaluationContext): Promise<EvaluationResult>;
  
  /** 获取评估阈值 */
  getThreshold(): number;
  
  /** 设置评估阈值 */
  setThreshold(threshold: number): void;
}

export type EvaluatorType = 
  | 'llm-judge'       // LLM 作为评判者
  | 'exact-match'     // 精确匹配
  | 'trajectory'      // 轨迹分析
  | 'custom';         // 自定义评估器
```

### 7.3 评估器实现

#### LLM-as-Judge 评估器

```typescript
// src/evaluation/llm-judge-evaluator.ts

export interface LLMJudgeConfig {
  /** 评判模型 */
  model: { provider: string; model: string };
  /** 评判 Prompt 模板 */
  promptTemplate: string;
  /** 评分解析规则 */
  scoreParser: 'numeric' | 'boolean' | 'scale-5';
  /** 通过阈值 */
  threshold: number;
}

const DEFAULT_JUDGE_PROMPT = `
You are an impartial evaluator. Evaluate the following agent output.

Input: {{input}}
Expected Output: {{expectedOutput}}
Actual Output: {{output}}

Evaluate on these criteria:
1. Accuracy (0-1): Does the output match the expected result?
2. Completeness (0-1): Is the output complete and comprehensive?
3. Quality (0-1): Is the output well-formatted and useful?

Provide a single numeric score between 0 and 1, where:
- 1.0 = Perfect, meets all criteria
- 0.7 = Good, meets most criteria
- 0.5 = Acceptable, meets some criteria
- 0.3 = Poor, meets few criteria
- 0.0 = Failed, does not meet any criteria

Output format: SCORE: [number]
COMMENT: [brief explanation]
`;

export class LLMJudgeEvaluator implements IEvaluator {
  name = 'LLM-Judge';
  type = 'llm-judge' as EvaluatorType;
  
  constructor(
    private llmAdapter: LLMAdapter,
    private config: LLMJudgeConfig
  ) {}
  
  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    const prompt = this.buildPrompt(ctx);
    
    const response = await this.llmAdapter.chat([
      { role: 'user', content: prompt },
    ]);
    
    const { score, comment } = this.parseResponse(response.content);
    
    return {
      evaluationId: `eval-${ctx.sessionId}-${Date.now()}`,
      sessionId: ctx.sessionId,
      evaluatorType: this.type,
      score,
      passed: score >= this.config.threshold,
      comment,
      timestamp: Date.now(),
    };
  }
  
  private buildPrompt(ctx: EvaluationContext): string {
    return this.config.promptTemplate
      .replace('{{input}}', ctx.input)
      .replace('{{expectedOutput}}', ctx.expectedOutput ?? 'N/A')
      .replace('{{output}}', ctx.output);
  }
  
  private parseResponse(content: string): { score: number; comment: string } {
    const scoreMatch = content.match(/SCORE:\s*([\d.]+)/);
    const commentMatch = content.match(/COMMENT:\s*(.+)/);
    
    return {
      score: scoreMatch ? parseFloat(scoreMatch[1]) : 0.5,
      comment: commentMatch?.[1]?.trim() ?? 'No comment provided',
    };
  }
  
  getThreshold(): number {
    return this.config.threshold;
  }
  
  setThreshold(threshold: number): void {
    this.config.threshold = threshold;
  }
}
```

#### 轨迹长度评估器

```typescript
// src/evaluation/trajectory-evaluator.ts

export interface TrajectoryConfig {
  /** 最大允许步数 */
  maxSteps: number;
  /** 最大允许工具调用数 */
  maxToolCalls: number;
  /** 最大允许 Token 消耗 */
  maxTokens: number;
  /** 通过阈值 */
  threshold: number;
}

export class TrajectoryLengthEvaluator implements IEvaluator {
  name = 'Trajectory-Length';
  type = 'trajectory' as EvaluatorType;
  
  constructor(private config: TrajectoryConfig) {}
  
  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    const metrics = this.extractMetrics(ctx.events);
    
    // 计算效率得分
    const stepScore = Math.min(1, metrics.totalSteps / this.config.maxSteps);
    const toolScore = Math.min(1, metrics.totalToolCalls / this.config.maxToolCalls);
    const tokenScore = Math.min(1, metrics.totalTokens / this.config.maxTokens);
    
    const score = (stepScore + toolScore + tokenScore) / 3;
    
    return {
      evaluationId: `eval-${ctx.sessionId}-${Date.now()}`,
      sessionId: ctx.sessionId,
      evaluatorType: this.type,
      score,
      passed: score >= this.config.threshold,
      comment: `Steps: ${metrics.totalSteps}, Tools: ${metrics.totalToolCalls}, Tokens: ${metrics.totalTokens}`,
      metrics: {
        steps: metrics.totalSteps,
        toolCalls: metrics.totalToolCalls,
        tokens: metrics.totalTokens,
        efficiency: score,
      },
      timestamp: Date.now(),
    };
  }
  
  private extractMetrics(events: AgentEvent[]): {
    totalSteps: number;
    totalToolCalls: number;
    totalTokens: number;
  } {
    let totalSteps = 0;
    let totalToolCalls = 0;
    let totalTokens = 0;
    
    for (const event of events) {
      if (event.type === 'agent.step') {
        totalSteps = Math.max(totalSteps, event.step);
      }
      if (event.type === 'tool.call') {
        totalToolCalls++;
      }
      if (event.type === 'llm.response' && event.usage) {
        totalTokens += event.usage.promptTokens + event.usage.completionTokens;
      }
    }
    
    return { totalSteps, totalToolCalls, totalTokens };
  }
  
  getThreshold(): number {
    return this.config.threshold;
  }
  
  setThreshold(threshold: number): void {
    this.config.threshold = threshold;
  }
}
```

#### 精确匹配评估器

```typescript
// src/evaluation/exact-match-evaluator.ts

export class ExactMatchEvaluator implements IEvaluator {
  name = 'Exact-Match';
  type = 'exact-match' as EvaluatorType;
  
  private threshold: number = 1.0;
  
  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    if (!ctx.expectedOutput) {
      return {
        evaluationId: `eval-${ctx.sessionId}-${Date.now()}`,
        sessionId: ctx.sessionId,
        evaluatorType: this.type,
        score: 0,
        passed: false,
        comment: 'No expected output provided for exact match evaluation',
        timestamp: Date.now(),
      };
    }
    
    // 简化比较：去除空白、标准化
    const normalizedOutput = this.normalize(ctx.output);
    const normalizedExpected = this.normalize(ctx.expectedOutput);
    
    const exactMatch = normalizedOutput === normalizedExpected;
    const score = exactMatch ? 1.0 : 0.0;
    
    return {
      evaluationId: `eval-${ctx.sessionId}-${Date.now()}`,
      sessionId: ctx.sessionId,
      evaluatorType: this.type,
      score,
      passed: exactMatch,
      comment: exactMatch 
        ? 'Output matches expected exactly'
        : `Output differs from expected. Expected: "${normalizedExpected.substring(0, 100)}..."`,
      timestamp: Date.now(),
    };
  }
  
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  getThreshold(): number {
    return this.threshold;
  }
  
  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }
}
```

### 7.4 评估事件类型

```typescript
// 扩展 AgentEventTypeSchema

// 🔴 P2 新增：评估事件
'evaluation.start',
'evaluation.result',

// 评估事件 Schema
z.object({
  type: z.literal('evaluation.start'),
  timestamp: z.number(),
  sessionId: z.string(),
  evaluators: z.array(z.string()),  // 使用的评估器列表
  config: EvaluationConfigSchema,
})

z.object({
  type: z.literal('evaluation.result'),
  timestamp: z.number(),
  sessionId: z.string(),
  result: EvaluationResultSchema,
})
```

### 7.5 离线与在线评估

```typescript
// src/evaluation/evaluation-manager.ts

export interface EvaluationConfig {
  /** 评估模式 */
  mode: 'online' | 'offline';
  /** 评估器列表 */
  evaluators: IEvaluator[];
  /** 是否记录详细轨迹 */
  recordTrajectory: boolean;
  /** 评估触发条件 */
  trigger: 'always' | 'on-complete' | 'manual';
}

export class EvaluationManager {
  private evaluators: Map<string, IEvaluator> = new Map();
  private resultsStore: EvaluationResultStore;
  
  /** 注册评估器 */
  registerEvaluator(evaluator: IEvaluator): void {
    this.evaluators.set(evaluator.name, evaluator);
  }
  
  /** 在线评估 (在 Agent 完成后自动触发) */
  async evaluateOnline(ctx: EvaluationContext): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];
    
    for (const evaluator of this.evaluators.values()) {
      const result = await evaluator.evaluate(ctx);
      results.push(result);
      await this.resultsStore.save(result);
    }
    
    return results;
  }
  
  /** 离线评估 (从历史数据评估) */
  async evaluateOffline(sessionId: string): Promise<EvaluationResult[]> {
    // 加载历史事件轨迹
    const events = await this.loadEvents(sessionId);
    const agentCompleteEvent = events.find(e => e.type === 'agent.complete');
    
    if (!agentCompleteEvent) {
      throw new Error(`No completed session found: ${sessionId}`);
    }
    
    const ctx: EvaluationContext = {
      sessionId,
      events,
      output: agentCompleteEvent.output,
      input: this.extractInput(events),
      config: { mode: 'offline', evaluators: [], recordTrajectory: true, trigger: 'manual' },
    };
    
    return this.evaluateOnline(ctx);
  }
  
  /** 获取评估报告 */
  async getReport(sessionId: string): Promise<EvaluationReport> {
    const results = await this.resultsStore.query({ sessionId });
    
    return {
      sessionId,
      overallScore: this.calculateOverall(results),
      passed: results.every(r => r.passed),
      results,
      timestamp: Date.now(),
    };
  }
}
```

### 7.6 与 Agent Loop 集成

```typescript
// src/loop/agent-loop.ts 扩展

// 在 agent.complete 后触发评估
if (event.type === 'agent.complete' && ctx.evaluation?.trigger === 'on-complete') {
  const evalCtx: EvaluationContext = {
    sessionId: ctx.sessionId,
    events: [...trajectoryEvents],
    output: event.output,
    input: originalInput,
    config: ctx.evaluation,
  };
  
  // 发出评估开始事件
  emitEvent({ type: 'evaluation.start', evaluators: ctx.evaluation.evaluators.map(e => e.name) });
  
  // 执行评估
  const results = await evaluationManager.evaluateOnline(evalCtx);
  
  // 发出评估结果事件
  for (const result of results) {
    emitEvent({ type: 'evaluation.result', result });
  }
}
```

### 7.7 评估配置示例

```typescript
// 创建 Agent 时配置评估
const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  evaluation: {
    mode: 'online',
    trigger: 'on-complete',
    evaluators: [
      new LLMJudgeEvaluator(llmAdapter, {
        model: { provider: 'openai', model: 'gpt-4o-mini' },
        promptTemplate: DEFAULT_JUDGE_PROMPT,
        threshold: 0.7,
      }),
      new TrajectoryLengthEvaluator({
        maxSteps: 10,
        maxToolCalls: 20,
        maxTokens: 50000,
        threshold: 0.8,
      }),
    ],
  },
});
```

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | 初始设计 - 全链路埋点、状态机、配置热更新、管道模板、压缩 |
| v2 | 2026-04-26 | **P2 新增**: Agent 评估系统 - LLM-as-Judge、轨迹分析、精确匹配、离线评估 |

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束
- [07-PLUGIN-SYSTEM.md](./07-PLUGIN-SYSTEM.md) - Hook + 插件系统
- [10-FEATURES.md](./10-FEATURES.md) - 特性实现
- [11-OPERATORS.md](./11-OPERATORS.md) - 操作符库
