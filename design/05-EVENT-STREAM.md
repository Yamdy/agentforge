# 事件流底座

> 本文档定义 AgentForge 的核心事件流架构：Observable<AgentEvent>、事件处理器、Agent Loop。

---

## 1. 核心：Observable<AgentEvent>

> ⚠️ **重要修正**：状态必须作为流中的累积值传递，不可在 `expand` 外部修改。使用 `scan` 操作符显式管理状态转换。

```typescript
// src/core/agent.ts
import { Observable, of, from, EMPTY, NEVER, Subject } from 'rxjs';
import { expand, map, tap, catchError, filter, takeUntil, timeout, retry, scan, mergeMap } from 'rxjs/operators';

export interface AgentConfig {
  name: string;
  model: { provider: string; model: string };
  maxSteps: number;
  systemPrompt?: string;
  parallelToolCalls?: boolean;
}

export interface AgentDependencies {
  llm: LLMAdapter;
  tools: ToolRegistry;
  checkpoint?: CheckpointStorage;
  hitl?: HITLController;
}

/** 步骤上下文（包含状态和事件） */
interface StepContext {
  event: AgentEvent;
  state: AgentState;
}

export class Agent {
  private sessionId: string;
  private cancel$ = new Subject<void>();
  private hitlResume$ = new Subject<{ askId: string; answer: string }>();
  
  constructor(
    private config: AgentConfig,
    private deps: AgentDependencies
  ) {
    this.sessionId = generateSessionId();
  }
  
  /**
   * 核心方法：返回事件流
   * 
   * 关键设计：
   * 1. 状态通过 scan 在流中累积，不在外部修改
   * 2. 每个事件独立发出，保证细粒度可观测性
   * 3. 并行工具调用通过 mergeMap 实现，状态合并显式处理
   */
  run(input: string): Observable<AgentEvent> {
    const initialState = this.createInitialState(input);
    
    return this.createEventFlow(initialState).pipe(
      takeUntil(this.cancel$),
      tap((event) => this.maybeCheckpoint(event)),
    );
  }
  
  cancel(reason?: string): void {
    this.cancel$.next();
    this.cancel$.complete();
  }
  
  resumeHITL(askId: string, answer: string): void {
    this.hitlResume$.next({ askId, answer });
  }
  
  private createEventFlow(initialState: AgentState): Observable<AgentEvent> {
    const startEvent: AgentEvent = {
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      input: initialState.messages[initialState.messages.length - 1]?.content ?? '',
      agentName: this.config.name,
      model: this.config.model,
    };
    
    const initialContext: StepContext = {
      event: startEvent,
      state: initialState,
    };
    
    return of(initialContext).pipe(
      expand((ctx) => this.step(ctx.event, ctx.state)),
      map((ctx) => ctx.event),
      tap((event) => {
        if (process.env.NODE_ENV === 'development' && !isAgentEvent(event)) {
          throw new TypeError(`Invalid event: ${JSON.stringify(event)}`);
        }
      }),
    );
  }
  
  private step(event: AgentEvent, state: AgentState): Observable<StepContext> {
    switch (event.type) {
      case 'agent.start':
        return this.handleAgentStart(event, state);
      
      case 'llm.request':
        return this.handleLLMRequest(event, state);
      
      case 'llm.response':
        return this.handleLLMResponse(event, state);
      
      case 'tool.call':
        return this.handleToolCall(event, state);
      
      case 'tool.batch':
        return this.handleToolBatch(event, state);
      
      case 'tool.result':
        return this.handleToolResult(event, state);
      
      case 'hitl.ask':
        return this.handleHITLAsk(event, state);
      
      case 'hitl.answer':
        return this.handleHITLAnswer(event, state);
      
      case 'llm.output.invalid':
        return this.handleLLMOutputInvalid(event, state);
      
      case 'agent.error':
        return of({
          event: { type: 'done', timestamp: Date.now(), sessionId: this.sessionId, reason: 'error' },
          state,
        });
      
      case 'done':
        return EMPTY;
      
      default:
        return EMPTY;
    }
  }
}
```

---

## 2. 事件处理器

```typescript
// src/core/agent-handlers.ts

// ============================================
// 辅助函数：创建上下文
// ============================================

private createCtx(event: AgentEvent, state: AgentState): StepContext {
  return { event, state };
}

// ============================================
// agent.start → llm.request
// ============================================

private handleAgentStart(event: AgentEvent, state: AgentState): Observable<StepContext> {
  const startEvent = event as Extract<AgentEvent, { type: 'agent.start' }>;
  
  // 不可变更新状态
  const newState = updateState(state, { step: 1 });
  
  // 发出 step 事件
  const stepEvent: AgentEvent = {
    type: 'agent.step',
    timestamp: Date.now(),
    sessionId: this.sessionId,
    step: newState.step,
    maxSteps: newState.maxSteps,
  };
  
  // 下一步：LLM 请求
  const llmRequest: AgentEvent = {
    type: 'llm.request',
    timestamp: Date.now(),
    sessionId: this.sessionId,
    messages: newState.messages,
    model: newState.model,
    tools: this.deps.tools.list(),
  };
  
  return from([
    this.createCtx(stepEvent, newState),
    this.createCtx(llmRequest, newState),
  ]);
}

// ============================================
// llm.request → llm.stream.* → llm.response
// ============================================

private handleLLMRequest(event: AgentEvent, state: AgentState): Observable<StepContext> {
  const request = event as Extract<AgentEvent, { type: 'llm.request' }>;
  
  let accumulatedText = '';
  let accumulatedToolCalls: Array<{ id: string; name: string; args: string }> = [];
  
  return concat(
    of(this.createCtx({
      type: 'llm.stream.start',
      timestamp: Date.now(),
      sessionId: this.sessionId,
    }, state)),
    
    this.deps.llm.stream(request.messages, request.model).pipe(
      map((chunk): StepContext => {
        if ('text' in chunk) {
          accumulatedText += chunk.text;
          return this.createCtx({
            type: 'llm.stream.text',
            timestamp: Date.now(),
            sessionId: this.sessionId,
            delta: chunk.text,
          }, state);
        } else {
          const existing = accumulatedToolCalls.find(tc => tc.id === chunk.toolCallId);
          if (existing) {
            existing.args += chunk.argsDelta;
          } else {
            accumulatedToolCalls.push({
              id: chunk.toolCallId,
              name: chunk.toolName,
              args: chunk.argsDelta,
            });
          }
          return this.createCtx({
            type: 'llm.stream.tool_call',
            timestamp: Date.now(),
            sessionId: this.sessionId,
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            argsDelta: chunk.argsDelta,
          }, state);
        }
      }),
      catchError((error) => of(this.createCtx({
        type: 'llm.error',
        timestamp: Date.now(),
        sessionId: this.sessionId,
        error: this.serializeError(error),
      }, state))),
    ),
    
    of(this.createCtx({
      type: 'llm.response',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      content: accumulatedText,
      toolCalls: accumulatedToolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        args: this.safeParseJSON(tc.args),
      })),
      finishReason: 'stop',
    }, state)),
  );
}

// ============================================
// llm.response → tool.batch 或 done
// ============================================

private handleLLMResponse(event: AgentEvent, state: AgentState): Observable<StepContext> {
  const response = event as Extract<AgentEvent, { type: 'llm.response' }>;
  
  // 校验 LLM 输出格式
  const validationResult = this.validateLLMOutput(response);
  if (!validationResult.valid) {
    return of(this.createCtx({
      type: 'llm.output.invalid',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      reason: validationResult.reason,
      originalResponse: response,
      attempt: 1,
    }, state));
  }
  
  // 不可变更新状态
  const newState = updateState(state, {
    messages: [...state.messages, { role: 'assistant', content: response.content }],
    output: state.output + response.content,
    tokens: {
      prompt: state.tokens.prompt + (response.usage?.promptTokens ?? 0),
      completion: state.tokens.completion + (response.usage?.completionTokens ?? 0),
    },
  });
  
  if (response.toolCalls?.length) {
    // 并行模式
    if (this.config.parallelToolCalls && response.toolCalls.length > 1) {
      return of(this.createCtx({
        type: 'tool.batch',
        timestamp: Date.now(),
        sessionId: this.sessionId,
        batchId: generateId(),
        calls: response.toolCalls.map(tc => ({
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.args,
        })),
      }, newState));
    } else {
      // 串行模式
      return from(response.toolCalls.map((tc): StepContext => this.createCtx({
        type: 'tool.call',
        timestamp: Date.now(),
        sessionId: this.sessionId,
        toolCallId: tc.id,
        toolName: tc.name,
        args: tc.args,
      }, newState)));
    }
  } else {
    // 无工具调用 → 完成
    const completeEvent: AgentEvent = {
      type: 'agent.complete',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      output: newState.output,
      steps: newState.step,
      tokens: newState.tokens,
    };
    const doneEvent: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      reason: response.finishReason,
    };
    return from([
      this.createCtx(completeEvent, newState),
      this.createCtx(doneEvent, newState),
    ]);
  }
}

// ============================================
// tool.batch → 并行执行多个工具
// ============================================

private handleToolBatch(event: AgentEvent, state: AgentState): Observable<StepContext> {
  const batch = event as Extract<AgentEvent, { type: 'tool.batch' }>;
  
  const executionStreams = batch.calls.map((call) => 
    concat(
      of(this.createCtx({
        type: 'tool.execute',
        timestamp: Date.now(),
        sessionId: this.sessionId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
      }, state)),
      
      defer(() => this.deps.tools.execute(call.toolName, call.args, {
        idempotencyKey: `${this.sessionId}:${call.toolCallId}`,
      })).pipe(
        map((result): StepContext => this.createCtx({
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId: this.sessionId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          result,
          isError: false,
        }, state)),
        catchError((error) => of(this.createCtx({
          type: 'tool.error',
          timestamp: Date.now(),
          sessionId: this.sessionId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          error: this.serializeError(error),
        }, state))),
      ),
    )
  );
  
  // mergeMap 保证事件独立发出
  return from(executionStreams).pipe(
    mergeMap((stream) => stream),
  );
}

// ============================================
// tool.result → llm.request（循环）
// ============================================

private handleToolResult(event: AgentEvent, state: AgentState): Observable<StepContext> {
  const result = event as Extract<AgentEvent, { type: 'tool.result' }>;
  
  // 添加 tool 消息到状态
  const newState = updateState(state, {
    messages: [...state.messages, {
      role: 'tool',
      content: result.result,
      name: result.toolName,
      toolCallId: result.toolCallId,
    }],
    completedToolCalls: (state.completedToolCalls ?? 0) + 1,
  });
  
  // 检查是否所有工具完成
  const totalToolCalls = state.pendingToolCalls ?? 1;
  if ((newState.completedToolCalls ?? 0) < totalToolCalls) {
    return of(this.createCtx(result, newState));
  }
  
  // 所有工具完成 → 增加步数，继续循环
  const nextState = updateState(newState, {
    step: newState.step + 1,
    completedToolCalls: 0,
  });
  
  if (nextState.step > nextState.maxSteps) {
    return of(this.createCtx({
      type: 'done',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      reason: 'length',
    }, nextState));
  }
  
  // 继续循环
  const stepEvent: AgentEvent = {
    type: 'agent.step',
    timestamp: Date.now(),
    sessionId: this.sessionId,
    step: nextState.step,
    maxSteps: nextState.maxSteps,
  };
  const llmRequest: AgentEvent = {
    type: 'llm.request',
    timestamp: Date.now(),
    sessionId: this.sessionId,
    messages: nextState.messages,
    model: nextState.model,
    tools: this.deps.tools.list(),
  };
  
  return from([
    this.createCtx(stepEvent, nextState),
    this.createCtx(llmRequest, nextState),
  ]);
}
```

---

## 3. Agent Loop 流转图

```
Observable<AgentEvent>
    │
    └─ expand(事件 → 下一步事件流)
         │
         ├─ agent.start → agent.step + llm.request
         │
         ├─ llm.request → llm.stream.* + llm.response
         │
         ├─ llm.response → tool.batch / tool.call[] 或 agent.complete + done
         │
         ├─ llm.output.invalid → llm.request（修复循环，最多 3 次）
         │
         ├─ tool.call → tool.execute + tool.result
         │
         ├─ tool.batch → mergeMap 并行执行 → tool.execute + tool.result（每个独立发出）
         │
         ├─ tool.result → agent.step + llm.request (循环)
         │
         ├─ hitl.ask → 订阅 ctx.hitl.ask() Observable (暂停直到 answer)
         │
         ├─ context.updated → 继续当前流程（上下文已更新）
         │
         └─ done / agent.error → EMPTY (终止)
```

---

## 4. 循环终止条件

| 条件 | 触发方式 |
|------|---------|
| 自然结束 | LLM 返回无工具调用（`finishReason: 'stop'`） |
| 步数限制 | `step > maxSteps` → `done { reason: 'length' }` |
| 外部取消 | `cancel$.next()` → `takeUntil` 终止流 |
| 错误终止 | 不可恢复错误 → `agent.error` → `done { reason: 'error' }` |
| 超时终止 | `timeout()` 操作符触发 `TimeoutError` |
| LLM 修复失败 | `llm.output.invalid` 超过 3 次重试 → `agent.error` |

---

## 相关文档

- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 事件类型定义
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束
- [10-FEATURES.md](./10-FEATURES.md) - 可观测、可中断、可恢复实现