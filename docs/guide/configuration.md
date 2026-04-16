# 配置系统

AgentForge 提供了强大而灵活的配置系统，支持多种格式和环境变量。

## 配置格式

### Markdown 格式（推荐）

使用 Markdown frontmatter 格式：

```markdown
---
name: my-assistant
version: 1.0.0
agent:
  name: My Assistant
  model: gpt-4o
  maxSteps: 20
  temperature: 0.3
  tools:
    - read
    - write
    - ls
    - bash
model:
  apiKey: ${OPENAI_API_KEY}
  baseUrl: https://api.openai.com/v1
server:
  port: 3000
  host: localhost
logging:
  level: debug
  format: json
---

You are an expert AI assistant. Help users with their tasks efficiently.
```

### JSON 格式

```json
{
  "name": "my-assistant",
  "version": "1.0.0",
  "agent": {
    "name": "My Assistant",
    "model": "gpt-4o",
    "maxSteps": 20,
    "temperature": 0.3,
    "tools": ["read", "write", "ls", "bash"]
  },
  "model": {
    "apiKey": "${OPENAI_API_KEY}",
    "baseUrl": "https://api.openai.com/v1"
  },
  "server": {
    "port": 3000,
    "host": "localhost"
  },
  "logging": {
    "level": "debug",
    "format": "json"
  }
}
```

## 配置选项

### Agent 配置

| 选项           | 类型     | 默认值   | 描述           |
| -------------- | -------- | -------- | -------------- |
| `name`         | string   | -        | Agent 名称     |
| `model`        | string   | `gpt-4o` | 使用的模型     |
| `maxSteps`     | number   | `15`     | 最大执行步数   |
| `temperature`  | number   | `0.7`    | 温度参数       |
| `tools`        | string[] | `[]`     | 启用的工具列表 |
| `systemPrompt` | string   | -        | 系统提示词     |

### 模型配置

| 选项         | 类型   | 默认值  | 描述             |
| ------------ | ------ | ------- | ---------------- |
| `apiKey`     | string | -       | API 密钥         |
| `baseUrl`    | string | -       | API 基础 URL     |
| `timeout`    | number | `30000` | 超时时间（毫秒） |
| `maxRetries` | number | `3`     | 最大重试次数     |

### 服务器配置

| 选项   | 类型    | 默认值      | 描述          |
| ------ | ------- | ----------- | ------------- |
| `port` | number  | `3000`      | 服务器端口    |
| `host` | string  | `localhost` | 服务器主机    |
| `cors` | boolean | `true`      | 是否启用 CORS |

### 日志配置

| 选项     | 类型   | 默认值 | 描述     |
| -------- | ------ | ------ | -------- |
| `level`  | string | `info` | 日志级别 |
| `format` | string | `text` | 日志格式 |

## 环境变量

配置中可以使用环境变量：

```markdown
---
model:
  apiKey: ${OPENAI_API_KEY}
  baseUrl: ${OPENAI_BASE_URL}
---
```

支持的占位符：

- `${VAR_NAME}` - 必需的环境变量
- `${VAR_NAME:default}` - 可选的环境变量，带默认值

## 配置文件位置

AgentForge 会按以下顺序查找配置文件：

1. `./primo.config.md`
2. `./primo.config.json`
3. `./agentforge.config.md`
4. `./agentforge.config.json`
5. `./config/primo.config.md`
6. `./config/agentforge.config.md`

## 加载配置

### 同步加载

```typescript
import { loadConfigSync } from 'agentforge/config';

const config = loadConfigSync();
console.log(config.agent.name);
```

### 异步加载

```typescript
import { loadConfig } from 'agentforge/config';

const config = await loadConfig();
console.log(config.agent.name);
```

### 指定配置路径

```typescript
import { loadConfig } from 'agentforge/config';

const config = await loadConfig('./custom-config.md');
```

## 配置验证

配置会自动验证，如果不符合要求会抛出错误：

```typescript
import { loadConfig } from 'agentforge/config';

try {
  const config = await loadConfig();
} catch (error) {
  console.error('配置验证失败:', error.message);
}
```

## 配置合并

支持从多个文件合并配置：

```typescript
import { loadConfig } from 'agentforge/config';

const config = await loadConfig({
  files: ['./base.config.md', './environment.config.md', './local.config.md'],
});
```

## 类型安全

配置有完整的 TypeScript 类型支持：

```typescript
import type { AgentConfig } from 'agentforge/config';

const config: AgentConfig = {
  agent: {
    name: 'My Agent',
    model: 'gpt-4o',
  },
  // ... 类型检查
};
```

## 下一步

- [Agent API](./agent.md) - 了解如何使用配置创建 Agent
- [工具系统](./tools.md) - 配置和使用工具
