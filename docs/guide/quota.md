# 配额控制

AgentForge 配额控制系统用于管理 LLM token 消耗和成本，防止意外超支。

## 概述

配额控制器通过以下机制控制消耗：

- **预检查**：在 LLM 调用前检查配额，避免浪费 API 调用
- **异步消费记录**：记录实际使用量，不阻塞响应流程
- **会话隔离**：每个会话独立追踪，支持多租户

## 基本使用

### 创建配额控制器

```typescript
import { MemoryQuotaController } from 'agentforge';

const quota = new MemoryQuotaController({
  maxPromptTokens: 100000,    // 最大输入 token
  maxCompletionTokens: 50000, // 最大输出 token
  maxTotalCost: 10.0,         // 最大成本 (可选)
});
```

### 检查配额

```typescript
// 预检查：是否允许使用
const allowed = await quota.check('session-123', {
  promptTokens: 1000, // 预估的输入 token
});

if (!allowed) {
  console.log('Quota exceeded, cannot proceed');
}
```

### 记录消费

```typescript
// 在 LLM 响应后记录实际消费
quota.consume('session-123', {
  promptTokens: response.usage.promptTokens,
  completionTokens: response.usage.completionTokens,
  totalCost: calculateCost(response.usage),
});

// 注意：consume 是 fire-and-forget，不阻塞
```

### 查询使用量

```typescript
const usage = quota.getUsage('session-123');
console.log('Prompt tokens:', usage.promptTokens);
console.log('Completion tokens:', usage.completionTokens);
console.log('Total cost:', usage.totalCost);
```

## 配置限制

```typescript
interface QuotaLimits {
  maxPromptTokens: number;      // 最大输入 token
  maxCompletionTokens: number;  // 最大输出 token
  maxTotalCost?: number;        // 最大成本 (USD)
}

// 获取限制配置
const limits = quota.getLimits();
console.log('Max prompt tokens:', limits.maxPromptTokens);
```

## 重置使用量

```typescript
// 重置特定会话的使用量
quota.reset('session-123');

// 开始新的计量周期
quota.getUsage('session-123'); // { promptTokens: 0, completionTokens: 0 }
```

## 在 Agent 中集成

通过 AgentContext 注入配额控制器：

```typescript
import { ContextBuilder } from 'agentforge';

const ctx = ContextBuilder.create()
  .withLLM(myLLMAdapter)
  .withTools([myTools])
  .withQuota(quota) // 注入配额控制器
  .build();

// Agent 会在每次 LLM 调用前自动检查配额
const agent = createAgent({
  name: 'quota-managed-agent',
  model: 'openai/gpt-4o',
});
```

## 自定义实现

实现 QuotaController 接口以支持不同后端：

```typescript
import type { QuotaController, QuotaUsage, QuotaLimits } from 'agentforge';

class RedisQuotaController implements QuotaController {
  private redis: RedisClient;
  
  constructor(
    private limits: QuotaLimits,
    redisUrl: string
  ) {
    this.redis = new RedisClient(redisUrl);
  }

  async check(sessionId: string, projected: QuotaUsage): Promise<boolean> {
    const current = await this.redis.hgetall(`quota:${sessionId}`);
    const promptTotal = (Number(current.promptTokens) || 0) + projected.promptTokens;
    
    return promptTotal <= this.limits.maxPromptTokens;
  }

  consume(sessionId: string, usage: QuotaUsage): void {
    // Fire-and-forget
    this.redis.hincrby(`quota:${sessionId}`, 'promptTokens', usage.promptTokens);
    this.redis.hincrby(`quota:${sessionId}`, 'completionTokens', usage.completionTokens);
  }

  async getUsage(sessionId: string): Promise<QuotaUsage> {
    const data = await this.redis.hgetall(`quota:${sessionId}`);
    return {
      promptTokens: Number(data.promptTokens) || 0,
      completionTokens: Number(data.completionTokens) || 0,
    };
  }

  getLimits(): QuotaLimits {
    return this.limits;
  }

  reset(sessionId: string): void {
    this.redis.del(`quota:${sessionId}`);
  }
}
```

## 优雅降级

当配额控制器未配置时，Agent 会继续执行：

```typescript
// 未配置配额 -> 允许所有请求
const ctx = ContextBuilder.create()
  .withLLM(myLLMAdapter)
  .withTools([myTools])
  // 没有 .withQuota()
  .build();

// Agent 正常运行，不做配额检查
```

## 配额事件

可以通过事件流监控配额状态：

```typescript
agent.run$('Hello').pipe(
  filter(e => e.type === 'llm.request')
).subscribe(event => {
  // LLM 调用前检查配额
  const usage = quota.getUsage(event.sessionId);
  const limits = quota.getLimits();
  
  const promptPercent = (usage.promptTokens / limits.maxPromptTokens) * 100;
  console.log(`Quota usage: ${promptPercent.toFixed(1)}%`);
});
```

## 最佳实践

1. **合理设置限制**：根据模型定价和预算设置限制
2. **定期重置**：按天/周重置使用量统计
3. **监控告警**：在配额接近上限时发出告警
4. **多租户隔离**：使用 sessionId 区分不同租户

## 相关 API

- [QuotaController 接口](/api/quota) - 配额控制器接口
- [AgentContext](/api/state) - 上下文配置