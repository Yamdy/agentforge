# 使用示例

> 本文档提供 AgentForge 的 6 个完整使用示例，从最简使用到生产环境配置。

---

## 1. 最简使用

```typescript
import { Agent } from 'agentforge';

const agent = new Agent(
  { name: 'assistant', model: { provider: 'openai', model: 'gpt-4' }, maxSteps: 10 },
  { llm, tools }
);

agent.run('Hello, how are you?').subscribe({
  next: (event) => console.log(event.type),
  complete: () => console.log('Done'),
});
```

---

## 2. 带操作符

```typescript
agent.run('Complex task').pipe(
  // 控制流
  timeout(60000),
  retry(3),
  requirePermission(checkPermission),
  
  // 通知
  logEvents(),
  traceEvents(tracer),
  recordMetrics(metrics),
  
  // 变换
  transformLLMParams((p) => ({ ...p, temperature: 0.7 })),
).subscribe();
```

---

## 3. 可中断

```typescript
const cancel$ = new Subject<void>();

agent.run('Long task').pipe(
  takeUntil(cancel$),
).subscribe();

// 30秒后取消
setTimeout(() => cancel$.next(), 30000);
```

---

## 4. 可恢复

```typescript
// 首次运行，自动打点
const storage = new SQLiteCheckpointStorage();

agent.run('Task').pipe(
  checkpoint(storage, agent.sessionId, (e) => e.type === 'tool.result'),
).subscribe();

// 恢复
const checkpoint = await storage.load(sessionId);
if (checkpoint) {
  resumeAgent(checkpoint, config, deps).subscribe();
}
```

---

## 5. HITL

```typescript
const hitl = new HITLController();

// Agent 使用 HITL
const agent = new Agent(config, { 
  llm, 
  tools: [...tools, createPermissionTool(hitl)] 
});

// UI 监听询问
hitl.onAsk().subscribe((ask) => {
  showPermissionDialog(ask.question).then((answer) => {
    hitl.answer(ask.askId, answer);
  });
});

// 运行
agent.run('Delete file.txt').subscribe();
```

---

## 6. 生产环境

```typescript
agent.run(input).pipe(
  productionPreset({
    timeout: 120000,
    maxRetries: 3,
    tracer: new OpenTelemetryTracer(),
    metrics: new PrometheusMetrics(),
    checkpoint: new SQLiteCheckpointStorage(),
  }),
).subscribe({
  next: (event) => {
    if (event.type === 'agent.complete') {
      console.log('Output:', event.output);
    }
  },
  error: (err) => {
    alert('Agent failed: ' + err.message);
  },
});
```

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [10-FEATURES.md](./10-FEATURES.md) - 特性实现
- [11-OPERATORS.md](./11-OPERATORS.md) - 操作符库
- [12-API-DESIGN.md](./12-API-DESIGN.md) - API 设计
