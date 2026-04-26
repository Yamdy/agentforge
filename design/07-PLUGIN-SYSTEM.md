# Hook + 插件系统

> 核心：Hook = 横向切片增强（操作符），DI = 纵向能力替换（接口实现），二者边界清晰不混用。

---

## 1. 架构定位

```
┌─────────────────────────────────────────────────────────────────┐
│                    两种扩展机制，两种方向                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  横向：Hook / 插件 = RxJS 操作符                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 观察事件流、变换事件流、但不替换底层能力                      │   │
│  │ 例子：日志、审计、限流、打点、加密                            │   │
│  │ 实现：tap / concatMap / mergeMap 操作符                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  纵向：DI 抽象 = 接口实现替换                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 替换底层能力，不改变流程                                    │   │
│  │ 例子：换 LLM、换 Memory、换 MCP 传输、换 A2A 协议           │   │
│  │ 实现：LLMAdapter / MemoryStore / MCPClient 接口            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  禁止混用：                                                      │
│  ❌ 插件里直接调用 LLM（应走 DI）                                │
│  ❌ LLMAdapter 里打日志（应走插件）                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 拦截器 vs 观察器

传统框架把「串行钩子 / 并行钩子」混在同一接口，靠配置区分。我们的架构用**两种本质不同的角色**，对应不同的 RxJS 操作符：

| 角色 | RxJS 操作符 | 阻塞主流程？ | 可修改事件？ | 异常处理 |
|------|-----------|------------|-----------|---------|
| **拦截器 (Interceptor)** | `concatMap` | ✅ 必须等结果 | ✅ 可修改/替换/阻断 | 降级透传原事件 |
| **观察器 (Observer)** | `tap` | ❌ 不阻塞 | ❌ 只读 | 仅记录，绝不阻断 |

```typescript
// ❌ 传统思维：两种钩子用同一个接口，靠配置区分串行/并行
interface Hook {
  type: 'serial' | 'parallel';
  handler: (event: AgentEvent) => Promise<void>;
}

// ✅ 我们的架构：两种本质不同的东西，不同操作符，不需要配置区分
// 拦截器：在管道内，可修改事件，阻塞主流程
type Interceptor = (event: AgentEvent, ctx: PluginContext) => Observable<AgentEvent>;

// 观察器：在管道旁，只读，不阻塞主流程
type Observer = (event: AgentEvent, ctx: PluginContext) => void | Promise<void>;
```

**使用场景对比**：

| 场景 | 角色 | 理由 |
|------|------|------|
| 权限校验 | 拦截器 | 必须等校验结果，可能阻断 |
| 记忆加载 | 拦截器 | 结果参与后续流程 |
| HITL 决策 | 拦截器 | 需要等待人工确认 |
| 限流 | 拦截器 | 需要延迟/拒绝请求 |
| 日志 | 观察器 | 副作用，不影响流程 |
| 打点 / Metrics | 观察器 | 副作用，不影响流程 |
| 审计 | 观察器 | 只读记录，不影响流程 |
| 通知 / Webhook | 观察器 | 副作用，不影响流程 |

---

## 3. 插件接口定义

```typescript
// src/plugins/plugin.ts

// ========== 插件基类 ==========

export interface Plugin {
  /** 插件名称（唯一标识） */
  name: string;
  
  /** 插件类型 */
  type: 'interceptor' | 'observer';
  
  /** 优先级（数字越小越靠前，默认 100） */
  priority: number;
  
  /** 订阅的事件类型（空数组 = 所有事件） */
  eventTypes: AgentEventType[];
  
  /** 是否启用 */
  enabled: boolean;
  
  /** 初始化（获取受限上下文） */
  init?(ctx: PluginContext): void | Promise<void>;
  
  /** 销毁（清理资源） */
  destroy?(): void;
}

// ========== 插件上下文（受限，防止越权） ==========

export interface PluginContext {
  /** 只读会话信息 */
  readonly sessionId: string;
  readonly agentName: string;
  
  /** 可观测性（插件可写打点，不可调 LLM） */
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
  
  // ⚠️ 注意：不给 llm、tools、memory 等核心能力
  // 插件不应直接调用 LLM / 执行工具 / 读写记忆
  // 这些能力走 DI 纵向替换，不走插件横向切片
}

// ========== 拦截器插件 ==========

export interface InterceptorPlugin extends Plugin {
  type: 'interceptor';
  
  /**
   * 拦截处理
   * - 可修改事件（返回新事件）
   * - 可阻断流程（返回 EMPTY）
   * - 可替换为其他事件（返回不同类型事件）
   * - 必须返回 Observable<AgentEvent>
   */
  intercept(event: AgentEvent, ctx: PluginContext): Observable<AgentEvent>;
}

// ========== 观察器插件 ==========

export interface ObserverPlugin extends Plugin {
  type: 'observer';
  
  /**
   * 观察回调
   * - 只读，返回值被忽略
   * - 可同步或异步
   * - 异常被捕获，不影响主流程
   */
  observe(event: AgentEvent, ctx: PluginContext): void | Promise<void>;
}

// ========== 第三方插件 Zod 校验 ==========

export const PluginSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['interceptor', 'observer']),
  priority: z.number().int().default(100),
  eventTypes: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

// 第三方插件强制校验（Tier 1 策略）
export function validatePlugin(raw: unknown): Plugin {
  return PluginSchema.parse(raw);
}
```

---

## 4. 钩子执行规则强约束

### 4.1 异常隔离

**原则**：单个插件报错，**不能拖垮整个 Agent 主循环**。

```typescript
// 拦截器异常：降级透传原事件
interceptor.intercept(event, ctx).pipe(
  catchError((err) => {
    // 记录错误
    ctx.tracer?.recordException('plugin-error', err);
    ctx.metrics?.increment('plugin.error', 1, { plugin: interceptor.name });
    // 降级：透传原事件，主流程不中断
    return of(event);
  }),
)

// 观察器异常：仅记录，绝不阻断
try {
  observer.observe(event, ctx);
} catch (err) {
  ctx.tracer?.recordException('plugin-error', err as Error);
  ctx.metrics?.increment('plugin.error', 1, { plugin: observer.name });
  // 不抛出，主流程继续
}
```

### 4.2 拦截器执行顺序

```
事件流方向 →
                                 拦截器管道
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  event ──→ [权限校验 P=10] ──→ [限流 P=20] ──→ [记忆加载 P=30] │
│              concatMap            concatMap         concatMap     │
│                                                                   │
│          拦截器按 priority 升序排列                                  │
│          每个 concatMap 必须完成才进入下一个                         │
│          任何一个返回 EMPTY = 阻断流程                               │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  event ──→ [日志 P=10] ──→ [打点 P=20] ──→ [审计 P=30]          │
│              tap              tap             tap                 │
│                                                                   │
│          观察器按 priority 升序排列                                  │
│          每个 tap 不阻塞，异常被吞                                    │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 异步观察器背压控制

观察器如果太慢（如远程日志服务），会积累背压，需要限制并发 + 降级：

```typescript
// ❌ 无限制：慢速观察器可能 OOM
tap((event) => this.remoteLogger.log(event))

// ✅ 限制并发 + 降级
// 异步观察器用 mergeMap 而非 tap，控制并发数
mergeMap(
  (event) => from(this.remoteLogger.log(event)).pipe(
    catchError((err) => {
      // 远程日志失败：降级到本地日志，不阻断
      console.error('Remote logger failed, falling back', err);
      return EMPTY;
    }),
  ),
  1,  // 最多 1 个在飞
),
```

---

## 5. 插件管道装配

```typescript
// src/plugins/pipeline.ts

export function buildPluginPipeline(
  source: Observable<AgentEvent>,
  plugins: Plugin[],
  ctx: PluginContext,
): Observable<AgentEvent> {
  
  // 分类 + 排序
  const interceptors = plugins
    .filter((p): p is InterceptorPlugin => p.type === 'interceptor' && p.enabled)
    .sort((a, b) => a.priority - b.priority);
  
  const observers = plugins
    .filter((p): p is ObserverPlugin => p.type === 'observer' && p.enabled)
    .sort((a, b) => a.priority - b.priority);
  
  // === 拦截器在前（管道内，concatMap 串行） ===
  let pipeline = source;
  for (const interceptor of interceptors) {
    pipeline = pipeline.pipe(
      // 事件类型过滤
      interceptor.eventTypes.length > 0
        ? concatMap((event) => {
            if (!interceptor.eventTypes.includes(event.type)) {
              return of(event);  // 不匹配，直接透传
            }
            return interceptor.intercept(event, ctx).pipe(
              // 异常隔离
              catchError((err) => {
                ctx.tracer?.recordException('plugin-error', err);
                ctx.metrics?.increment('plugin.error', 1, { plugin: interceptor.name });
                return of(event);  // 降级：透传原事件
              }),
            );
          })
        : concatMap((event) =>
            interceptor.intercept(event, ctx).pipe(
              catchError((err) => {
                ctx.tracer?.recordException('plugin-error', err);
                ctx.metrics?.increment('plugin.error', 1, { plugin: interceptor.name });
                return of(event);
              }),
            ),
          ),
    );
  }
  
  // === 观察器在后（管道旁，tap 不阻塞） ===
  for (const observer of observers) {
    pipeline = pipeline.pipe(
      tap((event) => {
        // 事件类型过滤
        if (observer.eventTypes.length > 0 && !observer.eventTypes.includes(event.type)) return;
        try {
          const result = observer.observe(event, ctx);
          // 如果是 Promise，不等待（观察器不应阻塞主流程）
          if (result instanceof Promise) {
            result.catch((err) => {
              ctx.tracer?.recordException('plugin-error', err);
              ctx.metrics?.increment('plugin.error', 1, { plugin: observer.name });
            });
          }
        } catch (err) {
          // 观察器异常：仅记录，绝不阻断
          ctx.tracer?.recordException('plugin-error', err as Error);
          ctx.metrics?.increment('plugin.error', 1, { plugin: observer.name });
        }
      }),
    );
  }
  
  return pipeline;
}
```

---

## 6. 插件生命周期管理

### 6.1 注册/卸载/启用/禁用

RxJS 管道一旦构建就不可变，不能动态摘除操作符。启用/禁用需要**条件操作符**模式：

```typescript
// src/plugins/plugin-manager.ts

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private pluginContext?: PluginContext;
  
  /** 注册插件 */
  register(plugin: Plugin): void {
    // 第三方插件强制 Zod 校验
    const validated = validatePlugin(plugin);
    if (this.plugins.has(validated.name)) {
      throw new Error(`Plugin "${validated.name}" already registered`);
    }
    this.plugins.set(validated.name, validated);
    
    // 初始化
    if (this.pluginContext && validated.init) {
      validated.init(this.pluginContext);
    }
  }
  
  /** 卸载插件 */
  unregister(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin?.destroy) plugin.destroy();
    this.plugins.delete(name);
  }
  
  /** 启用插件（需要重建管道才能生效） */
  enable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) plugin.enabled = true;
  }
  
  /** 禁用插件（需要重建管道才能生效） */
  disable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) plugin.enabled = false;
  }
  
  /** 获取启用的插件列表 */
  getActivePlugins(): Plugin[] {
    return [...this.plugins.values()].filter((p) => p.enabled);
  }
  
  /** 构建管道（每次插件状态变化后需调用） */
  buildPipeline(source: Observable<AgentEvent>, ctx: PluginContext): Observable<AgentEvent> {
    this.pluginContext = ctx;
    return buildPluginPipeline(source, this.getActivePlugins(), ctx);
  }
}
```

### 6.2 动态管道重建（可选高级模式）

需要频繁启用/禁用插件的场景，用 `switchMap` 动态重建管道：

```typescript
// src/plugins/dynamic-pipeline.ts

export class DynamicPluginPipeline {
  private plugins$ = new BehaviorSubject<Plugin[]>([]);
  
  /** 插件列表变化时自动重建管道 */
  connect(
    source: Observable<AgentEvent>,
    ctx: PluginContext,
  ): Observable<AgentEvent> {
    return this.plugins$.pipe(
      // 每次插件列表变化，重建管道
      switchMap((plugins) => {
        const active = plugins.filter((p) => p.enabled);
        return buildPluginPipeline(source, active, ctx);
      }),
    );
  }
  
  /** 更新插件列表（触发重建） */
  updatePlugins(plugins: Plugin[]): void {
    this.plugins$.next(plugins);
  }
}
```

> ⚠️ 注意：`switchMap` 重建会取消当前管道中的订阅。如果 Agent 正在执行 LLM 调用，中途重建会导致流中断。**生产环境建议使用静态管道**，只在 Agent 空闲时切换插件配置。

---

## 7. 统一插件上下文

框架层提供统一 PluginContext，所有插件共享 `traceId` / `agentId` / `roundId`：

```typescript
// src/plugins/plugin-context.ts

export interface PluginContext {
  // --- 会话身份 ---
  readonly sessionId: string;
  readonly agentName: string;
  
  // --- 可观测性 ---
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
  
  // --- 不提供的能力（防止越权） ---
  // ❌ llm: LLMAdapter          — 插件不应调 LLM
  // ❌ tools: ToolRegistry       — 插件不应执行工具
  // ❌ memory: MemoryStore       — 插件不应直接读写记忆
  // ❌ checkpoint: CheckpointStorage — 插件不应操作检查点
}

// 从 AgentContext 提取受限上下文
export function createPluginContext(ctx: AgentContext): PluginContext {
  return {
    sessionId: ctx.sessionId,
    agentName: ctx.agentName,
    tracer: ctx.services.tracer,
    metrics: ctx.services.metrics,
  };
}
```

---

## 8. 内置插件示例

```typescript
// ========== 日志插件（观察器） ==========
export const loggingPlugin: ObserverPlugin = {
  name: 'logging',
  type: 'observer',
  priority: 10,
  eventTypes: [],  // 所有事件
  enabled: true,
  
  observe(event: AgentEvent, ctx: PluginContext): void {
    switch (event.type) {
      case 'agent.start':
        console.log(`[${ctx.sessionId}] Agent started: ${event.agentName}`);
        break;
      case 'llm.response':
        console.log(`[${ctx.sessionId}] LLM responded: ${event.content.slice(0, 50)}...`);
        break;
      case 'tool.call':
        console.log(`[${ctx.sessionId}] Tool called: ${event.toolName}`);
        break;
      case 'agent.complete':
        console.log(`[${ctx.sessionId}] Agent completed in ${event.steps} steps`);
        break;
      case 'agent.error':
        console.error(`[${ctx.sessionId}] Agent error:`, event.error);
        break;
    }
  },
};

// ========== 权限校验插件（拦截器） ==========
export const permissionPlugin: InterceptorPlugin = {
  name: 'permission',
  type: 'interceptor',
  priority: 10,  // 最先执行
  eventTypes: ['tool.call'],
  enabled: true,
  
  intercept(event: AgentEvent, ctx: PluginContext): Observable<AgentEvent> {
    const call = event as Extract<AgentEvent, { type: 'tool.call' }>;
    
    // 危险工具列表
    const dangerousTools = ['bash', 'write', 'delete'];
    if (!dangerousTools.includes(call.toolName)) {
      return of(event);  // 非危险工具，直接透传
    }
    
    // 危险工具：发出 HITL 询问
    return of<AgentEvent>({
      type: 'hitl.ask',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      askId: generateId(),
      question: `Allow tool "${call.toolName}" with args ${JSON.stringify(call.args)}?`,
      options: ['allow', 'deny'],
    });
  },
};

// ========== 限流插件（拦截器） ==========
export const rateLimitPlugin: InterceptorPlugin = {
  name: 'rate-limit',
  type: 'interceptor',
  priority: 20,
  eventTypes: ['llm.request'],
  enabled: true,
  
  private lastCallTime = 0;
  private minInterval = 1000;  // 最小 1 秒间隔
  
  intercept(event: AgentEvent, ctx: PluginContext): Observable<AgentEvent> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    
    if (elapsed < this.minInterval) {
      // 限流：延迟发出
      return of(event).pipe(
        delay(this.minInterval - elapsed),
        tap(() => { this.lastCallTime = Date.now(); }),
      );
    }
    
    this.lastCallTime = now;
    return of(event);
  },
};

// ========== Metrics 插件（观察器） ==========
export const metricsPlugin: ObserverPlugin = {
  name: 'metrics',
  type: 'observer',
  priority: 20,
  eventTypes: [],
  enabled: true,
  
  observe(event: AgentEvent, ctx: PluginContext): void {
    if (!ctx.metrics) return;
    
    switch (event.type) {
      case 'llm.response':
        ctx.metrics.increment('llm.response.count');
        if (event.usage) {
          ctx.metrics.histogram('llm.tokens.prompt', event.usage.promptTokens);
          ctx.metrics.histogram('llm.tokens.completion', event.usage.completionTokens);
        }
        break;
      case 'tool.result':
        ctx.metrics.increment('tool.execution.count', 1, { tool: event.toolName });
        break;
      case 'agent.complete':
        ctx.metrics.histogram('agent.steps', event.steps);
        break;
      case 'agent.error':
        ctx.metrics.increment('agent.error.count');
        break;
    }
  },
};
```

---

## 9. 插件在 Agent 中的使用

```typescript
// 配置式（L2 API）
const agent = createAgent({
  name: 'my-agent',
  model: { provider: 'openai', model: 'gpt-4o' },
  plugins: [loggingPlugin, permissionPlugin, rateLimitPlugin, metricsPlugin],
});

// 编程式（L3 API）
agent.run(input).pipe(
  // 框架自动装配插件管道
  // 等价于手动：
  // concatMap(permissionIntercept),
  // concatMap(rateLimitIntercept),
  // tap(loggingObserver),
  // tap(metricsObserver),
);
```

---

## 10. 安全插件 (P0)

> 基于 Harness 规范，实现沙箱隔离、PII脱敏、审批流程、审计日志等安全能力。

### 10.1 安全插件架构

```
Event Stream Pipeline:

  source$
    │
    ▼
  ┌─────────────────────────────┐
  │ PIIScrubberPlugin           │  priority: 10
  │ (InterceptorPlugin)         │  脱敏敏感数据
  └─────────────────────────────┘
    │
    ▼
  ┌─────────────────────────────┐
  │ ApprovalGatePlugin          │  priority: 15
  │ (InterceptorPlugin)         │  审批危险工具
  └─────────────────────────────┘
    │
    ▼
  ┌─────────────────────────────┐
  │ 其他拦截器...               │  priority: 20-99
  └─────────────────────────────┘
    │
    ▼
  ┌─────────────────────────────┐
  │ AuditLogPlugin              │  priority: 100
  │ (ObserverPlugin)            │  记录已脱敏数据
  └─────────────────────────────┘
    │
    ▼
  subscriber
```

### 10.2 PII脱敏插件

```typescript
// src/security/pii-scrubber.ts

/** PII匹配类型 */
export type PIIMatchType = 
  | 'email' 
  | 'phone' 
  | 'ssn' 
  | 'credit_card' 
  | 'api_key' 
  | 'ip_address'
  | 'custom';

/** PII匹配信息 */
export interface PIIMatch {
  type: PIIMatchType;
  value: string;
  start: number;
  end: number;
  confidence: number;  // 置信度 0-1
}

/** PII脱敏器接口 */
export interface PIIScrubber {
  /** 检测PII */
  detect(text: string): PIIMatch[];
  /** 脱敏处理 */
  scrub(text: string): string;
}

/** PII脱敏配置 */
export interface PIIScrubberConfig {
  enabledTypes: PIIMatchType[];
  replacement: string;  // 默认 '[REDACTED]'
  customPatterns?: RegExp[];
  preserveLength?: boolean;  // 是否保留长度 [REDACTED****]
}

// src/plugins/pii-scrubber-plugin.ts
import { of, Observable } from 'rxjs';
import type { InterceptorPlugin, PluginContext } from './plugin.js';
import type { AgentEvent } from '../core/events.js';

export class PIIScrubberPlugin implements InterceptorPlugin {
  name = 'pii-scrubber';
  type = 'interceptor' as const;
  priority = 10;  // 最先执行
  eventTypes = ['llm.request', 'tool.call', 'tool.result', 'hitl.ask', 'hitl.answer'];
  enabled = true;
  
  constructor(private scrubber: PIIScrubber) {}
  
  intercept(event: AgentEvent, _ctx: PluginContext): Observable<AgentEvent> {
    const scrubbed = this.scrubEvent(event);
    return of(scrubbed);
  }
  
  private scrubEvent(event: AgentEvent): AgentEvent {
    switch (event.type) {
      case 'llm.request':
        return {
          ...event,
          messages: event.messages.map(m => ({
            ...m,
            content: this.scrubber.scrub(m.content),
          })),
        };
      case 'tool.call':
        return {
          ...event,
          args: this.scrubArgs(event.args),
        };
      case 'tool.result':
        return {
          ...event,
          result: this.scrubber.scrub(event.result),
        };
      case 'hitl.ask':
        return {
          ...event,
          question: this.scrubber.scrub(event.question),
        };
      case 'hitl.answer':
        return {
          ...event,
          answer: this.scrubber.scrub(event.answer),
        };
      default:
        return event;
    }
  }
  
  private scrubArgs(args: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        result[key] = this.scrubber.scrub(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.scrubArgs(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
```

### 10.3 审批门控插件

```typescript
// src/core/interfaces.ts 扩展

export interface ToolDefinition<TSchema = unknown> {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (args: unknown, ctx?: ToolContext) => Promise<string>;
  
  // 🔴 P0 新增: 安全标记
  /** 是否需要审批 */
  requiresApproval?: boolean;
  /** 审批提示消息 */
  approvalMessage?: string;
  /** 是否需要沙箱执行 */
  sandboxRequired?: boolean;
  /** 风险等级 */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

// src/plugins/approval-gate-plugin.ts
import { Observable, from, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import type { InterceptorPlugin, PluginContext } from './plugin.js';
import type { AgentEvent } from '../core/events.js';
import type { HITLController, ToolDefinition } from '../core/interfaces.js';

export class ApprovalGatePlugin implements InterceptorPlugin {
  name = 'approval-gate';
  type = 'interceptor' as const;
  priority = 15;  // PII脱敏后, 工具执行前
  eventTypes = ['tool.call'];
  enabled = true;
  
  constructor(
    private hitl: HITLController,
    private getToolDef: (name: string) => ToolDefinition | undefined
  ) {}
  
  intercept(event: AgentEvent, ctx: PluginContext): Observable<AgentEvent> {
    if (event.type !== 'tool.call') return of(event);
    
    const tool = this.getToolDef(event.toolName);
    if (!tool?.requiresApproval) {
      return of(event);  // 无需审批, 放行
    }
    
    // 需要审批 → 请求HITL
    const promptId = `approval-${event.toolCallId}`;
    
    return this.hitl.ask({
      askId: promptId,
      question: tool.approvalMessage ?? `Approve execution of tool "${event.toolName}"?`,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    }).pipe(
      mergeMap(answer => {
        const approved = this.isApproved(answer);
        
        if (approved) {
          return of(event);  // 放行原事件
        }
        
        // 拒绝 → agent.error + done (符合错误即事件铁律)
        return from([
          {
            type: 'agent.error',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            error: {
              name: 'ApprovalDenied',
              message: `Tool "${event.toolName}" execution denied by user`,
            },
          } as AgentEvent,
          {
            type: 'done',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            reason: 'error',
          } as AgentEvent,
        ]);
      })
    );
  }
  
  private isApproved(answer: string): boolean {
    const normalized = answer.toLowerCase().trim();
    return ['approve', 'approved', 'yes', 'y', 'ok', 'confirm'].includes(normalized);
  }
}
```

### 10.4 审计日志插件

```typescript
// src/security/audit-log.ts

/** 审计条目 */
export interface AuditEntry {
  timestamp: number;
  sessionId: string;
  agentName: string;
  eventType: string;
  actor: 'agent' | 'human' | 'system';
  action: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
  signature?: string;  // 可选防篡改签名
}

/** 审计查询过滤器 */
export interface AuditQueryFilter {
  sessionId?: string;
  agentName?: string;
  eventType?: string;
  startTime?: number;
  endTime?: number;
  actor?: 'agent' | 'human' | 'system';
}

/** 审计日志接口 (Append-Only) */
export interface AuditLogger {
  /** 追加审计条目 (不可修改/删除) */
  append(entry: AuditEntry): Promise<void>;
  /** 查询审计记录 */
  query(filter: AuditQueryFilter): Promise<AuditEntry[]>;
  /** 获取条目数量 */
  count(filter?: AuditQueryFilter): Promise<number>;
}

// src/plugins/audit-log-plugin.ts
import type { ObserverPlugin, PluginContext } from './plugin.js';
import type { AgentEvent } from '../core/events.js';
import type { AuditLogger } from '../security/audit-log.js';

export class AuditLogPlugin implements ObserverPlugin {
  name = 'audit-log';
  type = 'observer' as const;
  priority = 100;  // PII脱敏后执行
  eventTypes = [];  // 空数组 = 所有事件
  enabled = true;
  
  constructor(private auditLog: AuditLogger) {}
  
  observe(event: AgentEvent, ctx: PluginContext): void | Promise<void> {
    // Fire-and-forget, 不阻塞主流程
    const entry: AuditEntry = {
      timestamp: event.timestamp,
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      eventType: event.type,
      actor: this.detectActor(event),
      action: event.type,
      data: this.extractData(event),
    };
    
    // 异步写入, 不等待
    this.auditLog.append(entry).catch(err => {
      ctx.tracer?.recordException('audit-log-error', err);
    });
  }
  
  private detectActor(event: AgentEvent): 'agent' | 'human' | 'system' {
    if (event.type.startsWith('hitl.')) return 'human';
    if (['agent.start', 'agent.complete', 'done'].includes(event.type)) return 'system';
    return 'agent';
  }
  
  private extractData(event: AgentEvent): unknown {
    // 提取关键数据, 避免存储大对象
    const { type, timestamp, sessionId, ...data } = event;
    return data;
  }
}
```

### 10.5 沙箱隔离 (DI 纵向替换)

沙箱不是插件，而是通过 DI 注入的可选能力：

```typescript
// src/sandbox/interfaces.ts

/** 沙箱配置 */
export interface SandboxConfig {
  /** 内存限制 MB (默认: 64) */
  memoryLimitMb: number;
  /** 执行超时 ms (默认: 30000) */
  timeoutMs: number;
  /** 允许的API白名单 */
  allowedApis?: readonly string[];
}

/** 沙箱执行结果 */
export interface SandboxResult<T> {
  success: boolean;
  value?: T;
  error?: SerializedError;
  /** CPU时间 ms */
  cpuTime: number;
  /** 墙钟时间 ms */
  wallTime: number;
}

/** 沙箱适配器接口 */
export interface SandboxAdapter {
  readonly name: string;
  execute<T>(code: string, context?: Record<string, unknown>): Observable<SandboxResult<T>>;
  dispose(): void;
}

// AgentContext 扩展
declare module '../core/context.js' {
  interface AgentContext {
    /** 沙箱执行器 (可选) */
    sandbox?: SandboxAdapter;
  }
}

// 工具执行中使用沙箱
function executeSingleTool(tc: ToolCall, state: AgentState): Observable<StepContext> {
  const tool = ctx.tools.get(tc.name);
  
  // 检查是否需要沙箱执行
  if (tool?.sandboxRequired && ctx.sandbox) {
    return executeInSandbox(tc, state, tool);
  }
  
  // 普通工具直接执行
  return executeDirect(tc, state);
}
```

### 10.6 安全预设

```typescript
// src/operators/presets.ts

/** 生产环境安全预设 */
export function securityPreset(options: {
  piiScrubber: PIIScrubber;
  auditLog: AuditLogger;
  hitl: HITLController;
  getToolDef: (name: string) => ToolDefinition | undefined;
}): readonly Plugin[] {
  return [
    // P1: PII脱敏 (最先执行)
    new PIIScrubberPlugin(options.piiScrubber),
    
    // P2: 审批门控
    new ApprovalGatePlugin(options.hitl, options.getToolDef),
    
    // P3: 审计日志 (最后执行)
    new AuditLogPlugin(options.auditLog),
  ] as const;
}
```

---

## 11. 插件约束清单
|------|------|---------|
| **拦截器 vs 观察器严格区分** | 不可修改事件用观察器，可修改用拦截器 | 职责混乱，管道行为不可预测 |
| **拦截器异常降级** | `catchError` 透传原事件 | 单插件拖垮主循环 |
| **观察器异常静默** | `try/catch` 记录但不抛出 | 日志/打点失败阻断 Agent |
| **异步观察器限并发** | `mergeMap(fn, 1)` 或 fire-and-forget | 背压 OOM |
| **插件上下文受限** | 不给 `llm`/`tools`/`memory` | 插件越权调用 LLM，架构边界被打破 |
| **第三方插件 Zod 校验** | 注册时 `PluginSchema.parse()` | 恶意/错误插件破坏框架 |
| **静态管道优先** | 避免运行时动态重建 | Agent 执行中管道重建导致流中断 |
| **优先级 = 管道顺序** | 数字越小越靠前，拦截器在前观察器在后 | 权限校验在日志之后执行 = 安全漏洞 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | 初始设计 - 拦截器/观察器模式、插件管道 |
| v2 | 2026-04-26 | **P0 新增**: 安全插件 - PII脱敏/审批门控/审计日志/沙箱隔离 |

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [02-ZOD-CONTRACT.md](./02-ZOD-CONTRACT.md) - Zod 数据契约层
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束
- [10-FEATURES.md](./10-FEATURES.md) - 特性实现
- [11-OPERATORS.md](./11-OPERATORS.md) - 操作符库
- [14-OBSERVABILITY.md](./14-OBSERVABILITY.md) - 可观测 & 管控能力
