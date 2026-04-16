# 插件系统

AgentForge 的插件系统允许你扩展框架功能，添加新的工具、适配器和中间件。

## 插件接口

```typescript
interface Plugin {
  name: string;
  version: string;
  setup(context: PluginContext): void | Promise<void>;
  teardown?(): void | Promise<void>;
}

interface PluginContext {
  agent: Agent;
  config: AgentConfig;
  registerTool(tool: Tool): void;
  registerAdapter(name: string, adapter: LLMAdapter): void;
  registerMiddleware(middleware: Middleware): void;
}
```

## 创建插件

### 基本插件

```typescript
import { Plugin, Tool } from 'agentforge/types';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',

  setup(context) {
    // 注册工具
    context.registerTool({
      name: 'my_tool',
      description: '我的工具',
      async execute(args) {
        return 'Hello from plugin!';
      },
    });
  },
};
```

### 工具插件

```typescript
const toolsPlugin: Plugin = {
  name: 'tools-plugin',
  version: '1.0.0',

  setup(context) {
    context.registerTool({
      name: 'calculator',
      description: '计算器工具',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '数学表达式' },
        },
        required: ['expression'],
      },
      async execute(args) {
        try {
          const result = eval(args.expression);
          return { result, success: true };
        } catch (error) {
          return { result: null, success: false, error: error.message };
        }
      },
    });

    context.registerTool({
      name: 'timestamp',
      description: '获取当前时间戳',
      async execute() {
        return { timestamp: Date.now(), iso: new Date().toISOString() };
      },
    });
  },
};
```

### 适配器插件

```typescript
const adaptersPlugin: Plugin = {
  name: 'adapters-plugin',
  version: '1.0.0',

  setup(context) {
    context.registerAdapter(
      'custom',
      class CustomAdapter {
        name = 'custom';

        async chat(params) {
          // 自定义适配器实现
          return { content: 'Response from custom adapter' };
        }

        async *stream(params) {
          yield { content: 'Stream from custom adapter' };
        }
      }
    );
  },
};
```

### 中间件插件

```typescript
const middlewarePlugin: Plugin = {
  name: 'middleware-plugin',
  version: '1.0.0',

  setup(context) {
    context.registerMiddleware({
      name: 'logging',
      async beforeToolCall(context) {
        console.log(`[Plugin] Tool call: ${context.tool.name}`);
      },
      async afterToolCall(context) {
        console.log(`[Plugin] Tool result: ${context.result}`);
      },
    });
  },
};
```

### 复杂插件

```typescript
const advancedPlugin: Plugin = {
  name: 'advanced-plugin',
  version: '1.0.0',

  async setup(context) {
    // 注册多个工具
    context.registerTool(httpTool);
    context.registerTool(databaseTool);
    context.registerTool(cacheTool);

    // 注册适配器
    context.registerAdapter('custom', CustomAdapter);

    // 注册中间件
    context.registerMiddleware(loggerMiddleware);
    context.registerMiddleware(cacheMiddleware);

    // 初始化插件状态
    this.state = {
      cache: new Map(),
      stats: {
        calls: 0,
        hits: 0,
      },
    };
  },

  async teardown() {
    // 清理资源
    this.state.cache.clear();
    console.log('Plugin teardown complete');
  },
};
```

## 使用插件

### 注册插件

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent(config);

// 注册插件
agent.registerPlugin(myPlugin);
agent.registerPlugin(toolsPlugin);
agent.registerPlugin(middlewarePlugin);
```

### 从配置加载插件

````typescript
// primo.config.md
```markdown
---
name: my-agent
plugins:
  - name: tools-plugin
    version: 1.0.0
  - name: middleware-plugin
    version: 1.0.0
---
````

```typescript
const config = await loadConfig();
const agent = createAgent(config);

// 自动加载配置中的插件
await agent.loadPlugins();
```

### 从目录加载插件

```typescript
import * as fs from 'fs';
import * as path from 'path';

const pluginsDir = path.join(__dirname, 'plugins');
const pluginFiles = fs.readdirSync(pluginsDir).filter((f) => f.endsWith('.ts'));

for (const file of pluginFiles) {
  const module = await import(path.join(pluginsDir, file));
  const plugin = module.default || module.plugin;

  if (plugin) {
    agent.registerPlugin(plugin);
  }
}
```

## 插件依赖

### 声明依赖

```typescript
const dependentPlugin: Plugin = {
  name: 'dependent-plugin',
  version: '1.0.0',
  dependencies: ['base-plugin', 'tools-plugin'],

  setup(context) {
    // 依赖的插件已加载
    console.log('Dependencies loaded');
  },
};
```

### 依赖解析

```typescript
class PluginManager {
  private plugins = new Map<string, Plugin>();
  private loaded = new Set<string>();

  async load(plugin: Plugin) {
    // 加载依赖
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.loaded.has(dep)) {
          const depPlugin = this.plugins.get(dep);
          if (!depPlugin) {
            throw new Error(`Missing dependency: ${dep}`);
          }
          await this.load(depPlugin);
        }
      }
    }

    // 加载插件
    await plugin.setup(this.context);
    this.loaded.add(plugin.name);
  }
}
```

## 插件配置

```typescript
interface PluginConfig {
  name: string;
  version?: string;
  enabled?: boolean;
  config?: Record<string, any>;
}
```

````typescript
// primo.config.md
```markdown
---
plugins:
  - name: cache-plugin
    enabled: true
    config:
      maxSize: 1000
      ttl: 3600
---
````

```typescript
const cachePlugin: Plugin = {
  name: 'cache-plugin',
  version: '1.0.0',

  setup(context) {
    const config = context.config.plugins?.find((p) => p.name === 'cache-plugin');
    const maxSize = config?.config?.maxSize || 1000;
    const ttl = config?.config?.ttl || 3600;

    // 使用配置
    this.cache = new Map();
    this.ttl = ttl;
  },
};
```

## 插件生命周期

```typescript
const lifecyclePlugin: Plugin = {
  name: 'lifecycle-plugin',
  version: '1.0.0',

  async setup(context) {
    console.log('Plugin setup');

    // 初始化
    await this.initialize();

    // 监听事件
    context.agent.on('state_change', this.onStateChange);
  },

  async teardown() {
    console.log('Plugin teardown');

    // 清理事件监听
    context.agent.off('state_change', this.onStateChange);

    // 释放资源
    await this.cleanup();
  },

  async initialize() {
    // 初始化逻辑
  },

  async cleanup() {
    // 清理逻辑
  },

  onStateChange(state) {
    console.log('State changed:', state);
  },
};
```

## 插件通信

```typescript
const communicationPlugin: Plugin = {
  name: 'communication-plugin',
  version: '1.0.0',

  setup(context) {
    // 监听其他插件的事件
    context.agent.on('plugin:tools-plugin:tool_executed', (data) => {
      console.log('Tool executed:', data);
    });

    // 发送事件
    context.agent.emit('plugin:communication-plugin:ready', {
      timestamp: Date.now(),
    });
  },
};
```

## 插件测试

```typescript
import { describe, it, expect, vi } from 'vitest';
import { myPlugin } from './my-plugin';

describe('myPlugin', () => {
  it('should register tools', async () => {
    const registerTool = vi.fn();
    const context = { registerTool };

    await myPlugin.setup(context);

    expect(registerTool).toHaveBeenCalled();
  });

  it('should setup correctly', async () => {
    const context = {
      registerTool: vi.fn(),
      registerAdapter: vi.fn(),
      registerMiddleware: vi.fn(),
    };

    await myPlugin.setup(context);

    expect(context.registerTool).toHaveBeenCalled();
  });
});
```

## 完整示例

```typescript
import { Plugin, Tool, Middleware, LLMAdapter } from 'agentforge/types';

export const comprehensivePlugin: Plugin = {
  name: 'comprehensive-plugin',
  version: '1.0.0',
  dependencies: ['base-plugin'],

  async setup(context) {
    // 注册工具
    context.registerTool({
      name: 'enhanced_search',
      description: '增强的搜索工具',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询' },
          limit: { type: 'number', default: 10 },
        },
        required: ['query'],
      },
      async execute(args) {
        // 实现搜索逻辑
        return { results: [], count: 0 };
      },
    });

    // 注册中间件
    context.registerMiddleware({
      name: 'enhanced_logging',
      async beforeToolCall(context) {
        console.log(`[Enhanced] ${context.tool.name} called`);
      },
    });

    // 初始化状态
    this.state = {
      metrics: {
        calls: 0,
        errors: 0,
      },
    };

    // 监听事件
    context.agent.on('error', this.onError.bind(this));
  },

  async teardown() {
    console.log('Plugin metrics:', this.state.metrics);
  },

  onError(error) {
    this.state.metrics.errors++;
  },
};
```

## 最佳实践

1. **单一职责**：每个插件只负责一个功能
2. **清晰接口**：提供清晰的插件接口
3. **错误处理**：妥善处理插件错误
4. **资源管理**：正确管理插件资源
5. **文档完善**：提供完整的插件文档
6. **测试覆盖**：编写完整的插件测试

## 下一步

- [测试](./testing.md) - 学习如何测试
- [部署](./deployment.md) - 了解部署方案
