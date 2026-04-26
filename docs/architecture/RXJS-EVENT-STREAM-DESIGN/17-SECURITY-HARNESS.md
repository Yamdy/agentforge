# 安全架构设计 (Security Harness)

> 基于 `docs/harness.md` 规范，实现 AgentForge 的安全问题件。本设计遵循现有 RxJS 事件流架构，确保与核心设计哲学兼容。

---

## 一、设计原则

### 1.1 核心铁律兼容性

| 核心铁律 | 安全组件影响 | 兼容性 | 解决方案 |
|----------|-------------|--------|----------|
| **错误即事件** | 所有安全组件 | ✅ 完全兼容 | 失败发 `agent.error` + `done` |
| **Observable异步** | 所有安全组件 | ✅ 完全兼容 | `from(promise)` 包装 |
| **轻量DI** | 沙箱、配额 | ✅ 完全兼容 | 可选依赖注入 |
| **Hook横向切片** | PII、审批 | ✅ 完美契合 | InterceptorPlugin |
| **Observer只读** | 审计日志 | ✅ 完全兼容 | ObserverPlugin |
| **无重运行时** | 沙箱 | ⚠️ 需lazy load | 动态import延迟 |

### 1.2 Harness 六大核心模块映射

| Harness模块 | AgentForge模块 | 实现状态 |
|------------|----------------|----------|
| E-执行循环 | agent-loop.ts | ⚠️ 需扩展沙箱 |
| T-工具注册表 | ToolRegistry + 扩展 | ⚠️ 需添加权限标签 |
| C-上下文管理器 | memory/index.ts | ⚠️ 需改造索引架构 |
| S-状态存储 | checkpoint.ts | ⚠️ 需外部化 |
| L-生命周期钩子 | plugins/*.ts | ⚠️ 需补充审计/配额 |
| V-评估接口 | observability/*.ts | ⚠️ 需添加决策追溯 |

---

## 二、P0 安全组件设计

### 2.1 沙箱隔离架构 (Sandbox)

#### 技术选型: `isolated-vm`

| 对比项 | isolated-vm | worker_threads | node:vm |
|--------|-------------|----------------|---------|
| 真实隔离 | ✅ V8 Isolate | ⚠️ 进程级 | ❌ 不安全 |
| 内存限制 | ✅ `memoryLimit` | ⚠️ 不可靠 | ❌ 无 |
| Observable兼容 | ✅ 异步API | ⚠️ 消息传递 | ✅ 同步 |
| 启动延迟 | 低(~10ms) | 中(~50ms) | 极低 |

#### 接口定义

```typescript
// src/sandbox/interfaces.ts
import type { Observable } from 'rxjs';
import type { SerializedError } from '../core/events.js';

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
```

#### 核心实现模式

```typescript
// src/sandbox/isolated-vm-adapter.ts
import { Observable, from, of } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';
import { serializeError } from '../core/events.js';

// Lazy load - 不在启动时加载native addon
let _ivm: typeof import('isolated-vm') | null = null;

async function getIvm() {
  if (!_ivm) _ivm = await import('isolated-vm');
  return _ivm;
}

export class IsolatedVMAdapter implements SandboxAdapter {
  readonly name = 'isolated-vm';
  
  constructor(private config: SandboxConfig) {}
  
  execute<T>(code: string, context?: Record<string, unknown>): Observable<SandboxResult<T>> {
    return from(this.executeInIsolate<T>(code, context)).pipe(
      timeout(this.config.timeoutMs + 1000),
      catchError(error => of({
        success: false,
        error: serializeError(error),
        cpuTime: 0,
        wallTime: 0,
      }))
    );
  }
  
  private async executeInIsolate<T>(code: string, context?: Record<string, unknown>): Promise<SandboxResult<T>> {
    const ivm = await getIvm();
    const isolate = new ivm.Isolate({ memoryLimit: this.config.memoryLimitMb });
    
    try {
      const ctx = await isolate.createContext();
      
      // 注入上下文
      if (context) {
        for (const [key, value] of Object.entries(context)) {
          await ctx.global.set(key, new ivm.ExternalCopy(value).copyInto());
        }
      }
      
      const startTime = Date.now();
      const result = await ctx.eval(code, { 
        timeout: this.config.timeoutMs,
        promise: true 
      });
      
      return {
        success: true,
        value: result as T,
        cpuTime: isolate.cpuTime / 1_000_000,
        wallTime: Date.now() - startTime,
      };
    } finally {
      isolate.dispose();
    }
  }
  
  dispose(): void {
    // 清理资源
  }
}
```

#### AgentContext 集成

```typescript
// 扩展 AgentContext 接口
declare module '../core/context.js' {
  interface AgentContext {
    /** 沙箱执行器 (可选) */
    sandbox?: SandboxAdapter;
  }
}
```

#### 工具执行流程修改

```typescript
// src/loop/agent-loop.ts 中的工具执行修改

function executeSingleTool(tc: ToolCall, state: AgentState): Observable<StepContext> {
  const tool = ctx.tools.get(tc.name);
  
  // 检查是否需要沙箱执行
  if (tool?.sandboxRequired && ctx.sandbox) {
    return executeInSandbox(tc, state, tool);
  }
  
  // 普通工具直接执行
  return executeDirect(tc, state);
}

function executeInSandbox(tc: ToolCall, state: AgentState, tool: ToolDefinition): Observable<StepContext> {
  const sandboxCode = `
    (function() {
      return (${tool.execute.toString()})(JSON.parse(process.args));
    })()
  `;
  
  return ctx.sandbox!.execute<string>(sandboxCode, tc.args).pipe(
    mergeMap(result => {
      if (!result.success) {
        const errorEvent: AgentEvent = {
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId,
          error: result.error!,
        };
        return of({ event: errorEvent, state } as StepContext);
      }
      
      const resultEvent: AgentEvent = {
        type: 'tool.result',
        timestamp: Date.now(),
        sessionId,
        toolCallId: tc.id,
        toolName: tc.name,
        result: result.value!,
        isError: false,
      };
      return of({ event: resultEvent, state } as StepContext);
    })
  );
}
```

---

### 2.2 PII脱敏 + 审计日志 (PII & Audit)

#### 架构: 插件系统复用

```
Event Stream Pipeline:

  source$
    │
    ▼
  ┌─────────────────────────────┐
  │ PIIScrubberInterceptor      │  priority: 10
  │ (concatMap - 阻塞/修改)     │  修改事件内容
  └─────────────────────────────┘
    │
    ▼
  ┌─────────────────────────────┐
  │ ApprovalGateInterceptor     │  priority: 15
  │ (concatMap - 阻塞/控制)     │  审批危险工具
  └─────────────────────────────┘
    │
    ▼
  ┌─────────────────────────────┐
  │ 其他拦截器...               │  priority: 20-99
  └─────────────────────────────┘
    │
    ▼
  ┌─────────────────────────────┐
  │ AuditLogObserver            │  priority: 100
  │ (tap - 非阻塞/只读)         │  记录已脱敏数据
  └─────────────────────────────┘
    │
    ▼
  subscriber
```

#### PII脱敏器接口

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
```

#### 审计日志接口

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
```

#### PII脱敏插件实现

```typescript
// src/plugins/pii-scrubber-plugin.ts
import { of, Observable } from 'rxjs';
import type { InterceptorPlugin, PluginContext } from './plugin.js';
import type { AgentEvent } from '../core/events.js';
import type { PIIScrubber } from '../security/pii-scrubber.js';

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

#### 审计日志插件实现

```typescript
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

---

### 2.3 成本配额管控 (Quota)

#### 接口定义

```typescript
// src/quota/quota-controller.ts
import type { Observable } from 'rxjs';

/** 配额使用量 */
export interface QuotaUsage {
  promptTokens: number;
  completionTokens: number;
  totalCost?: number;  // 可选: 美元成本
}

/** 配额限制 */
export interface QuotaLimits {
  maxPromptTokens: number;
  maxCompletionTokens: number;
  maxTotalCost?: number;
}

/** 配额检查结果 */
export interface QuotaCheckResult {
  allowed: boolean;
  remaining: QuotaUsage;
  projectedUsage: QuotaUsage;
}

/** 配额耗尽事件 */
export interface QuotaExhaustedEvent {
  type: 'quota.exhausted';
  sessionId: string;
  reason: 'tokens' | 'cost';
  usage: QuotaUsage;
  limits: QuotaLimits;
}

/** 配额控制器接口 */
export interface QuotaController {
  /** 检查是否有足够配额 */
  check(sessionId: string, projected: QuotaUsage): Promise<QuotaCheckResult>;
  
  /** 消费配额 */
  consume(sessionId: string, usage: QuotaUsage): Promise<void>;
  
  /** 获取当前使用量 */
  getUsage(sessionId: string): Promise<QuotaUsage>;
  
  /** 获取限额配置 */
  getLimits(): QuotaLimits;
  
  /** 配额耗尽事件流 */
  onExhausted(): Observable<QuotaExhaustedEvent>;
  
  /** 重置会话使用量 */
  reset(sessionId: string): void;
}
```

#### AgentContext 集成

```typescript
// 扩展 AgentContext 接口
declare module '../core/context.js' {
  interface AgentContext {
    /** 配额控制器 (可选) */
    quota?: QuotaController;
  }
}
```

#### 集成位置

```typescript
// src/loop/agent-loop.ts 修改

function handleLLMRequest(state: AgentState): Observable<StepContext> {
  // NEW: 配额预检查
  if (ctx.quota) {
    const projectedTokens = estimatePromptTokens(state.messages);
    
    return from(ctx.quota.check(sessionId, {
      promptTokens: projectedTokens,
      completionTokens: 0,
    })).pipe(
      mergeMap(result => {
        if (!result.allowed) {
          // 配额耗尽 → agent.error + done (符合错误即事件铁律)
          const errorEvent: AgentEvent = {
            type: 'agent.error',
            timestamp: Date.now(),
            sessionId,
            error: {
              name: 'QuotaExhausted',
              message: `Token quota exhausted. Remaining: ${result.remaining.promptTokens}`,
            },
            step: state.step,
          };
          
          const doneEvent: AgentEvent = {
            type: 'done',
            timestamp: Date.now(),
            sessionId,
            reason: 'quota_exhausted',
          };
          
          return from([
            { event: errorEvent, state },
            { event: doneEvent, state },
          ] as StepContext[]);
        }
        
        // 配额充足 → 继续调用LLM
        return config.streaming ? callLLMStreaming(state) : callLLM(state);
      })
    );
  }
  
  // 无配额控制 → 直接调用
  return config.streaming ? callLLMStreaming(state) : callLLM(state);
}

// 在 llm.response 后消费配额
function callLLM(state: AgentState): Observable<StepContext> {
  return from(ctx.llm.chat(state.messages, llmOptions)).pipe(
    mergeMap(response => {
      // NEW: 消费配额 (fire-and-forget)
      if (ctx.quota && response.usage) {
        ctx.quota.consume(sessionId, {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
        }).catch(err => {
          console.warn('Quota consume failed:', err);
        });
      }
      
      // 现有响应处理...
      const responseEvent: AgentEvent = {
        type: 'llm.response',
        timestamp: Date.now(),
        sessionId,
        content: response.content,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason,
        usage: response.usage,
      };
      return of({ event: responseEvent, state } as StepContext);
    }),
    catchError(error => {
      // 现有错误处理...
    }),
  );
}
```

#### Token 预估工具

```typescript
// src/utils/token-estimate.ts

/** 估算消息的token数量 */
export function estimatePromptTokens(messages: Message[]): number {
  // 简化估算: 每4字符 ≈ 1 token (基于GPT tokenizer近似)
  let totalChars = 0;
  
  for (const msg of messages) {
    totalChars += msg.content.length;
    totalChars += 4;  // role 头部
    if (msg.name) totalChars += msg.name.length;
    if (msg.toolCallId) totalChars += msg.toolCallId.length;
  }
  
  return Math.ceil(totalChars / 4);
}

/** 估算单个文本的token数量 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

---

### 2.4 强制审批流程 (Approval Gate)

#### ToolDefinition 扩展

```typescript
// src/core/interfaces.ts 扩展

export interface ToolDefinition<TSchema = unknown> {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (args: unknown, ctx?: ToolContext) => Promise<string>;
  
  // NEW: 安全标记
  /** 是否需要审批 */
  requiresApproval?: boolean;
  /** 审批提示消息 */
  approvalMessage?: string;
  /** 是否需要沙箱执行 */
  sandboxRequired?: boolean;
  /** 风险等级 */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}
```

#### 审批拦截器实现

```typescript
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

---

## 三、安全事件类型扩展

### 3.1 新增事件 Schema

```typescript
// src/core/events.ts 添加

// 配额耗尽事件
export const QuotaExhaustedEventSchema = z.object({
  type: z.literal('quota.exhausted'),
  timestamp: z.number(),
  sessionId: z.string(),
  reason: z.enum(['tokens', 'cost']),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalCost: z.number().optional(),
  }),
  limits: z.object({
    maxPromptTokens: z.number(),
    maxCompletionTokens: z.number(),
    maxTotalCost: z.number().optional(),
  }),
});

// PII脱敏事件 (可选, 用于审计)
export const PIIScrubbedEventSchema = z.object({
  type: z.literal('pii.scrubbed'),
  timestamp: z.number(),
  sessionId: z.string(),
  sourceEventType: z.string(),
  fieldsScrubbed: z.array(z.string()),
  matchCount: z.number(),
});

// 审批决策事件
export const ApprovalDecisionEventSchema = z.object({
  type: z.literal('approval.decision'),
  timestamp: z.number(),
  sessionId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
});

// 沙箱执行事件
export const SandboxExecutionEventSchema = z.object({
  type: z.literal('sandbox.execute'),
  timestamp: z.number(),
  sessionId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  cpuTime: z.number(),
  wallTime: z.number(),
  memoryUsed: z.number().optional(),
  success: z.boolean(),
});
```

### 3.2 更新 AgentEventTypeSchema

```typescript
// 在 AgentEventTypeSchema 枚举中添加
export const AgentEventTypeSchema = z.enum([
  // ...existing types
  'quota.exhausted',
  'pii.scrubbed',
  'approval.decision',
  'sandbox.execute',
]);
```

---

## 四、生产预设配置

### 4.1 安全预设

```typescript
// src/operators/presets.ts 添加

import { PIIScrubberPlugin } from '../plugins/pii-scrubber-plugin.js';
import { AuditLogPlugin } from '../plugins/audit-log-plugin.js';
import { ApprovalGatePlugin } from '../plugins/approval-gate-plugin.js';

/** 生产环境安全预设 */
export function securityPreset(options: {
  piiScrubber: PIIScrubber;
  auditLog: AuditLogger;
  hitl: HITLController;
  getToolDef: (name: string) => ToolDefinition | undefined;
  quota?: QuotaController;
  sandbox?: SandboxAdapter;
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

/** 开发环境预设 (无安全限制) */
export function developmentPreset(): readonly Plugin[] {
  return [];
}

/** 合规预设 (严格安全) */
export function compliancePreset(options: {
  piiScrubber: PIIScrubber;
  auditLog: AuditLogger;
  hitl: HITLController;
  getToolDef: (name: string) => ToolDefinition | undefined;
  quota: QuotaController;
  sandbox: SandboxAdapter;
}): readonly Plugin[] {
  return [
    // P1: PII脱敏
    new PIIScrubberPlugin(options.piiScrubber),
    
    // P2: 强制审批 (所有工具)
    {
      ...new ApprovalGatePlugin(options.hitl, options.getToolDef),
      eventTypes: ['tool.call'],  // 拦截所有工具
    },
    
    // P3: 审计日志 (全量记录)
    new AuditLogPlugin(options.auditLog),
  ] as const;
}
```

---

## 五、使用示例

### 5.1 基础安全配置

```typescript
import { createAgentLoop } from './loop/agent-loop.js';
import { createAgentContext } from './api/context-builder.js';
import { PIIScrubberImpl } from './security/pii-scrubber.js';
import { AuditLogImpl } from './security/audit-log.js';
import { securityPreset } from './operators/presets.js';

const piiScrubber = new PIIScrubberImpl({
  enabledTypes: ['email', 'phone', 'ssn', 'api_key'],
  replacement: '[REDACTED]',
});

const auditLog = new AuditLogImpl({ storage: 'file', path: './audit.log' });

const ctx = createAgentContext({
  llm: openaiAdapter,
  tools: toolRegistry,
  plugins: securityPreset({
    piiScrubber,
    auditLog,
    hitl: hitlController,
    getToolDef: (name) => toolRegistry.get(name),
  }),
});

const agent = createAgentLoop(ctx, config);
agent.run('User query').subscribe(event => {
  if (event.type === 'agent.error') {
    console.error('Error:', event.error);
  }
});
```

### 5.2 完整合规配置

```typescript
import { IsolatedVMAdapter } from './sandbox/isolated-vm-adapter.js';
import { QuotaControllerImpl } from './quota/quota-controller.js';

const sandbox = new IsolatedVMAdapter({
  memoryLimitMb: 64,
  timeoutMs: 30000,
});

const quota = new QuotaControllerImpl({
  limits: {
    maxPromptTokens: 100000,
    maxCompletionTokens: 50000,
  },
});

const ctx = createAgentContext({
  llm: openaiAdapter,
  tools: toolRegistry,
  sandbox,
  quota,
  plugins: compliancePreset({
    piiScrubber,
    auditLog,
    hitl: hitlController,
    getToolDef: (name) => toolRegistry.get(name),
    quota,
    sandbox,
  }),
});
```

---

## 六、测试策略

### 6.1 沙箱隔离测试

```typescript
// tests/sandbox/isolated-vm-adapter.spec.ts
describe('IsolatedVMAdapter', () => {
  it('should isolate execution', async () => {
    const sandbox = new IsolatedVMAdapter({ memoryLimitMb: 16, timeoutMs: 5000 });
    const result = await firstValueFrom(sandbox.execute('return process.env.SECRET'));
    expect(result.success).toBe(false);  // process 不可访问
  });
  
  it('should enforce memory limit', async () => {
    const sandbox = new IsolatedVMAdapter({ memoryLimitMb: 4, timeoutMs: 5000 });
    const code = 'const arr = new Array(10_000_000); return arr.length;';
    const result = await firstValueFrom(sandbox.execute(code));
    expect(result.success).toBe(false);
    expect(result.error?.name).toBe('RangeError');
  });
  
  it('should enforce timeout', async () => {
    const sandbox = new IsolatedVMAdapter({ memoryLimitMb: 16, timeoutMs: 100 });
    const code = 'while(true) {}';
    const result = await firstValueFrom(sandbox.execute(code));
    expect(result.success).toBe(false);
  });
});
```

### 6.2 PII脱敏测试

```typescript
// tests/plugins/pii-scrubber-plugin.spec.ts
describe('PIIScrubberPlugin', () => {
  it('should scrub email addresses', () => {
    const plugin = new PIIScrubberPlugin(piiScrubber);
    const event = { type: 'llm.request', messages: [{ content: 'Email: test@example.com' }] };
    const result = plugin.intercept(event, ctx);
    expect(result.messages[0].content).toBe('Email: [REDACTED]');
  });
});
```

### 6.3 配额管控测试

```typescript
// tests/quota/quota-controller.spec.ts
describe('QuotaController', () => {
  it('should reject request when quota exhausted', async () => {
    const quota = new QuotaControllerImpl({ maxPromptTokens: 100 });
    quota.consume('session', { promptTokens: 100, completionTokens: 0 });
    
    const result = await quota.check('session', { promptTokens: 50, completionTokens: 0 });
    expect(result.allowed).toBe(false);
  });
});
```

---

## 七、相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [07-PLUGIN-SYSTEM.md](./07-PLUGIN-SYSTEM.md) - 插件系统设计
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层约束
- [14-OBSERVABILITY.md](./14-OBSERVABILITY.md) - 可观测性设计
- [../harness.md](../harness.md) - Harness 规范定义

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-26 | 初始设计 - 沙箱隔离/PII脱敏/配额管控/审批流程 |
