# 安全模块设计

> 本文档定义 AgentForge Security 模块的架构设计。包含现状审计、威胁模型、5 个子系统设计、已决定的 5 个关键设计抉择，以及 3 个关键缺口的补强方案。
>
> 设计决策已通过评审确认（见第 8 节），关键缺口补强方案见第 9 节。

---

## 1. 现状审计

### 1.1 已定义但未执行的 Schema/接口

| 组件 | 位置 | 状态 |
|------|------|------|
| `ToolDefinition.requiresApproval` | `src/core/interfaces.ts:222` | ⚠️ 声明式字段，Agent Loop 从未检查 |
| `ToolDefinition.approvalMessage` | `src/core/interfaces.ts:227` | ⚠️ 声明式字段，从未使用 |
| `ToolDefinition.sandboxRequired` | `src/core/interfaces.ts:233` | ⚠️ 声明式字段，无沙箱实现 |
| `ToolDefinition.riskLevel` | `src/core/interfaces.ts:245` | ⚠️ 声明式字段，未被策略引擎引用 |
| `permission.prompt` 事件 | `src/core/events.ts:545-552` | ⚠️ Schema 已定义，Agent Loop 未路由 |
| `permission.decision` 事件 | `src/core/events.ts:554-560` | ⚠️ Schema 已定义，Agent Loop 未路由 |
| `ErrorCategory.permission_denied` | `src/core/interfaces.ts:604` | ⚠️ 枚举已定义，从未被使用 |
| `requirePermission()` 操作符 | `src/operators/control.ts:280-356` | ⚠️ 仅实现 deny，未实现 permission 交互流 |

### 1.2 已实现的防护

| 组件 | 位置 | 成熟度 |
|------|------|--------|
| Tier 1 合约校验 | `src/contracts/llm-contract.ts`, `mcp-contract.ts`, `user-input-contract.ts` | ✅ 成熟 — safeParse + 优雅降级 |
| errors-as-events 模式 | `src/loop/agent-loop.ts` 全局 | ✅ 成熟 — 所有错误转事件，永不崩溃 |
| HITL Observable 模式 | `src/core/context.ts:359-463` DefaultHITLController | ✅ 成熟 — ask() 返回 Observable，observeOn(asyncScheduler) 防死锁 |
| Plugin 上下文隔离 | `src/plugins/plugin.ts:18-45` | ✅ 成熟 — 禁止访问 llm/tools/memory/checkpoint |
| Plugin 校验 | `src/plugins/plugin.ts:178-195` Zod Schema | ✅ 成熟 — 第三方插件强烈校验 |
| QuotaController | `src/quota/quota-controller.ts` | ⚠️ 接口定义完整，但未集成到 Agent Loop |
| ResourceMonitor | `src/observability/resource-monitor.ts` | ⚠️ 仅资源监控，无安全功能 |

### 1.3 Agent Loop 安全盲区

```typescript
// 当前 handleToolCall 伪代码 (agent-loop.ts ~line 385-401)
function handleToolCall(state, event) {
  const tc = { id: event.toolCallId, name: event.toolName, args: event.args };
  
  // ❌ 缺少：requiresApproval 检查
  // ❌ 缺少：riskLevel 策略评估
  // ❌ 缺少：sandboxRequired 路由
  // ❌ 缺少：参数清洗/注入检测
  // ❌ 缺少：permission.prompt/decision 交互
  
  if (ctx.subagents?.has(event.toolName)) {
    return handleSubagentDelegation(tc, state, event);
  }
  return executeSingleTool(tc, state);  // 🚨 无任何安全检查直接执行
}
```

### 1.4 HITL 审批的 Ad-hoc 模式

```typescript
// 当前实现 (agent-loop.ts ~line 1033-1060)
// 工具实现者手动返回 "HITL_REQUIRED:" 前缀触发审批
if (result.startsWith('HITL_REQUIRED:') && ctx.hitl) {
  // 解析问题，发出 hitl.ask
}
```

**问题**：安全依赖工具实现者手动返回特定字符串，而非声明式的 `requiresApproval: true`。

---

## 2. 威胁模型 (OWASP Agentic Top 10 2026 映射)

| OWASP ID | 威胁 | AgentForge 攻击面 | 当前防护 |
|----------|------|-----------------|---------|
| ASI01 | Agent Goal Hijack | LLM 输出可调用任意注册工具 | ❌ 无意图验证 |
| ASI02 | Tool Misuse & Exploitation | `requiresApproval` 未执行 | ❌ 无防护 |
| ASI03 | Identity & Privilege Abuse | 无权限分级 | ❌ 无防护 |
| ASI05 | Unexpected Code Execution | `sandboxRequired` 未执行 | ❌ 无沙箱 |
| ASI06 | Memory/Context Poisoning | LLM 工具结果注入系统提示 | ⚠️ 部分 (Tier 1 校验) |
| ASI09 | Human-Agent Trust Exploitation | 高危操作无审批门控 | ❌ 无防护 |

---

## 3. 建议架构：5 个子系统

```
src/security/
├── permission/
│   ├── permission-controller.ts    # PermissionController 接口 + 默认实现
│   ├── permission-policy.ts        # 策略引擎 (riskLevel → allow/ask/deny)
│   ├── permission-guard.ts         # 工具执行前拦截器
│   └── index.ts
├── sanitization/
│   ├── input-sanitizer.ts          # Prompt 注入检测 + 清洗
│   ├── path-sanitizer.ts           # 路径遍历防护
│   ├── argument-validator.ts       # Zod + 语义检查
│   └── index.ts
├── audit/
│   ├── audit-logger.ts             # 追加式审计日志
│   ├── audit-store.ts              # 审计持久化接口
│   ├── integrity.ts                # Merkle 校验链
│   └── index.ts
├── sandbox/
│   ├── sandbox-executor.ts         # SandboxExecutor 接口
│   ├── sandbox-config.ts           # 沙箱配置 (文件系统/网络/资源)
│   ├── in-process-sandbox.ts       # 进程内沙箱 (默认)
│   └── index.ts
├── rate-limit/
│   ├── rate-limiter.ts             # 多维度限流
│   ├── rate-limit-store.ts         # 存储抽象
│   └── index.ts
└── index.ts                        # 统一导出
```

---

## 4. 子系统设计

### 4.1 Permission System (权限系统)

#### 设计原则

复用已有 `permission.prompt`/`permission.decision` 事件 Schema 和 HITL Observable 模式。

#### 核心接口

```typescript
// src/security/permission/permission-controller.ts

/**
 * 权限控制器 — 与 HITLController 同构
 *
 * 流：checkStart → autoAllow → permission.prompt → 外部UI → permission.decision → allow/deny
 */
export interface PermissionController {
  /** 请求权限 — 返回 Observable<PermissionDecision> */
  ask(options: PermissionAskOptions): Observable<PermissionDecision>;

  /** 订阅权限请求 (供 UI) */
  onAsk(): Observable<PermissionPrompt>;

  /** 回答权限请求 (供 UI 调用) */
  answer(promptId: string, decision: PermissionDecision): void;

  /** 检查权限是否自动允许 (缓存 allow_always) */
  isAutoAllowed(permission: string): boolean;

  /** 取消未决的权限请求 */
  cancel(promptId: string): void;
}

export type PermissionDecision = 'allow' | 'deny' | 'allow_always';

export interface PermissionAskOptions {
  promptId: string;
  permission: string;
  context?: Record<string, unknown>;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface PermissionPrompt {
  promptId: string;
  permission: string;
  context?: Record<string, unknown>;
  options: PermissionDecision[];
}
```

#### 策略引擎

```typescript
// src/security/permission/permission-policy.ts

export interface PermissionPolicy {
  /** 每个 riskLevel 的处置策略 */
  riskPolicies: Record<RiskLevel, 'allow' | 'ask' | 'deny'>;
  /** 默认策略 (未知工具) */
  defaultPolicy: 'allow' | 'ask' | 'deny';
  /** 工具级别策略 (覆盖 riskLevel) */
  toolPolicies: Record<string, 'allow' | 'ask' | 'deny'>;
  /** 是否强制检查 requiresApproval */
  enforceApprovalFlag: boolean;
}

export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  riskPolicies: {
    low: 'allow',
    medium: 'allow',
    high: 'ask',
    critical: 'deny',
  },
  defaultPolicy: 'ask',
  toolPolicies: {},
  enforceApprovalFlag: true,
};

export function evaluatePermission(
  tool: ToolDefinition,
  policy: PermissionPolicy
): 'allow' | 'ask' | 'deny' {
  // 1. 工具级别策略优先
  if (tool.name in policy.toolPolicies) {
    return policy.toolPolicies[tool.name];
  }

  // 2. requiresApproval 标志
  if (policy.enforceApprovalFlag && tool.requiresApproval) {
    return 'ask';
  }

  // 3. riskLevel 策略
  const level = tool.riskLevel ?? 'medium';
  return policy.riskPolicies[level] ?? policy.defaultPolicy;
}
```

#### Agent Loop 集成

```typescript
// 扩展后的事件路由：

tool.call
    │
    ├──► evaluatePermission(tool, policy)
    │         │
    │    ┌────┴────┐─────────┐
    │    │         │         │
    │   allow      ask      deny
    │    │         │         │
    │    ▼         ▼         ▼
    │  执行    permission   agent.error
    │          .prompt        │
    │            │           done
    │            ▼
    │      外部UI回答
    │            │
    │    permission.decision
    │         │      │
    │     allow    deny
    │      │        │
    │    执行    agent.error
    │             done
    │
    ├──► sandboxRequired?
    │         │
    │    是 → SandboxExecutor.execute()
    │    否 → 直接 executeSingleTool()
    │
    └──► 原有逻辑
```

```typescript
// agent-loop.ts 修改 — handleToolCall 增加权限检查
function handleToolCall(state, event) {
  const tc = { id: event.toolCallId, name: event.toolName, args: event.args };
  const tool = ctx.tools.get(tc.name);

  if (!tool) { /* 已有: tool 不存在处理 */ }

  // 🔒 NEW: 权限评估
  if (ctx.permissionPolicy && tool) {
    const decision = evaluatePermission(tool, ctx.permissionPolicy);

    switch (decision) {
      case 'deny':
        return handlePermissionDenied(tc, tool, state, event);
      case 'ask':
        return handlePermissionAsk(tc, tool, state, event);
      case 'allow':
        // 继续
        break;
    }
  }

  // 🔒 NEW: 沙箱检查
  if (tool?.sandboxRequired && ctx.sandboxExecutor) {
    return executeInSandbox(tc, tool, state);
  }

  // 原有逻辑
  if (ctx.subagents?.has(event.toolName)) {
    return handleSubagentDelegation(tc, state, event);
  }
  return executeSingleTool(tc, state);
}
```

```typescript
// handlePermissionAsk — 复用 HITL Observable 模式
function handlePermissionAsk(tc, tool, state, event) {
  if (!ctx.permissionController) {
    // fallback: deny
    return handlePermissionDenied(tc, tool, state, event);
  }

  return ctx.permissionController.ask({
    promptId: generateId('perm'),
    permission: tc.name,
    toolName: tc.name,
    toolArgs: tc.args,
    context: { riskLevel: tool.riskLevel, approvalMessage: tool.approvalMessage },
  }).pipe(
    observeOn(asyncScheduler),  // 同 HITL 防死锁
    mergeMap(decision => {
      const decisionEvent: AgentEvent = {
        type: 'permission.decision',
        timestamp: Date.now(),
        sessionId,
        promptId: generateId('perm'),
        decision,
      };

      if (decision === 'allow' || decision === 'allow_always') {
        // 允许 → 继续 tool 执行
        return from([
          { event: decisionEvent, state },
          ...stepWithToolCall(tc, state, event),
        ]);
      }

      // 拒绝 → agent.error + done
      const errorEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: { name: 'PermissionDeniedError', message: `Permission denied for tool: ${tc.name}` },
        step: state.step,
      };
      const doneEvent: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'error',
      };
      return from([
        { event: decisionEvent, state },
        { event: errorEvent, state },
        { event: doneEvent, state },
      ] as StepContext[]);
    }),
    catchError(error => from([
      { event: serializeToErrorEvent(error), state },
      { event: doneEvent, state },
    ] as StepContext[]))
  );
}
```

#### 默认实现

```typescript
// DefaultPermissionController — 同构于 DefaultHITLController
export class DefaultPermissionController implements PermissionController {
  private askSubject = new Subject<PermissionPrompt>();
  private answerMap = new Map<string, Subject<PermissionDecision>>();
  private autoAllowSet = new Set<string>();

  ask(options: PermissionAskOptions): Observable<PermissionDecision> {
    // 自动允许缓存
    if (this.isAutoAllowed(options.permission)) {
      return of('allow');
    }

    const answerSubject = new Subject<PermissionDecision>();
    this.answerMap.set(options.promptId, answerSubject);

    // 发出 prompt 事件
    this.askSubject.next({
      promptId: options.promptId,
      permission: options.permission,
      context: options.context,
      options: ['allow', 'deny', 'allow_always'],
    });

    return answerSubject.pipe(
      take(1),
      tap(decision => {
        if (decision === 'allow_always') {
          this.autoAllowSet.add(options.permission);
        }
        this.answerMap.delete(options.promptId);
      })
    );
  }

  answer(promptId: string, decision: PermissionDecision): void {
    const subject = this.answerMap.get(promptId);
    if (subject) {
      subject.next(decision);
      subject.complete();
    }
  }

  onAsk(): Observable<PermissionPrompt> {
    return this.askSubject.asObservable();
  }

  isAutoAllowed(permission: string): boolean {
    return this.autoAllowSet.has(permission);
  }

  cancel(promptId: string): void {
    const subject = this.answerMap.get(promptId);
    if (subject) {
      subject.error(new Error('Permission request cancelled'));
      this.answerMap.delete(promptId);
    }
  }
}
```

---

### 4.2 Input Sanitization (输入清洗)

#### Prompt 注入检测

```typescript
// src/security/sanitization/input-sanitizer.ts

export interface InputSanitizer {
  /** 检测 prompt 注入 */
  detectInjection(input: string): InjectionCheckResult;
  /** 清洗输入 */
  sanitize(input: string): string;
  /** 验证工具参数 */
  validateToolArgs(toolName: string, args: Record<string, unknown>): ValidationResult;
}

export interface InjectionCheckResult {
  isMalicious: boolean;
  confidence: number;    // 0-1
  patterns: string[];    // 匹配到的模式
  sanitizedInput: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  sanitized?: Record<string, unknown>;
}
```

#### 路径安全

```typescript
// src/security/sanitization/path-sanitizer.ts

export class PathSanitizer {
  constructor(
    private readonly workspaceRoot: string,
    private readonly deniedPatterns: RegExp[] = DEFAULT_DENIED_PATTERNS
  ) {}

  canAccess(path: string, mode: 'read' | 'write'): boolean {
    const resolved = pathLib.resolve(this.workspaceRoot, path);

    // 1. 必须在工作区内 (防路径遍历)
    if (!resolved.startsWith(this.workspaceRoot)) return false;

    // 2. 不能匹配敏感路径
    for (const pattern of this.deniedPatterns) {
      if (pattern.test(resolved)) return false;
    }

    return true;
  }
}

const DEFAULT_DENIED_PATTERNS = [
  /\.git\//,             // Git 内部
  /\.env(\.|$)/,         // 环境变量
  /secrets?\//i,         // 密钥目录
  /credentials?\//i,     // 认证文件
  /\.pem$/,              // 证书
  /\.key$/,              // 密钥
];
```

---

### 4.3 Audit Logging (审计日志)

#### 核心：追加式 + 观察器插件

```typescript
// src/security/audit/audit-logger.ts

export interface AuditEntry {
  timestamp: string;        // ISO 8601
  sessionId: string;
  agentName: string;
  eventType: AuditEventType;
  action: string;
  resource: string;
  result: 'success' | 'denied' | 'error';
  details: Record<string, unknown>;
}

export type AuditEventType =
  | 'permission.check'
  | 'permission.denied'
  | 'permission.granted'
  | 'tool.execute'
  | 'tool.error'
  | 'injection.detected'
  | 'rate.limited'
  | 'sandbox.violation';

export interface AuditLogger {
  /** 追加审计记录 (fire-and-forget，不阻塞事件流) */
  append(entry: Omit<AuditEntry, 'timestamp'>): void;
  /** 查询审计记录 */
  query(filter: AuditFilter): AuditEntry[];
  /** 完整性校验 */
  verifyIntegrity(): boolean;
}
```

#### 集成：作为 Observer Plugin

```typescript
// 审计日志作为 Observer Plugin，不阻塞主流程
export const auditPlugin: ObserverPlugin = {
  name: 'audit',
  type: 'observer',
  priority: 10,
  eventTypes: ['tool.call', 'tool.result', 'tool.error', 'permission.check',
               'permission.decision', 'agent.error'],
  enabled: true,
  observe(event, ctx) {
    auditLogger.append({
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      eventType: event.type as AuditEventType,
      action: event.type,
      resource: 'toolName' in event ? (event as any).toolName : 'unknown',
      result: event.type.endsWith('.error') ? 'error' : 'success',
      details: { ...event },
    });
  },
};
```

⚠️ **待定决策**：审计日志存储 — 内存数组 (默认) vs 抽象 AuditStore 接口 (可对接数据库/文件)？

---

### 4.4 Sandbox Execution (沙箱执行)

#### 接口设计

`SandboxExecutor` 接收**命令描述**（`{ tool, args }`）而非执行函数。

**设计理由**：进程内实现可以在内部调用 `tool.execute()`，但进程外实现（Worker / child_process）无法序列化函数。命令描述让接口不依赖执行方式，底层实现可替换。

```typescript
// src/security/sandbox/sandbox-executor.ts

export interface SandboxExecutor {
  /**
   * 在沙箱中执行工具。
   *
   * 接收命令描述而非 handler 函数，使接口不依赖执行环境。
   * InProcessSandbox 内部查找 tool.execute()，WorkerSandbox 序列化到子进程。
   */
  execute(
    command: SandboxCommand,
    ctx: SandboxContext
  ): Promise<SandboxResult>;
}

export interface SandboxCommand {
  /** 工具定义（从 ToolRegistry 查找） */
  toolName: string;
  /** 工具参数 */
  args: Record<string, unknown>;
}

export interface SandboxContext {
  /** 会话 ID */
  sessionId: string;
  /** 超时覆盖 */
  timeoutMs?: number;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 工具注册表（进程内实现使用） */
  toolRegistry?: ToolRegistry;
}

export interface SandboxConfig {
  filesystem: {
    allowedPaths: string[];
    deniedPaths: string[];
    readOnlyPaths: string[];
  };
  network: {
    allowedDomains: string[];
    deniedDomains: string[];
    allowOutbound: boolean;
  };
  compute: {
    maxCpuMs: number;
    maxMemoryMb: number;
    timeoutMs: number;
  };
}

export interface SandboxResult {
  success: boolean;
  result?: string;
  error?: SerializedError;
  durationMs: number;
  violations?: SandboxViolation[];
}

export type SandboxViolation =
  | { type: 'path_violation'; path: string; mode: 'read' | 'write' }
  | { type: 'network_violation'; domain: string }
  | { type: 'timeout'; timeoutMs: number }
  | { type: 'memory_violation'; memoryMb: number };
```

#### 默认实现：进程内沙箱

```typescript
// src/security/sandbox/in-process-sandbox.ts

export class InProcessSandboxExecutor implements SandboxExecutor {
  constructor(private readonly config: SandboxConfig) {}

  async execute(command: SandboxCommand, ctx: SandboxContext): Promise<SandboxResult> {
    const tool = ctx.toolRegistry?.get(command.toolName);
    if (!tool) {
      return {
        success: false,
        error: { name: 'ToolNotFoundError', message: `Tool not found: ${command.toolName}` },
        durationMs: 0,
      };
    }

    // 1. 参数清洗 (通过 ArgsSanitizer)
    // (在 handleToolCall 层已做，此处为二次校验)

    // 2. 超时执行
    const startTime = Date.now();
    try {
      const result = await this.withTimeout(
        tool.execute(command.args, { toolCallId: '', parentSessionId: ctx.sessionId }),
        ctx.timeoutMs ?? this.config.compute.timeoutMs
      );
      return { success: true, result, durationMs: Date.now() - startTime };
    } catch (error) {
      return { success: false, error: serializeError(error), durationMs: Date.now() - startTime };
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Sandbox timeout: ${ms}ms`)), ms)
      ),
    ]);
  }
}
```

> **已决定**：P2 先实现进程内沙箱（超时 + 基础限制）。接口接收命令描述而非 handler，方便后续升级到 Worker Thread / child_process 实现。

---

### 4.5 Rate Limiting (限流)

```typescript
// src/security/rate-limit/rate-limiter.ts

export interface RateLimiter {
  /** 检查请求是否允许 (不消耗配额) */
  check(key: string, config: RateLimitConfig): boolean;
  /** 记录一次消耗 */
  consume(key: string, config: RateLimitConfig): void;
  /** 重置限流窗口 */
  reset(key: string): void;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface MultiDimensionalRateLimit {
  perSession: RateLimitConfig;
  perTool: Record<string, RateLimitConfig>;
  global: RateLimitConfig;
  perToken: RateLimitConfig;
}
```

与现有 `QuotaController` 的关系：QuotaController 管 token/cost 限额，RateLimiter 管请求频率。两者互补，不重叠。

---

## 5. 与现有体系的集成兼容

| 现有模式 | Security 模块如何复用 |
|---------|---------------------|
| `HITLController` (Observable 模式) | `PermissionController` 同构 — `ask()` 返回 Observable |
| `ToolDefinition.riskLevel` | `PermissionPolicy.riskPolicies` 直接消费 |
| `ToolDefinition.requiresApproval` | `evaluatePermission()` 检查此字段 |
| `ToolDefinition.sandboxRequired` | `handleToolCall()` 路由到 SandboxExecutor |
| `permission.prompt/decision` 事件 | 已定义 Schema (events.ts:544-560)，直接使用 |
| Observer Plugin | Audit Logger 作为 Observer Plugin 实现 |
| Tier 1 合约 | 安全模块对外部输入使用 safeParse |
| errors-as-events | 安全拒绝都用 `agent.error` + `done` |
| AgentConfig.hitl.permissions | 策略引擎的配置来源之一 |
| AgentConfig.hitl.autoAllow | 权限控制器的 auto-allow 集合初始化 |

---

## 6. AgentContext 扩展

```typescript
// AgentContext 新增安全相关字段
export interface AgentContext {
  // ... 现有字段 ...

  /** 权限策略 (可选) */
  permissionPolicy?: PermissionPolicy;

  /** 权限控制器 (可选，同 HITL 模式) */
  permissionController?: PermissionController;

  /** 沙箱执行器 (可选) */
  sandboxExecutor?: SandboxExecutor;

  /** 审计日志器 (可选) */
  auditLogger?: AuditLogger;

  /** 限流器 (可选) */
  rateLimiter?: RateLimiter;

  /** 输入清洗器 (可选) */
  inputSanitizer?: InputSanitizer;
}
```

所有安全组件均 **可选注入** — 不配置则不拦截，零开销。

---

## 7. 实现优先级

| 优先级 | 子系统 | 预估工作量 | 生产必要性 | 理由 |
|--------|--------|-----------|----------|------|
| **P0-1** | Permission System | 3-4 天 | 🔴 阻塞 | `requiresApproval` 字段无效等于没有安全 |
| **P0-2** | Input Sanitizer | 2-3 天 | 🔴 阻塞 | Prompt 注入是 OWASP #1 威胁 |
| **P0-3** | Audit Logger | 2 天 | 🔴 阻塞 | 生产环境必须可审计 |
| **P1-1** | Path Sanitizer | 1-2 天 | 🟡 高 | 文件操作工具必须防护 |
| **P1-2** | Rate Limiter | 1-2 天 | 🟡 高 | 防止成本失控 |
| **P2-1** | Sandbox Executor | 3-5 天 | 🟢 中 | 进程内沙箱优先，进程外后续 |
| **P2-2** | Integrity Chain | 1 天 | 🟢 中 | 合规场景需要 |

**总预估**: P0 约 7-9 天，P0+P1 约 10-13 天，全部约 14-18 天。

---

## 8. 已决定的设计抉择

> 以下 5 个设计抉择经过评审确认，标注 ✅ 已决定。

### 8.1 权限交互模型：✅ 复用 HITL Observable 模式

**决定**：选项 A — `PermissionController` 与 `HITLController` 同构，`ask()` 返回 `Observable<PermissionDecision>`。

**理由**：核心不在代码风格，而在**并发语义**。Interceptor Plugin 基于 `concatMap`，能阻塞后续事件的通过，但无法主动"等待"一个外部异步信号。Permission 需要"暂停并等待人类决策"，这本质上是需要外部信号才能继续的 Observable。HITL 模式已验证可行：`Subject` 做信号桥接，UI 通过 `answer()` 往 Subject 推数据，流自动恢复。

**补充**：Permission 和 HITL 共享统一的底层对话通道（见第 9 节缺口 3）。

### 8.2 沙箱范围：✅ 进程内优先，接口接收命令描述

**决定**：P2 先实现进程内沙箱（超时 + AbortSignal），但 `SandboxExecutor` 接口接收 **命令描述**（`{ toolName, args }`）而非 `handler` 函数。

**理由**：接收 `handler: () => Promise<T>` 让工具代码在 Agent 进程里跑，进程外实现无法序列化函数。命令描述让接口不依赖执行方式——InProcessSandbox 内部查找 `tool.execute()`，后续 WorkerSandbox 序列化到子进程，调用方无感。

### 8.3 Prompt 注入检测：✅ 混合方案 + 安全降级

**决定**：选项 C — 分层防御：

| 层 | 策略 | 延迟 | 成本 |
|----|------|------|------|
| L1 | 正则 + 启发式规则 (typoglycemia 检测) | ~0ms | 0 |
| L2 | 语义模式匹配 (上下文指令检测) | ~0ms | 0 |
| L3 | 可选 LLM 二次判断 (仅高风险工具) | ~500ms | API 成本 |

**降级策略**：L3 LLM 判断失败时，默认采用更保守的策略 (`ask` 或 `deny`)，而非跳过检查。这确保安全不因检测服务故障而降级。

### 8.4 审计日志存储：✅ 内存默认 + AuditStore 接口抽象

**决定**：默认用内存数组实现 `AuditLogger`，但 `AuditStore` 接口在 P0 阶段就定义好。

**理由**：一旦核心逻辑（`handleToolCall`、`handlePermissionAsk`）调用了 `auditLogger.append()`，后续从内存切到文件/数据库只需换实现，不改核心代码。默认实现属于 `InMemoryAuditStore`，用户可注入自定义实现。

**重要设计声明**：Observer Plugin 模式的审计（fire-and-forget）接受**最终一致性**——Agent 崩溃时最后几条日志可能丢失。需要强一致性审计的场景（如金融合规），应切换到 Interceptor 模式审计插件（`concatMap`），牺牲性能换取每条记录都持久化后才继续。

### 8.5 模块边界：✅ `src/security/` 独立模块

**决定**：`src/security/` 独立模块，通过 DI 注入到 `AgentContext`。

**依赖约束**：`src/security/` **只依赖** `src/core/interfaces.ts` 中定义的抽象，不依赖 `src/loop/agent-loop.ts` 或其他业务模块。这确保安全模块可独立编译、独立测试、未来可独立发布。

---

## 9. 关键缺口补强

> 评审发现的 3 个关键缺口，必须在正式设计时补上。

### 9.1 执行期参数清洗 (Args Sanitization at Execution Time)

**问题**：`InputSanitizer` 处理用户输入，但**工具参数在执行前缺少清洗步骤**。一个参数可能通过了 Zod 类型校验（`args.city` 是 string），但包含 `../../etc/passwd`（路径遍历）或 `; rm -rf /`（命令注入）。

**方案**：在 `handleToolCall` 中，`tool.execute(args)` 调用**之前**，插入 `ArgsSanitizer` 步骤：

```typescript
// handleToolCall 中的执行管线 (扩展后)
function handleToolCall(state, event) {
  const tc = { id: event.toolCallId, name: event.toolName, args: event.args };
  const tool = ctx.tools.get(tc.name);

  // 🔒 Step 1: 权限评估
  // ... (见 4.1 节)

  // 🔒 Step 2: 参数清洗 (NEW)
  if (ctx.argsSanitizer) {
    const sanitized = ctx.argsSanitizer.sanitize(tc.name, tc.args);
    if (!sanitized.valid) {
      // 参数包含危险内容 → agent.error + done
      return handleArgsRejected(tc, sanitized, state, event);
    }
    tc.args = sanitized.sanitized; // 使用清洗后的参数
  }

  // 🔒 Step 3: 沙箱路由
  // ... (见 4.4 节)

  // Step 4: 原有执行
  return executeSingleTool(tc, state);
}
```

```typescript
// src/security/sanitization/argument-sanitizer.ts

export interface ArgsSanitizer {
  /**
   * 清洗工具参数。
   * 返回清洗后安全参数，或标记为危险并拒绝执行。
   */
  sanitize(toolName: string, args: Record<string, unknown>): ArgsSanitizeResult;
}

export interface ArgsSanitizeResult {
  valid: boolean;
  sanitized: Record<string, unknown>;
  violations?: ArgsViolation[];
}

export type ArgsViolation =
  | { type: 'path_traversal'; arg: string; value: string; pattern: string }
  | { type: 'command_injection'; arg: string; value: string; pattern: string }
  | { type: 'sql_injection'; arg: string; value: string; pattern: string }
  | { type: 'custom'; arg: string; value: string; reason: string };
```

**位置**：这是最后一道防线。Zod Schema 验证发生于 Tier 1 合约层（外到内），ArgsSanitizer 发生于执行前（内到外）。两层互补，不重叠。

### 9.2 审计日志一致性声明

**问题**：Observer Plugin 的 `observe()` 用 `tap` 实现，异常静默处理。这导致审计记录在极端崩溃场景下可能丢失。

**设计声明**（必须在文档中明确）：

```
AgentForge 审计一致性等级：

Level 1 (默认): 最终一致性
  - 实现: Observer Plugin (tap, fire-and-forget)
  - 保证: 正常运行时不丢失，进程崩溃可能丢失最后 N 条
  - 适用场景: 开发、测试、一般生产环境

Level 2 (可选): 强一致性
  - 实现: Interceptor Plugin (concatMap, 阻塞主流程)
  - 保证: 每条审计记录持久化后才继续执行
  - 代价: 每次工具调用多一次 I/O 延迟
  - 适用场景: 金融合规、医疗、法律等强审计场景
```

**配置方式**：

```typescript
// Level 1: 默认，零配置
const manager = new PluginManager();
manager.register(auditObserverPlugin);  // Observer，fire-and-forget

// Level 2: 强一致审计
const auditInterceptor = createAuditInterceptor(auditStore);  // Interceptor，阻塞主流程
manager.register(auditInterceptor);
```

### 9.3 Permission 和 HITL 统一对话通道

**问题**：`PermissionController` 和 `HITLController` 被设计为两个独立的、同构的控制器。但它们的 UI 订阅（`onAsk()`）和触发源完全独立。短时间内可能出现两个审批弹窗——一个 HITL 的，一个 Permission 的——问的可能是同一件事。

**方案**：让 `PermissionController` 和 `HITLController` 共享同一底层 **ApprovalChannel**（对话通道），上层 UI 统一管理审批队列。

```typescript
// src/core/approval-channel.ts

/**
 * 统一审批通道 — Permission 和 HITL 的共同底层。
 *
 * UI 订阅 onAsk() 获取所有审批请求，
 * 无论来自 HITL 还是 Permission，通过同一个队列管理。
 */
export interface ApprovalChannel {
  /** 请求审批 — HITL 和 Permission 共用此方法 */
  ask(options: ApprovalAskOptions): Observable<string>;

  /** 订阅审批请求 (供 UI) — 统一队列 */
  onAsk(): Observable<ApprovalPrompt>;

  /** 回答审批请求 (供 UI 调用) */
  answer(promptId: string, response: string): void;
}

export interface ApprovalAskOptions {
  promptId: string;
  /** 审批来源 */
  source: 'hitl' | 'permission';
  question: string;
  context?: Record<string, unknown>;
  options?: string[];
}
```

```typescript
// DefaultHITLController 和 DefaultPermissionController 都使用同一个 ApprovalChannel

export class DefaultHITLController implements HITLController {
  constructor(private readonly channel: ApprovalChannel) {}

  ask(options: HITLAskOptions): Observable<string> {
    return this.channel.ask({
      promptId: options.askId,
      source: 'hitl',
      question: options.question,
      context: { toolCallId: options.toolCallId, toolName: options.toolName },
      options: options.options,
    });
  }

  onAsk() {
    return this.channel.onAsk().pipe(
      filter(p => p.source === 'hitl'),
      map(p => ({ askId: p.promptId, question: p.question, options: p.options }))
    );
  }
}

export class DefaultPermissionController implements PermissionController {
  constructor(private readonly channel: ApprovalChannel) {}

  ask(options: PermissionAskOptions): Observable<PermissionDecision> {
    return this.channel.ask({
      promptId: options.promptId,
      source: 'permission',
      question: options.context?.approvalMessage ?? `Allow tool: ${options.permission}?`,
      context: options.context,
      options: ['allow', 'deny', 'allow_always'],
    }).pipe(
      map(response => response as PermissionDecision)
    );
  }

  onAsk() {
    return this.channel.onAsk().pipe(
      filter(p => p.source === 'permission'),
      map(p => ({ promptId: p.promptId, permission: p.question, context: p.context, options: p.options as PermissionDecision[] }))
    );
  }
}
```

**效果**：UI 只需订阅一个 `channel.onAsk()` 队列，统一处理所有审批请求，不会出现两个独立弹窗争夺焦点的问题。`source` 字段标记来源，UI 可以据此渲染不同样式（HITL 问题 vs 权限请求）。

---

## 10. 开放问题

> 已在评审中确认的决策见第 8 节，已补强的缺口见第 9 节。

1. **✅ PermissionController 与 HITLController** — 决定：共享底层 ApprovalChannel，见 9.3 节
2. **allow_always 的持久化** — 会话级 (`Set`) 还是跨会话持久化？默认会话级，跨会话需要 AuditStore 持久化
3. **✅ sandboxRequired 的粒度** — 决定：P2 进程内（超时+AbortSignal），接口接收命令描述方便升级
4. **限流维度** — 建议：同时限流 LLM API 调用和工具执行次数，但用不同配置 `perSession` vs `perTool`
5. **✅ 审计日志与 Plugin 系统** — 决定：默认 Observer (Level 1)，可选 Interceptor (Level 2)，见 9.2 节

---

## 11. 参考依据

- OWASP Top 10 for Agentic Applications 2026 (ASI01-ASI10)
- Anthropic "Trustworthy Agents" 研究 (5 原则: Human Control, Alignment, Security, Transparency, Privacy)
- OpenAI Guardrails 框架 (内置 prompt injection 检测、PII 检测)
- OWASP LLM Prompt Injection Prevention Cheat Sheet
- Zylos Research: "Indirect prompt injection is the dominant attack vector in tool-using agents"
- AgentForge 现有设计文档: 00-OVERVIEW, 06-FLOW-CONSTRAINTS, 07-PLUGIN-SYSTEM, 10-FEATURES