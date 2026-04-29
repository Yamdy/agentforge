---
## Goal

完成 AgentForge 框架的设计符合性审计和实现。基于 RxJS 事件流 + Zod 类型安全构建 Agent 框架底座，核心模式为 `Observable<AgentEvent>` + expand 递归。**Phase 0-2c 全部完成 ✅**

## Instructions

- 忽略现有实现，从需求出发重新设计
- 不使用 Effect-TS，保留 RxJS
- 暴露简单的配置式 API，底层 RxJS 可编程
- 采用 errors-as-events 设计：错误转换为事件而非抛出异常
- 使用 `from(promise).pipe(mergeMap(arr => from(arr)))` 模式处理异步
- Tier 1/2/3 校验分层：外部强校验+降级、跨模块 Schema 契约、内部仅 TypeScript 类型
- HITL 使用 Observable 模式实现 NEVER-blocking

## Discoveries

1. **RxJS expand 异步陷阱**：`expand` 中返回 `Promise` 会导致事件重复/丢失，必须用 `from(promise).pipe(mergeMap(...))` 模式
2. **errors-as-events 设计**：LLM/工具错误转换为 `agent.error` + `done` 事件
3. **Active vs Passive 事件**：只有 4 个 Active 事件触发下一步（agent.start, llm.response, tool.result, tool.batch.complete）
4. **LLM修复循环**：当 `llm.output.invalid` 发出后，检查 `repairAttempt >= maxLLMRepairAttempts` 决定终止还是重试
5. **HITL Observable 模式**：`ctx.hitl.ask()` 返回 `Observable<string>`，expand 订阅后自然暂停，外部 `answer()` 调用后恢复
6. **observeOn(asyncScheduler)**：避免同步死锁，确保 answer 在 Observable subscription 完全建立后才被处理

## Accomplished

### Phase 完成
- Phase 0: 原型验证 ✅ (9 tests)
- Phase 1: 核心类型 ✅ (134 tests)
- Phase 2a: Agent Loop 核心 ✅ (18 tests)
- Phase 2b: 健壮性增强 ✅ (6 tests)
- Phase 2c: 高级特性 ✅ (14 tests)

### 设计符合性审计完成
- Tier 1-3 Validation: ✅ 完全符合设计
- DI Interfaces: ✅ 完全符合设计
- Agent Loop: ✅ 修复了所有关键问题

### 审计修复完成
- P0-1: PromptBuilder + zodToFunctionDef ✅
- P0-2: Tier 1 校验函数 ✅
- P0-3: 事件路由补全 ✅
- P1-1: 状态机类 ✅
- P1-2: Checkpoint 接入事件流 ✅
- P1-3: HITL Observable 模式 ✅
- P1-4: 重入防护 ✅
- P2: 文档化扩展方法 ✅

### HITL Observable 架构重构（最新）
- **HITLController.ask()**: `Promise<string>` → `Observable<string>`
- **DefaultHITLController**: 使用 Subject 实现，`onAsk()` 供 UI 订阅，`answer()` 供外部调用
- **hitl.ask handler**: 订阅 Observable，用 `observeOn(asyncScheduler)` 避免死锁
- **executeSingleTool**: 移除 inline await，只 emit `hitl.ask` 事件
- **测试验证**: 使用真实 DefaultHITLController，模拟 UI 订阅 `onAsk()` 并异步调用 `answer()`

### 开发规范建设
- ESLint 配置 ✅
- Prettier 配置 ✅
- AGENTS.md 创建 ✅

### MCP 集成完成
- AgentForgeMCPClient ✅ — stdio/HTTP 双传输实现
- adaptMCPTools ✅ — JSON Schema → Zod 转换
- createAgent 接入 ✅ — 后台连接、工具发现、onStatusChange
- MCP Tier 1 校验 ✅ — mcp-contract.ts

### HTTP Server 完成
- packages/server/ ✅ — SSE 流式传输、Session 管理、Agent Factory
- handlers/ ✅ — sessions, agents, config, health
- middleware/ ✅ — auth, cors, error-handler, logger
- CLI ✅ — agentforge server 命令

### MPU 模块接线完成
- circuitBreaker ✅ — handlers/llm.ts
- rateLimiter ✅ — handlers/llm.ts
- inputSanitizer ✅ — handlers/llm.ts
- permissionPolicy ✅ — handlers/tool-execution.ts
- permissionController ✅ — handlers/tool-execution.ts
- sandboxExecutor ✅ — handlers/tool-execution.ts
- planner ✅ — handlers/lifecycle.ts (fire-and-forget)
- pluginPipeline ✅ — agent-loop.ts
- productionPreset ✅ — create-agent.ts
- errorClassifier ✅ — agent-loop.ts + handlers/llm.ts

### LLM 适配器完成
- OpenAI ✅ — @ai-sdk/openai
- Anthropic ✅ — @ai-sdk/anthropic
- Google ✅ — @ai-sdk/google
- Ollama ✅ — ai-sdk-ollama

### 开发体验增强完成
- 修复 wiring gap ✅ — createAgent() 现在正确消费 tracing/metrics 配置
- development preset ✅ — ConsoleTracer + ConsoleMetrics + developmentPreset operator
- L1 扩展 ✅ — L1AgentConfigSchema 支持 development preset + tracing/metrics 字段
- 优先级链 ✅ — 显式配置 > preset 默认值 > 全局默认值

### 当前验证状态
- TypeScript: ✅ 编译干净
- ESLint: ✅ 0 errors
- Tests: ✅ 1742 passed (73 test files)

## Relevant files / directories

```
src/
├── core/
│   ├── events.ts          # 50+ Zod 事件 Schema
│   ├── state.ts           # AgentState + 不可变更新
│   ├── checkpoint.ts      # Checkpoint 序列化/恢复
│   ├── interfaces.ts      # DI 接口 (28 个)
│   ├── context.ts         # ApplicationServices/AgentContext/DefaultHITLController
│   ├── context-builder.ts # ContextBuilder 流式 DI
│   ├── state-machine.ts   # 6 状态机
│   ├── prompt-builder.ts  # Prompt 构建
│   ├── zod-to-schema.ts   # Zod → JSON Schema
│   └── index.ts           # 公共 API 导出
├── loop/
│   └── agent-loop.ts      # 核心 expand 递归 Loop
├── contracts/
│   ├── llm-contract.ts    # Tier 1 LLM 校验+降级
│   ├── mcp-contract.ts    # Tier 1 MCP 校验+降级
│   └── user-input-contract.ts
└── operators/
    └── index.ts           # 自定义 RxJS 操作符

tests/
├── core/        # 251 tests
├── loop/        # 46 tests
├── contracts/   # 59 tests
└── *.spec.ts    # 9 tests (Phase 0)

docs/architecture/
└── RXJS-EVENT-STREAM-DESIGN.md  # 设计文档 (~9000 行)

.sisyphus/plans/
└── AUDIT-FIX-PLAN.md  # 审计修复计划
```

---

## Event Routing (Active Events)

```
agent.start → agent.step + llm.request
llm.request → callLLM() → llm.response
llm.response → tool.call[] or agent.complete
tool.call → tool.execute + tool.result
tool.result → agent.step + llm.request (loop)
llm.output.invalid → retry or agent.error (repair loop)
hitl.ask → Observable subscription (NEVER-blocking until answer)
```

---

## Remaining Tasks

1. ~~**3 个缺失操作符**~~ — ✅ 已实现（`filterEventType`, `takeUntilTerminal`, `collectMetrics` 在 `src/operators/index.ts`）
2. ~~**DefaultSandboxExecutor**~~ — ✅ 已实现（`InProcessSandboxExecutor` 在 `src/security/sandbox/in-process-sandbox.ts`）
3. ~~**MemoryQuotaController**~~ — ✅ 已实现（`MemoryQuotaController` 在 `src/quota/memory-quota-controller.ts`）
4. ~~**SubAgent 事件路由**~~ — ✅ 已实现（`src/subagent/orchestrator.ts` + transparent expand passthrough）
5. ~~**Workflow/Pipeline**~~ — ✅ 已实现（`SequentialPipeline`, `ParallelPipeline` 在 `src/workflow/pipeline.ts`）
6. ~~**Tracer 默认实现**~~ — ✅ 已实现（`NoopTracer` + `ConsoleTracer` 在 `src/core/defaults.ts`）
7. ~~**Metrics 默认实现**~~ — ✅ 已实现（`NoopMetrics` + `ConsoleMetrics` + `BridgeMetrics` 在 `src/core/defaults.ts`）
8. ~~**ctx.logger 接线**~~ — ✅ 已完成（handlers 中 `console.error/warn` → `ctx.logger?.error/warn`）
9. ~~**Wiring Gap 修复**~~ — ✅ 已完成（createAgent() 正确消费 tracing/metrics 配置）
10. ~~**Development Preset**~~ — ✅ 已完成（ConsoleTracer + ConsoleMetrics + developmentPreset operator）
11. **Planner Phase 2** — 计划结果注入 AgentState（低优先级，非核心循环）

### 当前验证状态
- TypeScript: ✅ 编译干净
- ESLint: ✅ 0 errors
- Tests: ✅ 1726 passed (72 test files)

---

## Key Design Decisions

### HITL Observable Pattern
```typescript
// DefaultHITLController
class DefaultHITLController implements HITLController {
  private askSubject = new Subject<{askId, question, ...}>();
  private pendingAsks = new Map<string, Subject<string>>();

  ask(options: HITLAskOptions): Observable<string> {
    return new Observable(subscriber => {
      const answerSubject = new Subject<string>();
      this.pendingAsks.set(options.askId, answerSubject);
      this.askSubject.next({ askId, question, ... });
      answerSubject.subscribe(answer => {
        subscriber.next(answer);
        subscriber.complete();
      });
    });
  }

  onAsk() { return this.askSubject.asObservable(); }
  
  answer(askId: string, answer: string) {
    this.pendingAsks.get(askId)?.next(answer);
    this.pendingAsks.delete(askId);
  }
}

// hitl.ask handler in agent-loop.ts
function handleHITLAsk(state, event) {
  return ctx.hitl.ask({...}).pipe(
    observeOn(asyncScheduler),  // 避免同步死锁
    mergeMap(answer => from([
      { event: hitlAnswerEvent, state },
      { event: toolResultEvent, state },
    ]))
  );
}
```

### UI Integration
```typescript
// UI 订阅 onAsk()，调用 answer()
const hitlController = new DefaultHITLController();
hitlController.onAsk().subscribe(ask => {
  const answer = await showUserDialog(ask.question);
  hitlController.answer(ask.askId, answer);
});
```
