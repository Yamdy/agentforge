# P1-9/10/11: Extension System Merge, AgentContext Grouping, Public API Curation

> 日期: 2026-05-04
> 来源: analysis_cross_framework_review.md P1 项目

## P1-9: 合并 Plugin 和 Hook 系统

### 目标

5 种扩展机制 (Plugin, HookRegistry, CheckpointRegistry, EventEmitter.on, ToolHook) → 1 种 (Plugin)。

### 设计

**Plugin 成为唯一公共扩展 API**：

```typescript
interface Plugin {
  name: string;
  enabled: boolean;
  requestHooks?: RequestHook[];
  toolHooks?: ToolHook[];
  toolProviderHooks?: ToolProviderHook[];
  lifecycleHooks?: LifecycleHook[];
  checkpointHooks?: CheckpointHook[];     // 新增：阻断型检查点
  eventSubscriptions?: EventSubscription[];
  init?(ctx: PluginContext): void;
  destroy?(): void;
}
```

**CheckpointHook** (替代 CheckpointRegistry)：
```typescript
interface CheckpointHook {
  name: string;
  phase: LifecyclePhase;  // 'pre-llm' | 'post-llm'
  priority: number;
  check(ctx: AgentContext, state: AgentState, ...args: unknown[]): CheckpointResult | Promise<CheckpointResult>;
}
```

**变更清单**：
1. `Plugin` 接口新增 `checkpointHooks`
2. `HookRegistry` → 不导出，agent-loop 内部使用
3. `CheckpointRegistry` → 删除类，4 个内置检查点迁移为内置 Plugin
4. `EventEmitter` → 不导出，事件通过 Plugin.eventSubscriptions 订阅
5. `PluginManager` → 简化，保留生命周期管理
6. `Agent.on()` → 保留为便捷 API，内部创建临时 Plugin
7. 内置 Harness 检查点（quota/rate-limit/quality-gate/circuit-breaker）→ 迁移为 4 个内置 Plugin函数
8. `pipeline.ts`/`applyPlugins` → 拓展支持 checkpointHooks 注册

### Breaking Changes

- `import { HookRegistry } from 'agentforge'` → 不可用，使用 Plugin 替代
- `import { CheckpointRegistry } from 'agentforge'` → 不可用
- `emitter.on()` → 不可直接调用
- 所有直接使用 HookRegistry/CheckpointRegistry 的测试需更新

## P1-10: AgentContext 细分组

### 设计

42 个平级字段 → 8 个子对象：

```typescript
interface AgentContext {
  identity: { sessionId: string; agentName: string };
  core: { llm, tools, memory, pauseController, services, logger? };
  security: { permissionPolicy?, permissionController?, sandboxExecutor?,
              auditLogger?, inputSanitizer?, securityGuard? };
  controls: { hitl?, rateLimiter?, quota?, checkpoint?, abortSignal? };
  memory: { compactionManager?, workingMemory?, workingMemoryProcessor?, qualityGate? };
  resilience: { errorClassifier?, circuitBreaker?, autoRepairer?, onError? };
  extensions: { mcpClients?, subagents?, planner? };
  harness: { hookRegistry, checkpointRegistry };  // 内部，P1-9 消除 checkpointRegistry
}
```

### Breaking Changes

- `ctx.llm` → `ctx.core.llm`
- `ctx.hitl` → `ctx.controls.hitl`
- `ctx.compactionManager` → `ctx.memory.compactionManager`
- 所有内部使用 AgentContext 的代码需更新访问路径

## P1-11: 公共 API 策展

### 设计

- 主入口 `agentforge` 仅导出 ~60 个核心符号
- 子系统保留在子路径 (`agentforge/adapters`, `agentforge/plugins` 等)
- 内部实现（`InProcessSandboxExecutor`, `DefaultErrorClassifier` 等）移除出公共 API
- `AgentEventEmitter` 移除出公共导出

### 核心入口符号（~60）

```
createAgent, Agent, AgentConfig, NormalizedAgentConfig,
Plugin, RequestHook, ToolHook, ToolProviderHook, LifecycleHook,
CheckpointHook, EventSubscription,
AgentEvent, AgentEventType, Message, ToolCall, SerializedError,
isAgentEvent, isLLMEvent, isToolEvent, isTerminalEvent,
serializeError, generateId,
AgentState, createInitialState, updateState,
HookName, RequestHookPriority,
tool, TokenCounter, countTokens,
ContextBuilder, createApplicationServices,
// 内置插件工厂
createQuotaPlugin, createRateLimitPlugin, createQualityGatePlugin, createCircuitBreakerPlugin,
createMemoryPlugin, createSkillsPlugin, createSummarizationPlugin,
createTodoListPlugin, loggingPlugin, metricsPlugin,
// Compaction
CompactionManager, createCompactionManager,
// LLM
createLLMAdapter, parseModelSpec, LLMAdapterFactoryImpl,
// AgentLoop (高级)
createAgentLoop, AgentLoopConfig, AgentLoop,
```
