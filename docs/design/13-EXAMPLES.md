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

const agent = new Agent(config, { llm, tools });

// 运行并获取结果
const result = await agent.run('Hello, how are you?');
console.log(result);
```

---

## 2. 带回调

```typescript
agent.run('Complex task', {
  // 控制流
  signal: AbortSignal.timeout(60000),
  maxSteps: 3,

  // 通知
  onEvent: (event) => tracer.record(event),
  onMetrics: (metrics) => recordMetrics(metrics),

  // 变换
  transformLLMParams: (p) => ({ ...p, temperature: 0.7 }),
});
```

---

## 3. 可中断

```typescript
const controller = new AbortController();

agent.run('Long task', { signal: controller.signal });

// 30秒后取消
setTimeout(() => controller.abort(), 30000);
```

---

## 4. 可恢复

```typescript
// 首次运行，自动打点
const storage = new SQLiteCheckpointStorage();

await agent.run('Task', {
  checkpoint: {
    storage,
    sessionId,
    saveOn: (e) => e.type === 'tool.result',
  },
});

// 恢复
const checkpoint = await storage.load(sessionId);
if (checkpoint) {
  await resumeAgent(checkpoint, config, deps);
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
hitl.onAsk((ask) => {
  showPermissionDialog(ask.question).then((answer) => {
    hitl.answer(ask.askId, answer);
  });
});

// 运行
await agent.run('Delete file.txt');
```

---

## 6. 生产环境

```typescript
const result = await agent.run(input, {
  signal: AbortSignal.timeout(120000),
  onEvent: (event) => {
    if (event.type === 'agent.complete') {
      console.log('Output:', event.output);
    }
  },
  onError: (error) => {
    alert('Agent failed: ' + error.message);
  },
  productionPreset: {
    tracer: new OpenTelemetryTracer(),
    metrics: new PrometheusMetrics(),
    checkpoint: new SQLiteCheckpointStorage(),
  },
});
});
```

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [10-FEATURES.md](./10-FEATURES.md) - 特性实现
- [11-OPERATORS.md](./11-OPERATORS.md) - 操作符库
- [12-API-DESIGN.md](./12-API-DESIGN.md) - API 设计
