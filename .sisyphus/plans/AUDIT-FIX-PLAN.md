# AgentForge 设计符合性修复计划

> 基于 Phase 0/1/2 审计报告
> 创建时间: 2026-04-25
> 状态: 待执行

---

## 优先级总览

| 优先级 | 问题数量 | 阻塞性 | 预估工作量 |
|--------|---------|--------|-----------|
| 🔴 P0 | 3 | 是 | 2-3 天 |
| 🟡 P1 | 4 | 否 | 3-4 天 |
| 🟢 P2 | 3 | 否 | 1-2 天 |

---

## 🔴 P0: 阻塞性问题

### P0-1: 实现 PromptBuilder + Zod → FunctionDefinition 转换

**问题**：设计文档明确要求 PromptBuilder 模块，用于构建 LLM system prompt 和将 Zod schema 转换为 JSON Schema 工具定义。当前完全缺失。

**影响**：无法构建正确的 LLM 调用参数，工具定义不完整。

**解决方案**：

```
src/
├── core/
│   ├── prompt-builder.ts     # PromptBuilder 接口 + 实现
│   └── zod-to-schema.ts      # Zod → JSON Schema 转换
└── tests/
    └── core/
        ├── prompt-builder.spec.ts
        └── zod-to-schema.spec.ts
```

**实现步骤**：

1. **创建 `src/core/zod-to-schema.ts`**
   ```typescript
   // 核心函数
   export function zodToFunctionDef<T extends z.ZodTypeAny>(
     name: string,
     description: string,
     schema: T,
   ): FunctionDefinition;
   
   // 辅助函数
   export function zodToJsonSchema(zodSchema: z.ZodTypeAny): Record<string, unknown>;
   ```

2. **创建 `src/core/prompt-builder.ts`**
   ```typescript
   export interface PromptBuilder {
     build(
       history: Message[],
       input: string,
       tools: ToolDefinition[],
       options?: PromptBuildOptions,
     ): BuiltPrompt;
   }
   
   export interface BuiltPrompt {
     messages: Message[];
     tools: FunctionDefinition[];
     tokenEstimate: number;
   }
   
   export class DefaultPromptBuilder implements PromptBuilder {
     // 实现 build() 方法
     // - 注入 system prompt
     // - 转换 Zod tool schemas
     // - 估算 token
   }
   ```

3. **更新 `src/core/interfaces.ts`**
   - 添加 `PromptBuilder` 接口导出
   - 添加 `ToolDefinition` 的 Zod 泛型支持

4. **更新 `src/core/index.ts`**
   - 导出 PromptBuilder 相关类型

**验证方法**：
```bash
npx vitest run tests/core/prompt-builder.spec.ts
npx vitest run tests/core/zod-to-schema.spec.ts
npx tsc --noEmit
```

**依赖**：无

**预估工作量**：1 天

---

### P0-2: 实现 Tier 1 校验函数

**问题**：设计文档要求 LLM/MCP/用户输入必须经过 Tier 1 校验，失败时降级而非崩溃。当前只有 Schema 定义，无降级兜底逻辑。

**影响**：LLM 返回格式错误时，Agent 直接崩溃，无法恢复。

**解决方案**：

```
src/
├── contracts/
│   ├── index.ts              # 导出所有契约
│   ├── llm-contract.ts       # LLM 响应校验
│   ├── mcp-contract.ts       # MCP 响应校验
│   └── user-input-contract.ts # 用户输入校验
└── tests/
    └── contracts/
        ├── llm-contract.spec.ts
        ├── mcp-contract.spec.ts
        └── user-input-contract.spec.ts
```

**实现步骤**：

1. **创建 `src/contracts/llm-contract.ts`**
   ```typescript
   export const LLMResponseSchema = z.object({
     content: z.string(),
     toolCalls: z.array(ToolCallSchema).optional(),
     finishReason: FinishReasonSchema,
     usage: LLMUsageSchema.optional(),
   });
   
   /**
    * Tier 1 校验：safeParse + fallback 降级
    * - 校验失败时提取可用字段，不崩溃
    */
   export function validateLLMResponse(raw: unknown): LLMResponse {
     const result = LLMResponseSchema.safeParse(raw);
     if (result.success) return result.data;
     
     // 降级：提取可用字段
     const obj = (raw ?? {}) as Record<string, unknown>;
     return {
       content: typeof obj.content === 'string' ? obj.content : '',
       toolCalls: extractToolCalls(obj.toolCalls ?? obj.tool_calls),
       finishReason: extractFinishReason(obj.finishReason ?? obj.finish_reason),
       usage: undefined,
     };
   }
   
   // 辅助函数
   function extractToolCalls(raw: unknown): ToolCall[] | undefined;
   function extractFinishReason(raw: unknown): FinishReason;
   ```

2. **创建 `src/contracts/mcp-contract.ts`**
   ```typescript
   export function validateMCPResponse(raw: unknown): MCPToolResponse {
     const result = MCPToolResponseSchema.safeParse(raw);
     if (result.success) return result.data;
     
     // 降级：包装为 text content
     return {
       content: [{
         type: 'text',
         text: typeof raw === 'string' ? raw : JSON.stringify(raw),
       }],
       isError: false,
     };
   }
   ```

3. **创建 `src/contracts/user-input-contract.ts`**
   ```typescript
   export function validateUserInput(raw: unknown): string {
     if (typeof raw === 'string' && raw.length > 0) return raw;
     if (typeof raw === 'object' && raw !== null && 'content' in raw) {
       const content = (raw as { content: unknown }).content;
       if (typeof content === 'string') return content;
     }
     return ''; // 降级：空字符串
   }
   ```

4. **集成到 Agent Loop**
   - 修改 `callLLM()` 使用 `validateLLMResponse()`
   - 修改 MCP 工具调用使用 `validateMCPResponse()`

**验证方法**：
```bash
npx vitest run tests/contracts/
# 测试用例必须包含：
# - 正常输入通过
# - 缺失字段降级
# - 错误类型降级
# - 完全无效输入降级
```

**依赖**：无

**预估工作量**：0.5 天

---

### P0-3: 补全事件路由 (llm.request / tool.call)

**问题**：设计文档的事件路由表要求 `llm.request` 和 `tool.call` 事件触发独立处理。当前实现跳过这些事件，直接执行 LLM 调用和工具执行。

**影响**：事件流不完整，无法追踪 LLM 请求和工具调用的精确时机。

**解决方案**：

修改 `src/loop/agent-loop.ts` 的事件路由：

**实现步骤**：

1. **添加 `llm.request` 事件发出**
   ```typescript
   // 修改 handleAgentStart()
   function handleAgentStart(state, event): Observable<StepContext> {
     const requestEvent: AgentEvent = {
       type: 'llm.request',
       timestamp: Date.now(),
       sessionId,
       messages: state.messages,
       model: config.model,
       tools: ctx.tools.list(),
     };
     
     return concat(
       of({ event: requestEvent, state }),
       // 然后调用 LLM
       callLLM(state),
     );
   }
   ```

2. **添加 `llm.request` 事件路由**
   ```typescript
   // 在 step() switch 中添加
   case 'llm.request':
     return handleLLMRequest(state, event);
   
   function handleLLMRequest(state, event): Observable<StepContext> {
     // 使用 streaming 或非 streaming
     if (config.streaming) {
       return callLLMStreaming(state);
     }
     return callLLM(state);
   }
   ```

3. **添加 `tool.call` 事件发出**
   ```typescript
   // 修改 handleLLMResponse() 中的工具调用部分
   if (toolCalls.length === 1 || !config.parallelToolCalls) {
     const firstCall = toolCalls[0]!;
     const callEvent: AgentEvent = {
       type: 'tool.call',
       timestamp: Date.now(),
       sessionId,
       toolCallId: firstCall.id,
       toolName: firstCall.name,
       args: firstCall.args,
     };
     return concat(
       of({ event: callEvent, state }),
       executeSingleTool(firstCall, state),
     );
   }
   ```

4. **添加 `tool.call` 事件路由**
   ```typescript
   // 在 step() switch 中添加
   case 'tool.call':
     return handleToolCall(state, event);
   
   function handleToolCall(state, event): Observable<StepContext> {
     const tc = { id: event.toolCallId, name: event.toolName, args: event.args };
     return executeSingleTool(tc, state);
   }
   ```

**验证方法**：
```bash
npx vitest run tests/loop/agent-loop.spec.ts
# 测试用例必须验证事件顺序：
# agent.start → llm.request → llm.response → tool.call → tool.execute → tool.result
```

**依赖**：无

**预估工作量**：0.5 天

---

## 🟡 P1: 重要改进

### P1-1: 实现状态机类

**问题**：设计文档要求 6 状态模型 (`pending`, `running`, `paused`, `completed`, `cancelled`, `error`) 和状态转换验证。当前无状态机实现。

**影响**：无法验证状态转换合法性，可能出现非法状态。

**解决方案**：

```
src/
├── core/
│   └── state-machine.ts
└── tests/
    └── core/
        └── state-machine.spec.ts
```

**实现步骤**：

1. **定义状态枚举和转换规则**
   ```typescript
   export type AgentStateEnum = 
     | 'pending' | 'running' | 'paused' 
     | 'completed' | 'cancelled' | 'error';
   
   const VALID_TRANSITIONS: Record<AgentStateEnum, AgentStateEnum[]> = {
     pending: ['running'],
     running: ['paused', 'completed', 'cancelled', 'error'],
     paused: ['running', 'cancelled'],
     completed: [],
     cancelled: [],
     error: [],
   };
   ```

2. **实现状态机类**
   ```typescript
   export class AgentStateMachine {
     private _state: AgentStateEnum = 'pending';
     private state$ = new BehaviorSubject<AgentStateEnum>('pending');
     
     get state(): AgentStateEnum { return this._state; }
     get stateChanges(): Observable<AgentStateEnum> { return this.state$.asObservable(); }
     
     transition(to: AgentStateEnum): boolean {
       if (!VALID_TRANSITIONS[this._state].includes(to)) {
         return false; // 非法转换
       }
       const from = this._state;
       this._state = to;
       this.state$.next(to);
       return true;
     }
     
     isTerminal(): boolean {
       return ['completed', 'cancelled', 'error'].includes(this._state);
     }
   }
   ```

3. **集成到 Agent Loop**
   - 在 `createAgentLoop()` 中创建状态机实例
   - 在关键节点调用 `transition()`
   - 发出 `state.change` 事件

**验证方法**：
```bash
npx vitest run tests/core/state-machine.spec.ts
# 测试用例：
# - 合法转换成功
# - 非法转换失败
# - 终态无法转换
# - state.change 事件发出
```

**依赖**：无

**预估工作量**：0.5 天

---

### P1-2: 接入 Checkpoint 到事件流

**问题**：Checkpoint Schema 已完整定义，但未接入事件流。无法实现暂停恢复功能。

**影响**：Agent 无法从断点恢复执行。

**解决方案**：

在 `agent-loop.ts` 中添加 checkpoint 自动保存逻辑。

**实现步骤**：

1. **添加 checkpoint 配置**
   ```typescript
   export interface AgentLoopConfig {
     // ... 现有字段
     checkpoint?: {
       enabled: boolean;
       interval: 'step' | 'tool_result' | 'llm_response';
     };
   }
   ```

2. **在关键位置保存 checkpoint**
   ```typescript
   // 在 handleLLMResponse() 末尾
   if (ctx.checkpoint && config.checkpoint?.interval === 'llm_response') {
     const cp = createCheckpoint({
       id: `cp-${generateId()}`,
       sessionId,
       position: 'after_llm',
       state,
     });
     await ctx.checkpoint.save(cp);
     
     // 发出 checkpoint 事件
     const checkpointEvent: AgentEvent = {
       type: 'checkpoint',
       timestamp: Date.now(),
       sessionId,
       checkpointId: cp.id,
       position: 'after_llm',
       state,
     };
   }
   ```

3. **实现恢复入口**
   ```typescript
   // 添加到 AgentLoop 接口
   export interface AgentLoop {
     run(input: string): Observable<AgentEvent>;
     resume(checkpoint: Checkpoint): Observable<AgentEvent>;
     destroy$: Observable<void>;
   }
   
   function resume(checkpoint: Checkpoint): Observable<AgentEvent> {
     // 从 checkpoint.state 恢复执行
     const state = checkpoint.state;
     // 根据 position 决定恢复点
     // ...
   }
   ```

**验证方法**：
```bash
npx vitest run tests/loop/checkpoint.spec.ts
# 测试用例：
# - checkpoint 事件发出
# - 从 after_llm 恢复
# - 从 after_tool 恢复
# - 幂等性：跳过已执行工具
```

**依赖**：无

**预估工作量**：1 天

---

### P1-3: 重构 HITL 为 Observable 模式

**问题**：当前 HITL 使用 `await ctx.hitl.ask()` 阻塞 Observable 流，违反 Reactive 设计原则。

**影响**：阻塞 RxJS 事件流，可能影响其他订阅者。

**解决方案**：

使用 Subject 实现 Reactive HITL。

**实现步骤**：

1. **修改 HITL 控制器接口实现**
   ```typescript
   // 在 agent-loop.ts 中
   const hitlAsk$ = new Subject<{ askId: string; question: string }>();
   const hitlAnswer$ = new Subject<{ askId: string; answer: string }>();
   
   // 注册到 ctx.hitl
   if (ctx.hitl) {
     ctx.hitl.onAsk().subscribe(hitlAsk$);
   }
   ```

2. **修改 executeSingleTool() 中的 HITL 处理**
   ```typescript
   if (result.startsWith('HITL_REQUIRED:') && ctx.hitl) {
     const question = result.slice('HITL_REQUIRED:'.length).trim();
     const askId = `ask-${generateId()}`;
     
     // 发出 ask 事件，然后等待 answer (非阻塞)
     const askEvent: AgentEvent = { type: 'hitl.ask', ... };
     
     return concat(
       of({ event: askEvent, state }),
       // 使用 Subject 等待 answer，而非 await
       hitlAnswer$.pipe(
         filter(a => a.askId === askId),
         take(1),
         map(answer => ({ event: { type: 'hitl.answer', ... }, state })),
       ),
     );
   }
   ```

3. **提供外部注入 answer 的方法**
   ```typescript
   // AgentLoop 接口添加
   answerHITL(askId: string, answer: string): void;
   ```

**验证方法**：
```bash
npx vitest run tests/loop/hitl.spec.ts
# 测试用例：
# - hitl.ask 事件发出后流暂停
# - answerHITL() 调用后恢复
# - 不阻塞其他订阅者
```

**依赖**：无

**预估工作量**：1 天

---

### P1-4: 添加重入防护

**问题**：当前无重入检查，多次调用 `run()` 可能导致状态混乱。

**影响**：并发 run() 调用导致不可预测行为。

**解决方案**：

使用 `running$` Subject + 检查。

**实现步骤**：

1. **添加运行状态跟踪**
   ```typescript
   // 在 createAgentLoop() 中
   let isRunning = false;
   
   function run(input: string): Observable<AgentEvent> {
     // 重入检查
     if (isRunning) {
       return throwError(() => new Error('Agent is already running'));
     }
     isRunning = true;
     
     // ... 现有逻辑
     
     return of({ event: startEvent, state: initialState }).pipe(
       // ... 现有管道
       finalize(() => {
         isRunning = false;
       }),
     );
   }
   ```

2. **或使用 exhaustMap 模式 (设计文档推荐)**
   ```typescript
   // 提供 AgentRunner 类
   export class AgentRunner {
     private triggers$ = new Subject<string>();
     
     constructor(private agent: AgentLoop) {
       this.triggers$.pipe(
         exhaustMap(input => agent.run(input)),
       ).subscribe();
     }
     
     run(input: string): void {
       this.triggers$.next(input);
     }
   }
   ```

**验证方法**：
```bash
npx vitest run tests/loop/reentry.spec.ts
# 测试用例：
# - 第二次 run() 抛出错误
# - 运行完成后可再次 run()
# - exhaustMap 模式忽略新请求
```

**依赖**：无

**预估工作量**：0.5 天

---

## 🟢 P2: 可延后改进

### P2-1: 对齐 HITLController.ask() 签名

**问题**：设计签名 `ask(question: string, options?: string[])` vs 实现 `ask(options: HITLAskOptions)`。

**解决方案**：

两种选择：
1. **修改实现**适配设计签名
2. **更新设计文档**记录新签名

**建议**：保持当前实现，更新设计文档。当前实现更结构化。

**预估工作量**：0.5 天

---

### P2-2: 补充 Layer 2/3 事件单元测试

**问题**：Layer 2 (subagent, mcp, workflow) 和 Layer 3 (permission) 事件缺少测试覆盖。

**解决方案**：

添加测试文件：
- `tests/core/events-layer2.spec.ts`
- `tests/core/events-layer3.spec.ts`

**预估工作量**：0.5 天

---

### P2-3: 文档化扩展方法

**问题**：实现扩展了一些设计未定义的方法：
- `MemoryStore.count()`
- `Metrics.gauge()`
- `MCPClient.onStatusChange()`
- `CheckpointStorage.deleteAll()`

**解决方案**：

更新设计文档，添加扩展方法说明。

**预估工作量**：0.5 天

---

## 执行顺序建议

```
Week 1 (P0):
├── Day 1: P0-1 PromptBuilder + zodToFunctionDef
├── Day 2: P0-2 Tier 1 校验函数
└── Day 3: P0-3 事件路由补全

Week 2 (P1):
├── Day 1: P1-1 状态机类
├── Day 2: P1-2 Checkpoint 接入
├── Day 3: P1-3 HITL 重构
└── Day 4: P1-4 重入防护

Week 3 (P2):
├── Day 1: P2-1 + P2-2
└── Day 2: P2-3 + 文档更新
```

---

## 验证清单

完成每项后执行：

```bash
# 1. 单元测试
npx vitest run

# 2. TypeScript 编译
npx tsc --noEmit

# 3. 事件流完整性测试
# agent.start → llm.request → llm.response → tool.call → tool.execute → tool.result → (loop or done)

# 4. 错误边界测试
# LLM 返回无效数据 → 降级 → 继续执行

# 5. 状态机测试
# 合法转换 → 成功
# 非法转换 → 拒绝

# 6. Checkpoint 测试
# 保存 → 恢复 → 继续执行
```

---

## 文件变更摘要

| 操作 | 文件 | P级别 |
|------|------|-------|
| 新增 | `src/core/zod-to-schema.ts` | P0 |
| 新增 | `src/core/prompt-builder.ts` | P0 |
| 新增 | `src/contracts/llm-contract.ts` | P0 |
| 新增 | `src/contracts/mcp-contract.ts` | P0 |
| 新增 | `src/contracts/user-input-contract.ts` | P0 |
| 新增 | `src/contracts/index.ts` | P0 |
| 新增 | `src/core/state-machine.ts` | P1 |
| 修改 | `src/loop/agent-loop.ts` | P0, P1 |
| 修改 | `src/core/index.ts` | P0, P1 |
| 修改 | `src/core/interfaces.ts` | P0 |
| 新增 | `tests/core/prompt-builder.spec.ts` | P0 |
| 新增 | `tests/core/zod-to-schema.spec.ts` | P0 |
| 新增 | `tests/contracts/*.spec.ts` | P0 |
| 新增 | `tests/core/state-machine.spec.ts` | P1 |
| 新增 | `tests/loop/checkpoint.spec.ts` | P1 |
| 新增 | `tests/loop/hitl.spec.ts` | P1 |
| 新增 | `tests/loop/reentry.spec.ts` | P1 |
