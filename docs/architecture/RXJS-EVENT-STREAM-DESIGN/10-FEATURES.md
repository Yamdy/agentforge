# 特性实现

> 本文档展示如何通过 RxJS 操作符实现 Agent 框架的核心特性：可观测、可中断、可恢复、重试、超时、打点、HITL。

---

## 1. 可观测

```typescript
// 天然可观测：subscribe() 监听所有事件
agent.run(input).subscribe({
  next: (event) => console.log(`[${event.type}]`, event),
  error: (err) => console.error(err),
  complete: () => console.log('Agent completed'),
});

// 选择性监听
agent.run(input).pipe(
  filter((e) => e.type === 'tool.result'),
).subscribe((event) => {
  console.log(`Tool result: ${event.result}`);
});
```

---

## 2. 可中断

```typescript
// 方式1：外部取消信号
const cancel$ = new Subject<void>();
agent.run(input).pipe(
  takeUntil(cancel$),
).subscribe();

// 触发取消
setTimeout(() => cancel$.next(), 30000); // 30秒后取消

// 方式2：agent.cancel()
const subscription = agent.run(input).subscribe();
setTimeout(() => agent.cancel('timeout'), 30000);

// 方式3：条件取消
agent.run(input).pipe(
  takeWhile((e) => e.type !== 'cancel'),
).subscribe();
```

---

## 3. 可恢复

Checkpoint 定义和 CheckpointStorage 接口见 [检查点定义](./01-CORE-TYPES.md) 和 [接口定义](./03-DI.md)。

```typescript
// 自动打点（在 Agent 内部）
private maybeCheckpoint(event: AgentEvent, state: AgentState): void {
  const checkpointPositions: AgentEventType[] = [
    'llm.response',   // LLM 响应后
    'tool.result',    // 工具执行后
  ];
  
  if (checkpointPositions.includes(event.type)) {
    const checkpoint: Checkpoint = {
      id: generateId(),
      sessionId: this.sessionId,
      timestamp: Date.now(),
      position: event.type === 'llm.response' ? 'after_llm' : 'after_tool',
      state: { ...state },
      pendingA2A: [],  // 🔴 P1: 保存待处理的 A2A 请求
      executedTools: [],  // 🔴 P1: 保存已执行工具记录
    };
    this.ctx.checkpoint?.save(checkpoint);
  }
}

// 从检查点恢复（幂等性保证）
async function resumeAgent(
  checkpoint: Checkpoint,
  config: AgentConfig,
  ctx: AgentContext
): Promise<Observable<AgentEvent>> {
  const agent = new Agent(config, ctx);
  agent.sessionId = checkpoint.sessionId;
  
  // 🔴 P1: 恢复时检查已执行工具，避免重复执行
  agent.restoreExecutedTools(checkpoint.executedTools ?? []);
  
  // 根据位置决定从哪里继续
  const resumeEvent: AgentEvent = {
    type: 'agent.start',
    timestamp: Date.now(),
    sessionId: checkpoint.sessionId,
    input: '', // 从 state 恢复
    agentName: config.name,
    model: config.model,
  };
  
  return of(resumeEvent).pipe(
    expand((event) => agent.step(event, checkpoint.state)),
  );
}
```

---

## 4. 重试

```typescript
// LLM 请求重试
agent.run(input).pipe(
  retry({
    count: 3,
    delay: (error, retryCount) => timer(1000 * Math.pow(2, retryCount)),
    resetOnSuccess: true,
  }),
);

// 工具执行重试（在操作符层）
agent.run(input).pipe(
  retryOnEventType('tool.error', 3),
);
```

---

## 5. 超时

```typescript
// 总超时
agent.run(input).pipe(
  timeout(60000), // 60秒总超时
);

// 分阶段超时
agent.run(input).pipe(
  timeoutOnEventType('llm.request', 30000),  // LLM 30秒
  timeoutOnEventType('tool.execute', 10000), // 工具 10秒
);
```

---

## 6. 打点

```typescript
// Tracing
agent.run(input).pipe(
  tap((event) => {
    switch (event.type) {
      case 'agent.start':
        tracer.startSpan('agent', { attributes: { name: event.agentName } });
        break;
      case 'llm.request':
        tracer.startSpan('llm', { parent: 'agent' });
        break;
      case 'llm.response':
        tracer.endSpan('llm');
        break;
      case 'tool.execute':
        tracer.startSpan(`tool.${event.toolName}`);
        break;
      case 'tool.result':
        tracer.endSpan(`tool.${event.toolName}`);
        break;
      case 'agent.complete':
        tracer.endSpan('agent');
        break;
    }
  }),
);

// Metrics
agent.run(input).pipe(
  tap((event) => {
    metrics.increment(`event.${event.type}`);
    if (event.type === 'tool.result') {
      metrics.histogram('tool.duration', event.timestamp - /* start time */);
    }
  }),
);

// 远程导出（异步不阻塞）
agent.run(input).pipe(
  tap((event) => {
    // 异步发送，不阻塞主流程
    fetch('/api/events', { method: 'POST', body: JSON.stringify(event) })
      .catch(() => {}); // 静默失败
  }),
);
```

---

## 7. HITL

```typescript
// HITL 控制器 - Observable 模式实现 NEVER-blocking
class HITLController {
  private asks$ = new Subject<Extract<AgentEvent, { type: 'hitl.ask' }>>();
  private pendingAsks = new Map<string, Subject<string>>();
  
  // Agent 调用：发出询问，返回 Observable
  // Observable 不 emit 时 expand 自然暂停（等效 NEVER）
  ask(options: HITLAskOptions): Observable<string> {
    const answerSubject = new Subject<string>();
    this.pendingAsks.set(options.askId, answerSubject);
    
    // 发出 hitl.ask 事件
    this.asks$.next({
      type: 'hitl.ask',
      timestamp: Date.now(),
      sessionId: '', // 由 Agent 填充
      askId: options.askId,
      question: options.question,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      options: options.options,
    });
    
    return answerSubject.asObservable();
  }
  
  // 外部调用：提供回答
  answer(askId: string, answer: string): void {
    const subject = this.pendingAsks.get(askId);
    if (subject) {
      subject.next(answer);
      subject.complete();
      this.pendingAsks.delete(askId);
    }
  }
  
  // 供 UI 订阅：显示询问
  onAsk(): Observable<Extract<AgentEvent, { type: 'hitl.ask' }>> {
    return this.asks$.asObservable();
  }
}

// 使用
const hitl = new HITLController();

// Agent 侧：在 step() 的 hitl.ask case 中
function handleHITLAsk(event, state) {
  return ctx.hitl.ask({
    question: event.question,
    askId: event.askId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
  }).pipe(
    observeOn(asyncScheduler),  // 避免同步死锁
    mergeMap(answer => from([
      { event: { type: 'hitl.answer', answer, ...event }, state },
      { event: { type: 'tool.result', result: answer, ...event }, state },
    ]))
  );
}

// UI 侧：监听询问并响应
hitl.onAsk().subscribe((ask) => {
  showDialog(ask.question, ask.options).then((answer) => {
    hitl.answer(ask.askId, answer);
  });
});
```

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 核心类型定义
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束
- [11-OPERATORS.md](./11-OPERATORS.md) - 操作符库
- [13-EXAMPLES.md](./13-EXAMPLES.md) - 使用示例
