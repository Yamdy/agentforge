# 流式响应示例

学习如何使用流式响应实时处理 Agent 输出。

## 基本流式响应

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  agent: {
    name: 'Streaming Agent',
    model: 'gpt-4o',
  },
});

agent.runStream('Tell me a short story').subscribe({
  next: (event) => {
    if (event.type === 'text') {
      process.stdout.write(event.content);
    }
  },
  complete: () => {
    console.log('\n[完成]');
  },
});
```

## 处理不同事件类型

```typescript
agent.runStream('Process this file').subscribe({
  next: (event) => {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.content);
        break;
      case 'tool_call_start':
        console.log(`\n[工具调用: ${event.name}]`);
        break;
      case 'tool_call_end':
        console.log(`\n[工具完成]`);
        break;
      case 'error':
        console.error(`\n[错误: ${event.error.message}]`);
        break;
      case 'state_change':
        console.log(`\n[状态: ${event.state}]`);
        break;
    }
  },
  complete: () => {
    console.log('\n[流程完成]');
  },
});
```

## 使用 RxJS 操作符

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
  .runStream('Generate a long text')
  .pipe(
    bufferTime(1000) // 每1秒缓冲一次
  )
  .subscribe((events) => {
    const text = events
      .filter((e) => e.type === 'text')
      .map((e) => e.content)
      .join('');
    console.log('批量文本:', text);
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

## 实时进度显示

```typescript
let stepCount = 0;
let lastToolName = '';

agent.runStream('Complex task with multiple steps').subscribe({
  next: (event) => {
    if (event.type === 'tool_call_start') {
      stepCount++;
      lastToolName = event.name;
      console.log(`\n步骤 ${stepCount}: ${event.name}`);
    } else if (event.type === 'text') {
      process.stdout.write(event.content);
    }
  },
  complete: () => {
    console.log(`\n\n总共执行了 ${stepCount} 步`);
    console.log(`最后一个工具: ${lastToolName}`);
  },
});
```

## 结合 Vue 组件

```vue
<template>
  <div>
    <div v-if="status" class="status">状态: {{ status }}</div>
    <div class="content">{{ content }}</div>
    <button @click="cancel" :disabled="!isRunning">取消</button>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';
import { createAgent } from 'agentforge';

const content = ref('');
const status = ref('');
const isRunning = ref(false);
let subscription;

const agent = createAgent({
  agent: {
    name: 'Vue Agent',
    model: 'gpt-4o',
  },
});

const startStream = async () => {
  isRunning.value = true;
  content.value = '';

  subscription = agent.runStream('Tell me about Vue').subscribe({
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
      isRunning.value = false;
      status.value = '完成';
    },
    error: (err) => {
      isRunning.value = false;
      status.value = `错误: ${err.message}`;
    },
  });
};

const cancel = () => {
  if (subscription) {
    subscription.unsubscribe();
    isRunning.value = false;
    status.value = '已取消';
  }
};

onUnmounted(() => {
  if (subscription) {
    subscription.unsubscribe();
  }
});
</script>
```

## 流式数据处理

```typescript
import { map, scan, filter } from 'rxjs/operators';

agent
  .runStream('Process data')
  .pipe(
    filter((event) => event.type === 'text'),
    map((event) => event.content),
    scan((acc, content) => acc + content, '')
  )
  .subscribe((fullContent) => {
    console.log('完整内容长度:', fullContent.length);
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
import 'dotenv/config';
import { createAgent } from 'agentforge';
import { filter, bufferTime, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

async function main() {
  const agent = createAgent({
    agent: {
      name: 'Streaming Demo',
      model: 'gpt-4o',
      tools: ['read', 'write', 'ls'],
    },
  });

  console.log('开始流式响应...\n');

  // 订阅流
  const subscription = agent
    .runStream('请帮我分析当前项目的结构，并给出建议')
    .pipe(
      // 只处理文本事件
      filter((event) => event.type === 'text'),
      // 错误处理
      catchError((error) => {
        console.error('流错误:', error);
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
        console.log('\n\n流式响应完成');
      },
      error: (err) => {
        console.error('订阅错误:', err);
      },
    });

  // 5秒后取消
  // setTimeout(() => {
  //   subscription.unsubscribe();
  //   console.log('\n\n已取消');
  // }, 5000);
}

main().catch(console.error);
```

## 运行示例

```bash
# 运行示例
pnpm tsx examples/streaming.ts
```

## 最佳实践

1. **总是处理错误**：使用 `catchError` 处理流错误
2. **清理订阅**：在组件卸载时取消订阅
3. **使用操作符**：利用 RxJS 操作符简化逻辑
4. **节流/防抖**：对高频事件使用节流或防抖
5. **缓冲批量处理**：对大量事件使用缓冲

## 下一步

- [工具使用示例](./tools.md) - 学习使用工具
- [自定义工具示例](./custom-tools.md) - 创建自定义工具
