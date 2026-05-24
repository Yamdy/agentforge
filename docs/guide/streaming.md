# 流式响应

AgentForge 基于 RxJS 提供了强大的流式响应能力，支持实时事件流、暂停/恢复和取消操作。

## 基本流式响应

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent(config);

agent.runStream('Tell me a story').subscribe({
  next: (event) => {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.content);
        break;
      case 'tool_call_start':
        console.log(`\n[调用工具: ${event.name}]`);
        break;
      case 'tool_call_end':
        console.log(`\n[工具完成: ${event.result}]`);
        break;
      case 'error':
        console.error(`\n[错误: ${event.error}]`);
        break;
    }
  },
  complete: () => {
    console.log('\n[完成]');
  },
  error: (err) => {
    console.error('流错误:', err);
  },
});
```

## 事件类型

### text - 文本事件

```typescript
{
  type: 'text',
  content: '文本内容',
}
```

### tool_call_start - 工具调用开始

```typescript
{
  type: 'tool_call_start',
  name: '工具名称',
  args: { /* 工具参数 */ },
}
```

### tool_call_end - 工具调用结束

```typescript
{
  type: 'tool_call_end',
  name: '工具名称',
  result: '工具执行结果',
}
```

### error - 错误事件

```typescript
{
  type: 'error',
  error: Error对象,
}
```

### state_change - 状态改变

```typescript
{
  type: 'state_change',
  state: 'running' | 'paused' | 'completed' | 'error',
}
```

## RxJS 操作符

### 过滤事件

```typescript
import { filter } from 'rxjs/operators';

agent
  .runStream('Hello')
  .pipe(filter((event) => event.type === 'text'))
  .subscribe((event) => {
    process.stdout.write(event.content);
  });
```

### 缓冲事件

```typescript
import { bufferTime } from 'rxjs/operators';

agent
  .runStream('Hello')
  .pipe(
    bufferTime(1000) // 每1秒缓冲一次
  )
  .subscribe((events) => {
    console.log('批量事件:', events);
  });
```

### 节流

```typescript
import { throttleTime } from 'rxjs/operators';

agent
  .runStream('Hello')
  .pipe(
    throttleTime(100) // 最多每100ms处理一次
  )
  .subscribe((event) => {
    console.log(event);
  });
```

### 防抖

```typescript
import { debounceTime } from 'rxjs/operators';

agent
  .runStream('Hello')
  .pipe(
    debounceTime(500) // 停止500ms后处理
  )
  .subscribe((event) => {
    console.log(event);
  });
```

### 重试

```typescript
import { retry, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

agent
  .runStream('Hello')
  .pipe(
    retry(3), // 重试3次
    catchError((error) => {
      console.error('失败:', error);
      return of({ type: 'error', error });
    })
  )
  .subscribe((event) => {
    console.log(event);
  });
```

### 组合

```typescript
import { combineLatest } from 'rxjs';

const stream1 = agent.runStream('Hello');
const stream2 = agent.runStream('World');

combineLatest([stream1, stream2]).subscribe(([event1, event2]) => {
  console.log('组合事件:', event1, event2);
});
```

## 控制流

### 暂停流

```typescript
const subscription = agent.runStream('Hello').subscribe({
  next: (event) => console.log(event),
});

// 暂停
subscription.unsubscribe();
```

### 恢复流

```typescript
// 需要重新订阅
const newSubscription = agent.runStream('Hello').subscribe({
  next: (event) => console.log(event),
});
```

### 取消流

```typescript
const subscription = agent.runStream('Hello').subscribe({
  next: (event) => console.log(event),
});

// 取消
subscription.unsubscribe();
```

## 流式 vs 非流式

### 非流式（等待完成）

```typescript
const result = await agent.run('Hello');
console.log(result); // 一次性获取完整结果
```

### 流式（实时更新）

```typescript
agent.runStream('Hello').subscribe({
  next: (event) => {
    // 实时处理每个事件
    if (event.type === 'text') {
      process.stdout.write(event.content);
    }
  },
});
```

## 实时进度

```typescript
let stepCount = 0;

agent.runStream('Complex task').subscribe({
  next: (event) => {
    if (event.type === 'tool_call_start') {
      stepCount++;
      console.log(`步骤 ${stepCount}: ${event.name}`);
    }
  },
  complete: () => {
    console.log(`总共执行了 ${stepCount} 步`);
  },
});
```

## 实时 UI 更新

```typescript
// Vue 组件示例
import { ref } from 'vue';

const content = ref('');
const status = ref('idle');

agent.runStream('Hello').subscribe({
  next: (event) => {
    switch (event.type) {
      case 'text':
        content.value += event.content;
        break;
      case 'tool_call_start':
        status.value = `执行工具: ${event.name}`;
        break;
      case 'state_change':
        status.value = event.state;
        break;
    }
  },
  complete: () => {
    status.value = 'completed';
  },
});
```

## 流式数据处理

```typescript
import { map, scan } from 'rxjs/operators';

agent
  .runStream('Process data')
  .pipe(
    filter((event) => event.type === 'text'),
    map((event) => event.content),
    scan((acc, content) => acc + content, '')
  )
  .subscribe((fullContent) => {
    console.log('完整内容:', fullContent);
  });
```

## 错误处理

```typescript
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

agent
  .runStream('Hello')
  .pipe(
    catchError((error) => {
      console.error('流错误:', error);
      // 返回错误事件继续流
      return of({ type: 'error', error });
    })
  )
  .subscribe({
    next: (event) => {
      if (event.type === 'error') {
        console.error('处理错误:', event.error);
      }
    },
  });
```

## 完整示例

```typescript
import { createAgent } from 'agentforge';
import { filter, bufferTime, retry, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

const agent = createAgent(config);

// 创建流式订阅
const subscription = agent
  .runStream('帮我分析这个项目')
  .pipe(
    // 只处理文本事件
    filter((event) => event.type === 'text'),
    // 重试机制
    retry(3),
    // 错误处理
    catchError((error) => {
      console.error('发生错误:', error);
      return of({ type: 'error', error });
    })
  )
  .subscribe({
    next: (event) => {
      if (event.type === 'text') {
        process.stdout.write(event.content);
      }
    },
    complete: () => {
      console.log('\n分析完成');
    },
    error: (err) => {
      console.error('流错误:', err);
    },
  });

// 5秒后取消
setTimeout(() => {
  subscription.unsubscribe();
  console.log('\n已取消');
}, 5000);
```

## 最佳实践

1. **总是处理错误**：使用 `catchError` 处理流错误
2. **清理订阅**：在组件卸载时取消订阅
3. **使用操作符**：利用 RxJS 操作符简化逻辑
4. **节流/防抖**：对高频事件使用节流或防抖
5. **缓冲批量处理**：对大量事件使用缓冲

## 下一步

- [自定义工具](./custom-tools.md) - 创建自定义工具
- [自定义适配器](./custom-adapters.md) - 创建自定义适配器
