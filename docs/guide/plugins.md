# 插件系统

AgentForge 插件系统基于 **Hook 横向切面架构**。插件通过注册 Hook 和事件订阅来扩展 Agent 行为，无需修改核心循环代码。

## 设计原则

- **Hook = 横向切片增强**：通过 Hook 系统在精确的切点注入逻辑
- **DI = 纵向能力替换**：通过接口实现替换核心组件
- **异常隔离**：单个插件的任何错误都不会影响 Agent 主流程的正常运行
- **优先级排序**：多个 Hook 按优先级顺序串联执行（数值越小越先执行）

## Plugin 接口

```typescript
interface Plugin {
  name: string;                       // 唯一标识符
  enabled: boolean;                   // 是否启用
  state?: Record<string, unknown>;    // 跨轮次持久化状态

  // Hook 注册（推荐 API）
  requestHooks?: RequestHook[];       // 修改 LLM 消息列表
  toolHooks?: ToolHook[];             // 工具执行前校验/阻断
  toolProviderHooks?: ToolProviderHook[]; // 动态工具注入/过滤
  lifecycleHooks?: Array<{            // 生命周期切点回调
    name: HookName;
    fn: HookFn;
    priority?: number;
  }>;
  eventSubscriptions?: Array<{        // 事件流异步观察
    event: AgentEventType;
    handler: (e: AgentEvent) => void;
  }>;

  init?(ctx: PluginContext): void | Promise<void>;   // 初始化
  destroy?(): void;                                   // 清理
}
```

### PluginContext（受限上下文）

插件上下文故意不提供 LLM、Tools、Memory、Checkpoint 等核心能力，防止插件绕过依赖注入体系：

```typescript
interface PluginContext {
  readonly sessionId: string;
  readonly agentName: string;
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
}
```

## 快速开始

创建一个最简单的 RequestHook 插件，在每次 LLM 调用前注入系统提示：

```typescript
import type { Plugin } from 'agentforge';
import type { RequestHook } from 'agentforge';
import { DEFAULT_REQUEST_HOOK_PRIORITY } from 'agentforge';
import type { Message, AgentState } from 'agentforge';

const systemPromptHook: RequestHook = {
  name: 'my-system-prompt',
  priority: DEFAULT_REQUEST_HOOK_PRIORITY,

  apply(messages: Message[], _state: AgentState): Message[] {
    return [
      { role: 'system', content: 'You are a helpful assistant.' },
      ...messages,
    ];
  },
};

export const plugin: Plugin = {
  name: 'my-first-plugin',
  enabled: true,
  requestHooks: [systemPromptHook],
};
```

完整示例见 `examples/plugins/03-custom-system-prompt.ts`。

## Hook 类型详解

### RequestHook（请求转换）

在 LLM 调用前修改消息列表。多个 RequestHook 按优先级顺序串联执行，前一个的输出是后一个的输入。

```typescript
interface RequestHook {
  name: string;
  priority: number;
  apply(messages: Message[], state: AgentState): Message[] | Promise<Message[]>;
}
```

**适用场景**：
- 注入系统提示词（如 AGENTS.md 上下文）
- 注入记忆上下文（MemoryPlugin）
- 注入技能指令（SkillsPlugin）
- 压缩对话历史（SummarizationPlugin）

**完整示例**：`examples/plugins/03-custom-system-prompt.ts`

### ToolHook（工具验证）

在工具执行前进行权限检查或阻断。按优先级顺序运行，任一返回 `false` 即阻止执行，后续 Hook 不再运行。

```typescript
interface ToolHook {
  name: string;
  priority: number;
  beforeExecute(toolCall: ToolCall, state: AgentState): boolean | Promise<boolean>;
}
```

```typescript
// 示例：阻止危险的 bash 命令
const securityHook: ToolHook = {
  name: 'security-gate',
  priority: 10,
  beforeExecute(toolCall, _state) {
    if (toolCall.name === 'bash') {
      const cmd = toolCall.args['command'];
      if (typeof cmd === 'string' && cmd.includes('rm -rf')) {
        return false; // 阻止
      }
    }
    return true; // 放行
  },
};
```

**适用场景**：
- 权限控制（阻止高危操作）
- 频率限制（节流工具调用）
- 审计日志（记录所有工具调用）

**完整示例**：`examples/plugins/01-permission-gate.ts`

### ToolProviderHook（动态工具注入）

在 LLM 看到工具列表**之前**过滤或扩展工具定义。与 ToolHook 的关键区别：ToolProviderHook 影响 LLM 的决策空间（LLM 看不到被过滤的工具），而 ToolHook 在 LLM 已选择工具后才介入。

```typescript
interface ToolProviderHook {
  name: string;
  priority: number;
  filter(
    tools: FunctionDefinition[],
    state: AgentState
  ): FunctionDefinition[] | Promise<FunctionDefinition[]>;
}
```

```typescript
// 示例：根据 Agent 步骤阶段逐步开放工具
const phaseHook: ToolProviderHook = {
  name: 'phase-gate',
  priority: 40,
  filter(tools, state) {
    if (state.step <= 3) {
      // 前 3 步只允许只读工具
      return tools.filter(t => !t.name.startsWith('write'));
    }
    return tools; // 后续步骤开放全部
  },
};
```

**适用场景**：
- 沙箱就绪检查（仅当后端可用时注入 execute 工具）
- 阶段化工具开放（规划阶段只给计划工具，执行阶段给全部工具）
- 模型能力适配（移除当前模型不支持的工具）

**完整示例**：`examples/plugins/04-tool-profiler.ts`

### LifecycleHook（生命周期切点）

在 Agent 生命周期的精确切点执行回调。采用 `(input, output) => void` 签名模式，input 为切点上下文，output 为结果数据（"before" 切点中 output 为 `{}`）。

**所有可用切点**：

| 切点名称 | 触发时机 | input 内容 | output 内容 |
|----------|----------|-----------|-------------|
| `session.start` | 会话开始 | 会话元数据 | {} |
| `session.end` | 会话结束 | 会话元数据 | 最终输出 |
| `step.begin` | 每步开始 | step 计数 | {} |
| `step.end` | 每步结束 | step 计数 | 步骤结果 |
| `llm.request.before` | LLM 调用前 | messages, model | {} |
| `llm.response.after` | LLM 响应后 | messages, model | 响应数据 |
| `llm.error` | LLM 调用出错 | 请求信息 | 错误信息 |
| `tool.execute.before` | 工具执行前 | toolName, toolCallId, args | {} |
| `tool.execute.after` | 工具执行后 | toolName, toolCallId | 执行结果 |
| `tool.execute.error` | 工具执行出错 | toolName, toolCallId | 错误信息 |
| `compaction.before` | 压缩前 | messages | {} |
| `compaction.after` | 压缩后 | messages | 压缩结果 |
| `recovery.escalate` | 恢复升级 | 错误上下文 | 升级结果 |
| `recovery.compact` | 恢复压缩 | 状态信息 | 压缩结果 |
| `recovery.fallback` | 恢复降级 | 错误信息 | 降级结果 |

```typescript
// 示例：测量工具执行耗时
const plugin: Plugin = {
  name: 'tool-timer',
  enabled: true,
  lifecycleHooks: [
    {
      name: 'tool.execute.before',
      fn(input) {
        const ctx = input as { toolCallId: string };
        timers.set(ctx.toolCallId, Date.now());
      },
    },
    {
      name: 'tool.execute.after',
      fn(_input, output) {
        const ctx = output as { toolCallId: string };
        const start = timers.get(ctx.toolCallId);
        if (start) {
          console.log(`Duration: ${Date.now() - start}ms`);
          timers.delete(ctx.toolCallId);
        }
      },
    },
  ],
};
```

**适用场景**：
- 性能分析（测量各阶段耗时）
- 日志记录（在关键切点输出结构化日志）
- 监控告警（异常发生时触发外部通知）

**完整示例**：`examples/plugins/02-request-logger.ts` 和 `examples/plugins/04-tool-profiler.ts`

### eventSubscriptions（事件订阅）

通过 AgentEventEmitter 异步订阅事件流，纯观察模式，不阻塞主流程。

```typescript
eventSubscriptions?: Array<{
  event: AgentEventType;       // 事件类型
  handler: (e: AgentEvent) => void | Promise<void>;  // 异步处理器
}>;
```

```typescript
// 示例：统计 token 用量
const plugin: Plugin = {
  name: 'token-counter',
  enabled: true,
  state: { totalTokens: 0 },
  eventSubscriptions: [
    {
      event: 'llm.response',
      handler(event) {
        if (event.type === 'llm.response' && event.usage) {
          plugin.state!.totalTokens = (plugin.state!.totalTokens as number)
            + (event.usage.promptTokens ?? 0)
            + (event.usage.completionTokens ?? 0);
        }
      },
    },
  ],
};
```

**注意**：处理器中的异常会被自动捕获并隔离，不会影响 Agent 循环。

**与 LifecycleHook 的区别**：
- LifecycleHook 在循环入口处同步调用，适合需要在精确时机执行的逻辑
- eventSubscriptions 通过事件发射器异步分发，适合持续统计和外部上报

**完整示例**：`examples/plugins/02-request-logger.ts`

## 优先级系统

### RequestHook 优先级常量

多个 RequestHook 按优先级顺序执行。数值越小，越早执行。使用 `RequestHookPriority` 常量确保与内置 Hook 的正确排序：

| 常量 | 数值 | 说明 | 负责组件 |
|------|------|------|----------|
| `MEMORY` | 10 | 持久记忆 / AGENTS.md 上下文 | MemoryPlugin |
| `WORKING_MEMORY` | 20 | 工作记忆（钉选条目、暂存区） | 框架内置 |
| `SKILL` | 30 | 技能指令 / 领域知识 | SkillsPlugin |

使用示例：

```typescript
import { DEFAULT_REQUEST_HOOK_PRIORITY } from 'agentforge';

const myHook: RequestHook = {
  name: 'my-hook',
  priority: DEFAULT_REQUEST_HOOK_PRIORITY, // 在所有内置 Hook 之后执行
  apply(messages, state) { ... },
};
```

### ToolHook 和 ToolProviderHook 优先级

这两类 Hook 也支持 priority 字段，但没有预定义的常量表。通常：
- **10**：安全相关（最早执行）
- **20-40**：业务逻辑
- **50**：默认 / 用户自定义

### LifecycleHook 优先级

```typescript
lifecycleHooks: [
  { name: 'tool.execute.before', fn: onBefore, priority: 10 }, // 先执行
  { name: 'tool.execute.before', fn: onBefore2, priority: 50 }, // 后执行
],
```

同一切点的多个 Hook 按 priority 升序执行。未指定时默认为 50。

## 插件状态（state）

`Plugin.state` 是一个框架管理的跨轮次持久化对象。插件可以在此存储任意数据，并在后续 Hook 调用中读取修改。

```typescript
const plugin: Plugin = {
  name: 'counter',
  enabled: true,
  state: {
    requestCount: 0,
    errorCount: 0,
  },

  lifecycleHooks: [
    {
      name: 'llm.request.before',
      fn() {
        // 直接修改 state — 引用在整个会话中保持不变
        plugin.state!.requestCount = (plugin.state!.requestCount as number) + 1;
      },
    },
  ],
};
```

**注意事项**：
- state 由插件完全拥有，框架不会修改它
- state 在整个会话生命周期内保持引用不变
- 适合存储计数、配置快照、临时缓存等跨轮次数据
- 不适合存储大量数据（不会自动压缩或持久化到 checkpoint）

## 注册方式

### 编译时注册（plugins 字段）

在 `createAgent` 配置中直接传入插件数组。适合静态、编译时确定的插件集合：

```typescript
import { createAgent } from 'agentforge';
import { plugin as permissionGate } from './plugins/01-permission-gate.js';
import { plugin as requestLogger } from './plugins/02-request-logger.js';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  plugins: [permissionGate, requestLogger],
});
```

### 动态加载（pluginSpecs 字段）

通过插件规约字符串从 npm 或本地路径动态加载。适合配置驱动、运行时加载的场景：

```typescript
const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  pluginSpecs: [
    { source: 'agentforge-plugin-audit@^1.0.0' },  // npm 包
    { source: './my-custom-plugin' },               // 本地路径
  ],
});
```

plugins 和 pluginSpecs 可以同时使用，两者互不冲突。

### L3 API 手动注册

在编程式 API 中，直接操作 HookRegistry 和 AgentEventEmitter：

```typescript
import { HookRegistry, AgentEventEmitter, applyPlugins } from 'agentforge';

const hooks = new HookRegistry();
const emitter = new AgentEventEmitter();

// 应用插件（自动注册所有 Hook 和事件订阅）
const cleanup = applyPlugins(plugins, hooks, emitter, pluginContext);

// 或者手动注册单个 Hook
hooks.registerRequest(myRequestHook);
hooks.registerTool(myToolHook);
hooks.registerToolProvider(myToolProviderHook);
hooks.registerLifecycle(myLifecycleHooks);
```

## PluginLoader

`PluginLoader` 提供运行时的插件安装、版本检查和动态导入能力。

### 插件规约格式

```typescript
interface PluginSpec {
  source: string;                      // "pkg@version" 或 "./local-path"
  options?: Record<string, unknown>;   // 传递给插件的配置
}
```

支持的 source 格式：
- `"my-plugin@^1.0.0"` -- npm 包，指定版本范围
- `"@scope/my-plugin@latest"` -- scoped npm 包
- `"file://./local-dir"` -- 本地文件路径
- `"./relative/path"` -- 相对路径

### 插件包约定

npm 插件包的 `package.json` 需通过以下方式之一指定入口：

1. `exports["./agentforge"]`（推荐）
2. `agentforge` 字段
3. `main` 字段（兜底）

插件入口需导出一个 `server` 工厂函数：

```typescript
// 插件包的导出
export async function server(
  input: { sessionId: string; agentName: string; directory: string },
  options?: Record<string, unknown>
): Promise<Plugin> {
  return {
    name: 'my-plugin',
    enabled: true,
    requestHooks: [...],
    init(ctx) { ... },
  };
}
```

### 兼容性检查

插件通过 `package.json` 中的 `engines.agentforge` 字段声明版本要求：

```json
{
  "name": "agentforge-plugin-audit",
  "engines": {
    "agentforge": ">=1.0.0"
  }
}
```

PluginLoader 在加载前自动检查兼容性。0.x 版本的框架始终兼容。

### 程序化加载

```typescript
import { PluginLoader, type PluginSpec } from 'agentforge';

const specs: PluginSpec[] = [
  { source: 'agentforge-plugin-audit@^1.0.0' },
  { source: './my-local-plugin' },
];

const results = await PluginLoader.loadAll(
  specs,
  pluginContext,  // PluginContext
  hookRegistry,   // HookRegistry
  emitter,        // AgentEventEmitter
);

// 检查加载结果
for (const result of results) {
  if (!result.success) {
    console.error(`Failed to load ${result.spec}: ${result.error?.message}`);
  }
}
```

## 从旧 API 迁移

如果你有基于旧版 `InterceptorPlugin` 或 `ObserverPlugin` 的插件，迁移到新 API 非常简单。

### InterceptorPlugin → RequestHook + ToolHook

**旧代码**（拦截器模式）：

```typescript
const oldPlugin: InterceptorPlugin = {
  name: 'my-plugin',
  type: 'interceptor',
  priority: 10,
  eventTypes: ['llm.request', 'tool.call'],
  enabled: true,

  intercept(event, ctx) {
    if (event.type === 'llm.request') {
      // 修改 messages ...
      return { continue: true, event };
    }
    if (event.type === 'tool.call') {
      // 检查工具权限 ...
      return { continue: false };
    }
    return { continue: true, event };
  },
};
```

**新代码**（Hook 模式）：

```typescript
const newPlugin: Plugin = {
  name: 'my-plugin',
  enabled: true,

  // llm.request 拦截 → RequestHook
  requestHooks: [{
    name: 'my-request-modifier',
    priority: 10,
    apply(messages, state) {
      // 修改 messages ...
      return messages;
    },
  }],

  // tool.call 拦截 → ToolHook
  toolHooks: [{
    name: 'my-tool-gate',
    priority: 10,
    beforeExecute(toolCall, state) {
      // 检查工具权限 ...
      return false; // 阻止
    },
  }],
};
```

### ObserverPlugin → eventSubscriptions + LifecycleHook

**旧代码**（观察器模式）：

```typescript
const oldPlugin: ObserverPlugin = {
  name: 'my-logger',
  type: 'observer',
  priority: 100,
  eventTypes: ['agent.complete', 'agent.error'],
  enabled: true,

  observe(event, ctx) {
    console.log(`Event: ${event.type}`);
  },
};
```

**新代码**（事件订阅模式）：

```typescript
const newPlugin: Plugin = {
  name: 'my-logger',
  enabled: true,

  eventSubscriptions: [
    {
      event: 'agent.complete',
      handler(event) { console.log('Completed:', event); },
    },
    {
      event: 'agent.error',
      handler(event) { console.error('Error:', event); },
    },
  ],
};
```

### 迁移对照表

| 旧 API | 新 API |
|--------|--------|
| `intercept()` 修改 llm.request | `requestHooks` RequestHook |
| `intercept()` 拦截 tool.call | `toolHooks` ToolHook |
| `intercept()` 修改行内工具列表 | `toolProviderHooks` ToolProviderHook |
| `observe()` 观察事件 | `eventSubscriptions` 事件订阅 |
| `intercept()` 初始化副作用 | `init()` 方法 |
| `type: 'interceptor'` | 不再需要 |
| `type: 'observer'` | 不再需要 |
| `priority` 字段 | Hook 级别的 `priority` |
| `eventTypes` 过滤 | Hook 内部自行判断 |

## 完整示例

四个可运行的示例插件位于 `examples/plugins/` 目录：

| 文件 | 演示内容 |
|------|----------|
| `examples/plugins/01-permission-gate.ts` | ToolHook — 阻止危险 bash 命令 |
| `examples/plugins/02-request-logger.ts` | LifecycleHook + eventSubscription — LLM 交互日志 |
| `examples/plugins/03-custom-system-prompt.ts` | RequestHook — 注入自定义系统提示 |
| `examples/plugins/04-tool-profiler.ts` | ToolProviderHook + LifecycleHook — 工具性能分析 |

运行示例：

```bash
npx tsx examples/plugins/01-permission-gate.ts
```

## 相关 API

- [Plugin 接口](/api#plugin-接口) -- 插件类型定义
- [Hook 系统](/guide/core-concepts) -- Hook 切点机制
- [事件类型](/guide/events) -- 完整事件类型列表
