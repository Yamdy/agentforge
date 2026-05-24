# Hook 系统增强设计

## 概述

本设计旨在增强 AgentForge 的 Hook 系统，添加阻塞能力、多执行后端支持、敏感路径保护等功能，同时保持与现有 Plugin 系统的向后兼容。

## 设计决策

| 决策点 | 选择 | 原因 |
|--------|------|------|
| Hook 阻塞行为 | 默认返回结构化错误，框架提供扩展能力 | 平衡安全性和灵活性 |
| 敏感路径配置 | 内置默认列表 + 可扩展 | 开箱即用，支持定制 |
| Hook 执行后端 | function + command + http | 覆盖主要使用场景 |
| 配置加载 | 配置文件 + 编程式 | 两种方式都支持 |
| 架构方案 | 渐进式增强 | 向后兼容，风险低 |

## 架构设计

```
src/
├── hooks/                        # 新增 hooks 模块
│   ├── index.ts                 # 导出入口
│   ├── types.ts                 # 类型定义
│   ├── executor.ts              # Hook 执行器
│   ├── config.ts                # 配置加载器
│   └── agent-integration.ts     # Agent 集成
├── permissions/                  # 扩展权限模块
│   ├── index.ts                 # 现有
│   └── sensitive-paths.ts       # 新增敏感路径
└── plugin/                       # 修改现有
    ├── manager.ts               # 集成 HookExecutor
    └── types.ts                 # 扩展类型
```

## 模块详情

### 1. 类型定义 (src/hooks/types.ts)

```typescript
export type HookType = 'function' | 'command' | 'http';

export type HookEvent =
  | 'PreToolUse'      // 工具执行前（可阻塞）
  | 'PostToolUse'     // 工具执行后
  | 'SessionStart'    // 会话开始
  | 'SessionEnd'      // 会话结束
  | 'PreCompact'      // 上下文压缩前
  | 'PostCompact';    // 上下文压缩后

export interface HookDefinition {
  type: HookType;
  matcher?: string;           // glob 模式匹配工具名
  blockOnFailure: boolean;    // 失败时是否阻塞操作
  timeout?: number;           // 超时时间 (ms)
  
  // function 类型
  handler?: string | HookFunction;
  // command 类型
  command?: string;
  // http 类型
  url?: string;
  headers?: Record<string, string>;
}

export interface HookResult {
  success: boolean;
  blocked: boolean;
  reason?: string;
  output?: string;
}

export interface AggregatedHookResult {
  results: HookResult[];
  blocked: boolean;
  reason: string;
}
```

### 2. HookExecutor (src/hooks/executor.ts)

核心职责：
- 管理和执行所有注册的 Hooks
- 支持 matcher 模式匹配
- 支持超时控制
- 支持三种执行后端：function / command / http

执行流程：
```
execute(event, payload)
  ├── 1. matcher 匹配检查
  ├── 2. 带超时执行 Hook
  │     ├── function: 调用注册的函数
  │     ├── command: spawn 子进程
  │     └── http: fetch 远程端点
  └── 3. 阻塞检查（失败 + blockOnFailure）
```

### 3. 敏感路径保护 (src/permissions/sensitive-paths.ts)

内置敏感路径模式（40+）：
- SSH Keys: `**/.ssh/**`
- Cloud Credentials: `**/.aws/credentials`, `**/.azure/**`
- Kubernetes: `**/.kube/config`
- Environment Files: `**/.env*`
- Secrets: `**/secrets/**`, `**/credentials.json`
- Private Keys: `**/*.pem`, `**/*.key`

配置支持：
```typescript
interface SensitivePathConfig {
  enableBuiltin: boolean;        // 是否启用内置保护
  additionalPatterns: string[];  // 额外敏感路径
  excludePatterns: string[];     // 白名单排除
}
```

### 4. 配置加载 (src/hooks/config.ts)

配置文件格式：
```json
// .agentforge/hooks.json
{
  "hooks": {
    "PreToolUse": [
      {
        "type": "function",
        "handler": "checkSensitivePath",
        "matcher": "read|write|edit|Bash",
        "blockOnFailure": true
      }
    ],
    "PostToolUse": [
      {
        "type": "command",
        "command": "npx prettier --write ${TOOL_INPUT_FILE_PATH}"
      }
    ]
  }
}
```

支持环境变量替换：`${VAR_NAME}`

### 5. Agent 集成 (src/hooks/agent-integration.ts)

生命周期集成：
```
Agent.run()
  ├── SessionStart Hook
  ├── executeLoop()
  │     └── executeToolCall()
  │           ├── PreToolUse Hook (可阻塞)
  │           ├── 执行工具
  │           └── PostToolUse Hook
  └── SessionEnd Hook
```

阻塞时返回结构化错误：
```json
{
  "error": "PermissionDenied",
  "tool": "Bash",
  "reason": "Access denied: sensitive path",
  "hint": "Check hook configuration"
}
```

### 6. PluginManager 兼容 (src/plugin/manager.ts)

兼容策略：
- 双轨并行：旧 Subject 系统和新 HookExecutor 同时工作
- 自动迁移：`register()` 时自动将 Plugin hooks 注册到 HookExecutor
- 默认不阻塞：旧版 Plugin hooks 的 `blockOnFailure` 默认为 `false`
- 新增 API：`executeHook()` 返回阻塞信息

## 配置示例

### 完整配置文件

```json
// .agentforge/config.json
{
  "permissions": {
    "sensitivePaths": {
      "enableBuiltin": true,
      "additionalPatterns": ["**/my-secrets/**"],
      "excludePatterns": ["**/.env.example"]
    }
  },
  "hooks": {
    "PreToolUse": [
      {
        "type": "function",
        "handler": "checkSensitivePath",
        "matcher": "read|write|edit|Read|Write|Edit|bash|Bash",
        "blockOnFailure": true,
        "timeout": 5000
      }
    ],
    "SessionStart": [
      {
        "type": "http",
        "url": "https://api.example.com/hooks/session/start",
        "headers": {
          "Authorization": "Bearer ${WEBHOOK_TOKEN}"
        }
      }
    ]
  }
}
```

### 编程式使用

```typescript
import { Agent } from 'agentforge';
import { HookExecutor } from 'agentforge/hooks';

// 方式1：通过 Agent 配置
const agent = new Agent(adapter, history, registry, {
  hooks: {
    enableSensitivePathProtection: true,
    additionalHooks: new Map([
      ['PreToolUse', [{
        type: 'command',
        command: 'node scripts/validate.js',
        matcher: 'Bash',
        blockOnFailure: true,
      }]]
    ]),
  },
});

// 方式2：直接使用 HookExecutor
const executor = new HookExecutor();
executor.registerFunction('myHook', async (input, output) => {
  return { success: true, blocked: false };
});
executor.register('PreToolUse', {
  type: 'function',
  handler: 'myHook',
  blockOnFailure: false,
});

const result = await executor.execute('PreToolUse', {
  toolName: 'Bash',
  args: { command: 'ls' },
});
```

## 向后兼容

现有代码无需修改：

```typescript
// 旧版 Plugin 格式仍然有效
const myPlugin = {
  name: 'my-plugin',
  hooks: {
    'tool.execute.before': async (input, output) => {
      console.log('Tool executing:', input.tool);
    }
  }
};

pluginManager.register(myPlugin);
```

## 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/hooks/types.ts` | 新增 | 类型定义 |
| `src/hooks/executor.ts` | 新增 | Hook 执行器 |
| `src/hooks/config.ts` | 新增 | 配置加载器 |
| `src/hooks/agent-integration.ts` | 新增 | Agent 集成 |
| `src/hooks/index.ts` | 新增 | 导出入口 |
| `src/permissions/sensitive-paths.ts` | 新增 | 敏感路径保护 |
| `src/plugin/manager.ts` | 修改 | 集成 HookExecutor |
| `src/agent/agent.ts` | 修改 | 添加 Hook 支持 |

## 测试计划

1. **单元测试**
   - HookExecutor 执行逻辑
   - matcher 模式匹配
   - 敏感路径检测
   - 配置加载

2. **集成测试**
   - Agent 生命周期 Hook 触发
   - 阻塞行为验证
   - PluginManager 兼容性

3. **端到端测试**
   - 敏感路径保护场景
   - HTTP Hook 外部集成
   - Command Hook 脚本执行
