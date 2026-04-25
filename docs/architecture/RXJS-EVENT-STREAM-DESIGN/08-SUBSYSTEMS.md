# 子系统扩展

> 本文档定义 AgentForge 的子系统扩展模型，包括 SubAgent 委托、MCP 工具、Workflow 编排和 Skill 知识包的统一处理。

---

## 核心问题：嵌套 Observable

Agent Loop 执行 `tool.call` 时，可能是：

- **本地工具**: 同步执行 `tool.execute(args)`
- **Subagent 委托**: 嵌套的 `Observable<AgentEvent>`
- **MCP 工具**: 远程 JSON-RPC 调用

三种模式需要统一为事件流。

---

## 统一模型：嵌套流展平

```typescript
private handleToolCall(event: AgentEvent, state: AgentState, ctx: AgentContext): Observable<AgentEvent> {
  const call = event as Extract<AgentEvent, { type: 'tool.call' }>;

  // 1. Subagent 委托
  if (ctx.subagents?.has(call.toolName)) {
    return concat(
      // Layer 2 事件：subagent 生命周期
      of({
        type: 'subagent.start',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        subagentName: call.toolName,
        input: call.args,
      }),

      // 嵌套流：所有事件冒泡到父级（带上下文标记）
      ctx.subagents.run(call.toolName, call.args.input).pipe(
        map((e) => ({
          ...e,
          // 标记来源，用于追溯
          parentId: call.toolCallId,
          parentSessionId: ctx.sessionId,
        })),
      ),

      // Layer 2 事件：subagent 完成
      of({
        type: 'subagent.complete',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        subagentName: call.toolName,
        output: '...', // 从嵌套流的最后事件获取
      }),
    );
  }

  // 2. MCP 工具
  if (ctx.mcp && isMcpTool(call.toolName)) {
    return concat(
      of({ type: 'tool.execute', ...call }),

      // MCP 调用（可能超时）
      defer(() => ctx.mcp!.callTool(call.toolName, call.args)).pipe(
        timeout(ctx.mcp!.options?.timeout ?? 30000),
        map((result) => ({
          type: 'tool.result',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          result,
          isError: false,
        })),
        catchError((error) => of({
          type: 'tool.error',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          error,
        })),
      ),
    );
  }

  // 3. 本地工具
  return concat(
    of({ type: 'tool.execute', ...call }),

    defer(() => ctx.tools.execute(call.toolName, call.args)).pipe(
      // 流式工具结果（如 bash 长输出）
      mergeMap((result) => {
        if (typeof result === 'string') {
          return of({
            type: 'tool.result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            result,
          });
        }
        // 如果工具返回 Observable，逐块发送
        if (result instanceof Observable) {
          return result.pipe(
            map((chunk) => ({
              type: 'tool.result.delta',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              delta: chunk,
            })),
            // 最后发送完整结果
            last(),
            map((final) => ({
              type: 'tool.result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              result: final,
            })),
          );
        }
        return of({
          type: 'tool.result',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          result: JSON.stringify(result),
        });
      }),
      catchError((error) => of({
        type: 'tool.error',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        error,
      })),
    ),
  );
}
```

---

## Workflow 作为高层抽象

Workflow 不是 Agent Loop 内部机制，而是 Agent 之上的编排层。每个 step 内部调用 `agent.run()`，事件冒泡到顶层。

```typescript
// Workflow 执行时的事件流
const workflow$ = workflow.run({ topic: 'AI' }).pipe(
  // 过滤 workflow 层事件 + 嵌套的 agent 事件
  filter((e) => e.type.startsWith('workflow.') || e.type.startsWith('agent.')),
  tap(tracer.record),
);

// Workflow step 内部
class WorkflowExecutor {
  async executeStep(step: WorkflowStep, input: unknown): Promise<unknown> {
    // 发出 workflow.step.start 事件
    this.emit({ type: 'workflow.step.start', stepId: step.id, input });

    // 调用 Agent（嵌套流）
    const result = await firstValueFrom(
      this.agent.run(step.prompt(input)).pipe(
        filter((e) => e.type === 'agent.complete'),
        map((e) => e.output),
      ),
    );

    // 发出 workflow.step.end 事件
    this.emit({ type: 'workflow.step.end', stepId: step.id, output: result });

    return result;
  }
}
```

---

## Skill 作为知识包

> ⚠️ **重要修正**：Skill 不是"执行子系统"，也不是"Tool 包装"。Skill 是**可复用的知识包**，提供领域特定指令和工作流模板。

### 行业标准定义

经过对 Semantic Kernel、CrewAI、LangChain、PraisonAI 等框架的研究，行业共识为：

| 框架 | Skill 定义 |
|------|-----------|
| **Semantic Kernel** | 改名为 **Plugin** = 函数集合，是 Tool 分组 |
| **CrewAI** | **Prompt 注入** = markdown 指令，修正 Agent 行为 |
| **LangChain** | **动态加载的专家知识**，通过 `load_skill` 工具访问 |
| **PraisonAI/Qwen-Code** | **SKILL.md 知识包**，静态文件 + frontmatter |

**核心共识**：Skill 是**知识载体**，不执行代码，不编排流程。

### 正确的层次定位

```
┌─────────────────────────────────────────────────────────────────┐
│                          AGENT                                  │
│                    (目标驱动的编排器)                            │
│   - 理解目标，规划步骤                                           │
│   - 调用工具执行操作                                             │
│   - 加载技能获取知识                                             │
│   - 委托子代理处理子任务                                         │
└─────────────────────────────────────────────────────────────────┘
                  │                    │                    │
         ┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐
         ▼                 ▼  ▼                 ▼  ▼                 ▼
    ┌─────────┐      ┌──────────┐      ┌─────────────┐
    │  TOOL   │      │  SKILL   │      │  SUBAGENT   │
    │ 原子操作 │      │ 知识包    │      │ 子代理      │
    ├─────────┤      ├──────────┤      ├─────────────┤
    │ 可执行   │      │ 静态文件  │      │ 嵌套 Agent  │
    │ 确定性   │      │ 指导性    │      │ 可递归      │
    │ 无状态   │      │ 按需加载  │      │ 独立上下文  │
    └─────────┘      └──────────┘      └─────────────┘

关键区别：
- Tool 是「手」：执行具体操作
- Skill 是「脑的知识」：指导如何使用手（引用 Tool 在其指令中）
- SubAgent 是「助手」：能独立完成子任务（有 LLM，可执行）
```

### Skill 接口定义

```typescript
// src/skill/types.ts

/** Skill 元数据（来自 SKILL.md frontmatter） */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  version: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  
  /** 允许使用的工具（可选约束） */
  allowedTools: z.array(z.string()).optional(),
  
  /** 触发关键词（用于自动发现） */
  triggers: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  
  /** 兼容性标记 */
  compatibility: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** Skill 完整信息 */
export interface SkillInfo {
  frontmatter: SkillFrontmatter;
  /** SKILL.md 的 Markdown 内容（指令部分） */
  content: string;
  /** 文件路径 */
  location: string;
  /** 最后更新时间 */
  updatedAt: Date;
}
```

### Skill 文件格式（行业标准）

采用 Anthropic 定义的 **SKILL.md** 格式：

```markdown
---
name: git-release
description: Create consistent git releases with changelogs
version: "1.0"
author: agentforge-team
license: MIT
allowed-tools:
  - bash
  - read
  - write
triggers:
  - release
  - changelog
keywords:
  - git
  - version
  - semver
---

# Git Release Skill

## 工作流程

当创建一个新版本发布时：

1. **验证版本号**
   - 使用 `read` 工具检查 package.json 中的版本
   - 确保版本号符合 semver 规范

2. **生成变更日志**
   - 使用 `bash` 工具运行 `git log --oneline v<prev>..HEAD`
   - 按类型分类变更（feat/fix/docs/refactor）

3. **创建标签**
   - 使用 `bash` 工具运行 `git tag -a v<version> -m "..."`
   - 推送标签到远程

4. **更新 CHANGELOG.md**
   - 使用 `write` 工具更新变更日志文件

## 注意事项

- 遵循 Conventional Commits 规范
- 检查是否有未提交的更改
- 确保所有测试通过
```

---

## 事件冒泡规则

| 子系统事件 | 冒泡行为 |
|----------|---------|
| `agent.*` (嵌套) | 直接冒泡，加 `parentSessionId` |
| `subagent.*` | 在嵌套 agent 事件外层包裹 |
| `mcp.*` | 不冒泡，仅在 MCP 客户端内部 |
| `workflow.*` | 直接冒泡，嵌套的 agent 事件加 `workflowId` |
| `skill.*` | 不产生事件流事件；加载结果注入 Agent 上下文 |
| `compaction.*` | 不冒泡，内部操作 |
| `permission.*` | 不冒泡，内部操作（但可通过 HITL 暴露） |

> ⚠️ **注意**：Skill 不是执行子系统，不产生低延迟事件流事件。`load_skill` 工具的返回是同步的知识内容注入。

---

## MCP Client 传输层设计

> 基于官方 TypeScript SDK v2 (`@modelcontextprotocol/client`) 和 Model Context Protocol Specification `2025-11-25`

### 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      AgentForge MCP Client                       │
├─────────────────────────────────────────────────────────────────┤
│  MCPClient (implements interfaces.ts)                            │
│  ├── connect(config: MCPServerConfig)                           │
│  ├── tools(): Promise<MCPTool[]>                                │
│  ├── callTool(name, args): Promise<string>                      │
│  └── onStatusChange(): Observable<Status>                        │
├─────────────────────────────────────────────────────────────────┤
│  Transport 抽象层                                                 │
│  ├── send(message: JSONRPCMessage): Promise<void>               │
│  ├── onmessage?: (message: JSONRPCMessage) => void              │
│  └── close(): Promise<void>                                      │
├────────────────────────┬────────────────────────────────────────┤
│  StdioTransport         │  StreamableHTTPTransport                │
│  ├── spawn process      │  ├── POST for requests                 │
│  ├── stdin → JSON-RPC   │  ├── GET for SSE stream                │
│  └── stdout → JSON-RPC  │  └── mcp-session-id 管理               │
└────────────────────────┴────────────────────────────────────────┘
```

### 传输层接口

```typescript
// src/mcp/transport.ts

import { Observable } from 'rxjs';

/** JSON-RPC 2.0 消息类型 */
export type JSONRPCMessage =
  | JSONRPCRequest
  | JSONRPCNotification
  | JSONRPCResponse;

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export type JSONRPCResponse =
  | { jsonrpc: '2.0'; id: string | number; result: unknown }
  | { jsonrpc: '2.0'; id: string | number; error: { code: number; message: string; data?: unknown } };

/** MCP 传输层抽象 */
export interface MCPTransport {
  /** 连接到服务器 */
  connect(): Promise<void>;

  /** 断开连接 */
  close(): Promise<void>;

  /** 发送消息 */
  send(message: JSONRPCMessage): Promise<void>;

  /** 消息回调 */
  onmessage?: (message: JSONRPCMessage) => void;

  /** 错误回调 */
  onerror?: (error: Error) => void;

  /** 关闭回调 */
  onclose?: () => void;
}

/** 传输层状态 */
export type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
```

### Stdio Transport 实现

```typescript
// src/mcp/stdio-transport.ts

import { spawn, ChildProcess } from 'child_process';
import { ReadBuffer } from './read-buffer.js';

export interface StdioTransportConfig {
  /** 要执行的命令 */
  command: string;
  /** 命令行参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
}

/**
 * Stdio Transport - 通过 stdin/stdout 与子进程通信
 *
 * 协议格式：每行一个 JSON-RPC 消息（newline-delimited JSON）
 *
 * 适用场景：
 * - 本地 MCP 服务器（如 @modelcontextprotocol/server-filesystem）
 * - 无网络开销
 * - 进程生命周期由 AgentForge 管理
 */
export class StdioTransport implements MCPTransport {
  private _process?: ChildProcess;
  private _readBuffer = new ReadBuffer();
  private _status: TransportStatus = 'disconnected';

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(private config: StdioTransportConfig) {}

  async connect(): Promise<void> {
    this._status = 'connecting';

    // 构建环境变量（继承默认变量）
    const env = {
      ...this.getDefaultEnv(),
      ...this.config.env,
    };

    // 启动子进程
    this._process = spawn(this.config.command, this.config.args ?? [], {
      env,
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr
      shell: false,
    });

    // 处理 stdout 数据流
    this._process.stdout?.on('data', (chunk: Buffer) => {
      this._readBuffer.append(chunk);
      this.processReadBuffer();
    });

    // 处理进程错误
    this._process.on('error', (error) => {
      this._status = 'error';
      this.onerror?.(error);
    });

    // 处理进程退出
    this._process.on('close', (code) => {
      this._status = 'disconnected';
      this.onclose?.();
    });

    this._status = 'connected';
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._process?.stdin) {
      throw new Error('Transport not connected');
    }

    const json = JSON.stringify(message) + '\n';
    this._process.stdin.write(json, 'utf-8');
  }

  async close(): Promise<void> {
    if (!this._process) return;

    // 优雅关闭流程：stdin.end() → SIGTERM → SIGKILL
    this._process.stdin?.end();

    // 等待进程退出（最多 5 秒）
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this._process?.kill('SIGTERM');
        setTimeout(() => this._process?.kill('SIGKILL'), 1000);
      }, 5000);

      this._process?.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this._process = undefined;
    this._status = 'disconnected';
  }

  /** 处理读缓冲区，解析完整消息 */
  private processReadBuffer(): void {
    while (true) {
      const message = this._readBuffer.readMessage();
      if (!message) break;

      try {
        const parsed = JSON.parse(message) as JSONRPCMessage;
        this.onmessage?.(parsed);
      } catch (error) {
        this.onerror?.(new Error(`Invalid JSON-RPC message: ${message}`));
      }
    }
  }

  /** 获取默认环境变量（跨平台） */
  private getDefaultEnv(): Record<string, string> {
    const inherited = process.platform === 'win32'
      ? ['APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PATH', 'TEMP', 'USERNAME']
      : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'];

    const env: Record<string, string> = {};
    for (const key of inherited) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
    return env;
  }
}
```

### Streamable HTTP Transport 实现

```typescript
// src/mcp/http-transport.ts

export interface HTTPTransportConfig {
  /** MCP 服务器 URL */
  url: URL;
  /** 认证提供者 */
  authProvider?: AuthProvider;
  /** 请求初始化选项 */
  requestInit?: RequestInit;
  /** 协议版本 */
  protocolVersion?: string;
  /** 重连配置 */
  reconnection?: {
    initialDelay: number;  // 初始延迟 (ms)
    maxDelay: number;      // 最大延迟 (ms)
    growFactor: number;    // 增长因子
  };
}

/**
 * Streamable HTTP Transport - 基于 HTTP POST + SSE
 *
 * 协议流程：
 * 1. POST /mcp - 发送请求，可能返回 JSON 或 SSE stream
 * 2. GET /mcp - 建立 SSE 流，接收服务端通知
 * 3. DELETE /mcp - 终止会话
 *
 * 会话管理：通过 mcp-session-id header
 */
export class StreamableHTTPTransport implements MCPTransport {
  private _sessionId?: string;
  private _abortController?: AbortController;
  private _sseController?: AbortController;
  private _status: TransportStatus = 'disconnected';

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(private config: HTTPTransportConfig) {}

  async connect(): Promise<void> {
    this._status = 'connecting';
    // 启动 SSE 流监听服务端通知
    await this.startSSEStream();
    this._status = 'connected';
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const headers = await this.buildHeaders();
    headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json, text/event-stream');

    // 如果有 session id，添加到 header
    if (this._sessionId) {
      headers.set('mcp-session-id', this._sessionId);
    }

    this._abortController = new AbortController();

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: this._abortController.signal,
    });

    // 捕获服务端分配的 session id
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) {
      this._sessionId = sessionId;
    }

    // 处理响应
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      // SSE 流响应（服务端主动推送）
      await this.handleSSEStream(response.body);
    } else if (contentType.includes('application/json')) {
      // 直接 JSON 响应
      const data = await response.json();
      this.onmessage?.(data);
    } else if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  async close(): Promise<void> {
    // 取消进行中的请求
    this._abortController?.abort();
    this._sseController?.abort();

    // 如果有会话，发送 DELETE 终止
    if (this._sessionId) {
      try {
        await fetch(this.config.url, {
          method: 'DELETE',
          headers: await this.buildHeaders(),
        });
      } catch {
        // 忽略终止错误
      }
      this._sessionId = undefined;
    }

    this._status = 'disconnected';
    this.onclose?.();
  }

  /** 启动 SSE 流监听 */
  private async startSSEStream(): Promise<void> {
    this._sseController = new AbortController();

    const headers = await this.buildHeaders();
    headers.set('accept', 'text/event-stream');

    const response = await fetch(this.config.url, {
      method: 'GET',
      headers,
      signal: this._sseController.signal,
    });

    this.handleSSEStream(response.body);
  }

  /** 处理 SSE 流 */
  private async handleSSEStream(body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!body) return;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 事件
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const message = JSON.parse(data) as JSONRPCMessage;
              this.onmessage?.(message);
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error) {
      // SSE 流中断，尝试重连
      if (this._status === 'connected') {
        this.scheduleReconnect();
      }
    }
  }

  /** 安排重连 */
  private scheduleReconnect(attempt = 0): void {
    const { initialDelay = 1000, maxDelay = 30000, growFactor = 2 } =
      this.config.reconnection || {};

    const delay = Math.min(initialDelay * Math.pow(growFactor, attempt), maxDelay);

    setTimeout(async () => {
      try {
        await this.startSSEStream();
      } catch {
        this.scheduleReconnect(attempt + 1);
      }
    }, delay);
  }

  /** 构建请求头 */
  private async buildHeaders(): Promise<Headers> {
    const headers = new Headers(this.config.requestInit?.headers);

    if (this.config.authProvider) {
      const token = await this.config.authProvider.getAccessToken();
      headers.set('authorization', `Bearer ${token}`);
    }

    return headers;
  }
}
```

### MCP Client 实现

```typescript
// src/mcp/client.ts

import { BehaviorSubject, Observable, from, map, timeout, catchError, of } from 'rxjs';
import type { MCPClient, MCPTool, MCPServerConfig } from '../core/interfaces.js';

export interface MCPClientOptions {
  /** 工具调用超时（毫秒） */
  timeout?: number;
  /** 自动重连 */
  autoReconnect?: boolean;
}

/**
 * AgentForge MCP Client 实现
 *
 * 遵循 MCP 规范：
 * 1. 初始化握手 - capabilities 协商
 * 2. 工具发现 - tools/list
 * 3. 工具调用 - tools/call
 * 4. 错误处理 - 错误在 result.isError 中，不抛异常
 */
export class AgentForgeMCPClient implements MCPClient {
  private _status$ = new BehaviorSubject<MCPClient['status']>('disconnected');
  private _transport?: MCPTransport;
  private _pendingRequests = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private _requestId = 0;

  readonly onStatusChange = () => this._status$.asObservable();

  constructor(private options: MCPClientOptions = {}) {}

  async connect(config: MCPServerConfig): Promise<void> {
    this._status$.next('connecting');

    // 创建传输层
    this._transport = this.createTransport(config);

    // 设置消息处理
    this._transport.onmessage = (message) => this.handleMessage(message);
    this._transport.onerror = (error) => this.handleError(error);
    this._transport.onclose = () => this.handleClose();

    // 连接
    await this._transport.connect();

    // 初始化握手
    await this.initialize();

    this._status$.next('connected');
  }

  async disconnect(): Promise<void> {
    if (this._transport) {
      await this._transport.close();
      this._transport = undefined;
    }
    this._status$.next('disconnected');
  }

  async tools(): Promise<MCPTool[]> {
    const response = await this.request({
      method: 'tools/list',
      params: {},
    });

    return response.tools.map((t: { name: string; description?: string; inputSchema: unknown }) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.request(
      {
        method: 'tools/call',
        params: { name, arguments: args },
      },
      this.options.timeout ?? 30000,
    );

    // MCP 错误在 result.isError 中，不抛异常
    // 让 Agent 决定如何处理工具错误
    return this.extractContent(response);
  }

  status(): MCPClient['status'] {
    return this._status$.value;
  }

  // ===== 私有方法 =====

  private createTransport(config: MCPServerConfig): MCPTransport {
    switch (config.type) {
      case 'stdio':
        return new StdioTransport({
          command: config.command!,
          args: config.args ?? [],
          env: config.env,
        });
      case 'http':
        return new StreamableHTTPTransport({
          url: new URL(config.url!),
          protocolVersion: '2025-11-25',
        });
      default:
        throw new Error(`Unsupported transport type: ${config.type}`);
    }
  }

  /** 初始化握手 */
  private async initialize(): Promise<void> {
    const response = await this.request({
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'agentforge', version: '1.0.0' },
      },
    });

    // 发送 initialized 通知
    await this._transport!.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  }

  /** 发送请求并等待响应 */
  private async request(
    message: Omit<JSONRPCRequest, 'jsonrpc' | 'id'>,
    timeoutMs?: number,
  ): Promise<unknown> {
    const id = ++this._requestId;

    return new Promise((resolve, reject) => {
      this._pendingRequests.set(id, { resolve, reject });

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        ...message,
      };

      this._transport!.send(request).catch(reject);

      if (timeoutMs) {
        setTimeout(() => {
          this._pendingRequests.delete(id);
          reject(new Error(`Request ${id} timed out`));
        }, timeoutMs);
      }
    });
  }

  /** 处理收到的消息 */
  private handleMessage(message: JSONRPCMessage): void {
    if ('id' in message) {
      // 响应消息
      const pending = this._pendingRequests.get(message.id);
      if (pending) {
        this._pendingRequests.delete(message.id);
        if ('error' in message) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    }
    // 通知消息可以忽略（或触发事件）
  }

  private handleError(error: Error): void {
    this._status$.next('error');
  }

  private handleClose(): void {
    this._status$.next('disconnected');
  }

  /** 从 MCP 响应中提取文本内容 */
  private extractContent(response: unknown): string {
    const result = response as { content?: Array<{ type: string; text?: string }> };
    if (!result.content) return '';

    return result.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');
  }
}
```

### 与 Agent Loop 集成点

```typescript
// 在 agent-loop.ts 的 handleToolCall 中添加 MCP 路由

private handleToolCall(event: AgentEvent, state: AgentState, ctx: AgentContext): Observable<AgentEvent> {
  const call = event as Extract<AgentEvent, { type: 'tool.call' }>;

  // 1. SubAgent 委托
  if (ctx.subagents?.has(call.toolName)) {
    return this.handleSubAgentDelegation(call, state, ctx);
  }

  // 2. MCP 工具路由（新增）
  if (ctx.mcp && this.isMcpTool(ctx.mcp, call.toolName)) {
    return this.handleMcpTool(call, state, ctx);
  }

  // 3. 本地工具
  return this.handleLocalTool(call, state, ctx);
}

private isMcpTool(mcp: MCPClient, toolName: string): boolean {
  // MCP 工具名格式：mcp_<server>_<tool>
  return toolName.startsWith('mcp_');
}

private handleMcpTool(
  call: ToolCallEvent,
  state: AgentState,
  ctx: AgentContext
): Observable<AgentEvent> {
  return concat(
    // 发出执行事件
    of({ type: 'tool.execute', ...call }),

    // 调用 MCP 工具
    defer(() => ctx.mcp!.callTool(call.toolName, call.args)).pipe(
      timeout(ctx.mcp!.options?.timeout ?? 30000),
      map((result) => ({
        type: 'tool.result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        result,
        isError: false,
      })),
      catchError((error) =>
        of({
          type: 'tool.error',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          error: serializeError(error),
        })
      ),
    ),
  );
}
```

### MCP 工具适配为 AgentForge ToolDefinition

```typescript
// src/mcp/tool-adapter.ts

import type { ToolDefinition } from '../core/interfaces.js';
import type { MCPTool } from '../core/interfaces.js';
import { zodToJsonSchema } from '../core/zod-to-schema.js';
import { z } from 'zod';

/**
 * 将 MCP 工具转换为 AgentForge ToolDefinition
 */
export function adaptMCPTool(
  tool: MCPTool,
  mcpClient: MCPClient
): ToolDefinition {
  // MCP 使用 JSON Schema，转换为 Zod
  const parameters = jsonSchemaToZod(tool.inputSchema);

  return {
    name: `mcp_${tool.name}`,
    description: tool.description ?? `MCP tool: ${tool.name}`,
    parameters,
    execute: async (args, ctx) => {
      // MCP 错误在 result.isError，不抛异常
      const result = await mcpClient.callTool(tool.name, args);
      return result;
    },
  };
}

/**
 * JSON Schema → Zod 转换
 */
function jsonSchemaToZod(schema: unknown): z.ZodObject<any> {
  const s = schema as Record<string, unknown>;

  if (s.type !== 'object') {
    return z.object({});
  }

  const properties = s.properties as Record<string, unknown> | undefined;
  const required = s.required as string[] | undefined;

  if (!properties) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    const zodType = jsonSchemaPropertyToZod(prop as Record<string, unknown>);
    if (required?.includes(key)) {
      shape[key] = zodType;
    } else {
      shape[key] = zodType.optional();
    }
  }

  return z.object(shape);
}

function jsonSchemaPropertyToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  switch (prop.type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(jsonSchemaPropertyToZod(prop.items as Record<string, unknown>));
    default:
      return z.unknown();
  }
}
```

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 核心类型定义
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | 初始设计 - SubAgent/MCP/Workflow/Skill 子系统 |
| v2 | 2026-04-26 | 补充 MCP Client 传输层详细设计 (Stdio/HTTP) |
