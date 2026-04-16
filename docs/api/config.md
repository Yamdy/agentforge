# 配置 API

配置系统 API 参考。

## loadConfig

```typescript
async function loadConfig(path?: string, options?: LoadConfigOptions): Promise<AgentConfig>;
```

异步加载配置文件。

**参数：**

- `path` - 配置文件路径（可选）
- `options` - 加载选项（可选）

**返回：**

解析后的配置对象

**示例：**

```typescript
// 从默认路径加载
const config = await loadConfig();

// 从指定路径加载
const config = await loadConfig('./custom-config.md');

// 带选项加载
const config = await loadConfig('./config.md', {
  env: 'production',
});
```

## loadConfigSync

```typescript
function loadConfigSync(path?: string, options?: LoadConfigOptions): AgentConfig;
```

同步加载配置文件。

**示例：**

```typescript
const config = loadConfigSync('./config.md');
```

## LoadConfigOptions

```typescript
interface LoadConfigOptions {
  env?: string; // 环境变量
  validate?: boolean; // 是否验证，默认 true
  merge?: boolean; // 是否合并配置，默认 false
}
```

## AgentConfig

完整的配置接口：

```typescript
interface AgentConfig {
  name?: string;
  version?: string;
  agent: {
    name: string;
    model?: string;
    maxSteps?: number;
    temperature?: number;
    tools?: string[];
    systemPrompt?: string;
  };
  model?: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
  };
  server?: {
    port?: number;
    host?: string;
    cors?: boolean;
  };
  logging?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    format?: 'text' | 'json';
  };
  plugins?: PluginConfig[];
}
```

## 配置文件格式

### Markdown 格式

```markdown
---
name: my-agent
version: 1.0.0
agent:
  name: My Agent
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
  timeout: 30000
server:
  port: 3000
  host: localhost
logging:
  level: debug
  format: json
---

You are an expert AI assistant.
```

### JSON 格式

```json
{
  "name": "my-agent",
  "version": "1.0.0",
  "agent": {
    "name": "My Agent",
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
  }
}
```

## 环境变量

配置中可以使用环境变量：

```markdown
---
model:
  apiKey: ${OPENAI_API_KEY}
  baseUrl: ${API_BASE_URL:-https://api.openai.com/v1}
---
```

- `${VAR_NAME}` - 必需的环境变量
- `${VAR_NAME:default}` - 可选的环境变量，带默认值

## 配置验证

配置会自动验证，如果不符合要求会抛出错误：

```typescript
import { ValidationError } from 'agentforge/config';

try {
  const config = await loadConfig();
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('配置验证失败:', error.message);
    console.error('字段:', error.field);
  }
}
```

## 配置合并

可以从多个文件合并配置：

```typescript
const config = await loadConfig({
  files: ['./base.config.md', './environment.config.md', './local.config.md'],
});
```

## 配置类型

```typescript
import type { AgentConfig } from 'agentforge/config';

const config: AgentConfig = {
  agent: {
    name: 'My Agent',
    model: 'gpt-4o',
  },
  // ... 其他配置
};
```

## 配置文件位置

AgentForge 会按以下顺序查找配置文件：

1. `./primo.config.md`
2. `./primo.config.json`
3. `./agentforge.config.md`
4. `./agentforge.config.json`
5. `./config/primo.config.md`
6. `./config/agentforge.config.md`

## 完整示例

```typescript
import { loadConfig, loadConfigSync } from 'agentforge/config';

// 异步加载
async function main() {
  const config = await loadConfig();

  console.log('Agent name:', config.agent.name);
  console.log('Model:', config.agent.model);
  console.log('Max steps:', config.agent.maxSteps);

  // 使用配置创建 Agent
  const agent = createAgent(config);

  const result = await agent.run('Hello!');
  console.log(result);
}

main();

// 同步加载
const config = loadConfigSync('./config.md');
console.log(config);

// 带验证的加载
try {
  const config = await loadConfig('./config.md', {
    validate: true,
  });
} catch (error) {
  console.error('配置错误:', error);
}
```

## 相关文档

- [核心 API](./core.md) - 核心 API
- [工具 API](./tools.md) - 工具系统 API
- [存储 API](./storage.md) - 存储系统 API
