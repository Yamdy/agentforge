# 核心类型定义

> 本文档定义 AgentForge 的核心类型：事件类型（40 种）、Agent 状态、检查点。

---

## 1. 事件类型定义

```typescript
// src/core/events.ts
import { z } from 'zod';

// ========== 事件类型枚举 ==========

export const AgentEventTypeSchema = z.enum([
  // ===== Layer 1: 核心 Agent Loop =====
  'agent.start',
  'agent.step',
  'agent.complete',
  'agent.error',

  'llm.request',
  'llm.stream.start',
  'llm.stream.text',
  'llm.stream.tool_call',
  'llm.stream.end',
  'llm.response',
  'llm.error',
  'llm.output.invalid',  // 🔴 P0 新增：LLM 输出校验失败

  'tool.call',
  'tool.execute',
  'tool.result.delta',
  'tool.result',
  'tool.error',
  'tool.batch',          // 🔴 P0 新增：批量工具调用
  'tool.batch.start',    // 🔴 P2 新增：批次开始
  'tool.batch.complete', // 🔴 P2 新增：批次完成

  'hitl.ask',
  'hitl.answer',

  'state.change',
  'checkpoint',
  'cancel',
  'done',

  // ===== Layer 2: 子系统生命周期 =====
  'subagent.start',
  'subagent.step',
  'subagent.complete',
  'subagent.error',

  'mcp.connecting',
  'mcp.connected',
  'mcp.disconnected',
  'mcp.tools_changed',

  'workflow.start',
  'workflow.step.start',
  'workflow.step.end',
  'workflow.suspend',
  'workflow.resume',
  'workflow.complete',

  'compaction.start',
  'compaction.complete',

  // ===== Layer 3: 横切关注点 =====
  'permission.prompt',
  'permission.decision',
  
  // 🔴 P1 新增：上下文更新事件
  'context.updated',  // Skill 加载、配置变更等触发的上下文更新
]);

export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

// ========== 事件载荷定义 ==========

export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  name: z.string().optional(),      // for tool role
  toolCallId: z.string().optional(), // for tool role
});
export type Message = z.infer<typeof MessageSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const FinishReasonSchema = z.enum([
  'stop',
  'tool_calls',
  'length',
  'error',
  'cancelled',
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

// ⚠️ 序列化 Error：z.instanceof(Error) 无法跨进程/存储序列化
// 统一使用 { name, message, stack? } 结构
export const SerializedErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
});
export type SerializedError = z.infer<typeof SerializedErrorSchema>;

// ========== 事件定义 ==========

export const AgentEventSchema = z.discriminatedUnion('type', [
  // agent.start
  z.object({
    type: z.literal('agent.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    input: z.string(),
    agentName: z.string(),
    model: z.object({ provider: z.string(), model: z.string() }),
  }),
  
  // agent.step
  z.object({
    type: z.literal('agent.step'),
    timestamp: z.number(),
    sessionId: z.string(),
    step: z.number(),
    maxSteps: z.number(),
  }),
  
  // agent.complete
  z.object({
    type: z.literal('agent.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    output: z.string(),
    steps: z.number(),
    tokens: z.object({ input: z.number(), output: z.number() }).optional(),
  }),
  
  // agent.error
  z.object({
    type: z.literal('agent.error'),
    timestamp: z.number(),
    sessionId: z.string(),
    error: SerializedErrorSchema,
    step: z.number().optional(),
  }),
  
  // llm.request
  z.object({
    type: z.literal('llm.request'),
    timestamp: z.number(),
    sessionId: z.string(),
    messages: MessageSchema.array(),
    model: z.object({ provider: z.string(), model: z.string() }),
    tools: z.string().array().optional(),
  }),
  
  // llm.stream.start
  z.object({
    type: z.literal('llm.stream.start'),
    timestamp: z.number(),
    sessionId: z.string(),
  }),
  
  // llm.stream.text
  z.object({
    type: z.literal('llm.stream.text'),
    timestamp: z.number(),
    sessionId: z.string(),
    delta: z.string(),
  }),
  
  // llm.stream.tool_call
  z.object({
    type: z.literal('llm.stream.tool_call'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    argsDelta: z.string(),
  }),
  
  // llm.stream.end
  z.object({
    type: z.literal('llm.stream.end'),
    timestamp: z.number(),
    sessionId: z.string(),
  }),
  
  // llm.response
  z.object({
    type: z.literal('llm.response'),
    timestamp: z.number(),
    sessionId: z.string(),
    content: z.string(),
    toolCalls: ToolCallSchema.array().optional(),
    finishReason: FinishReasonSchema,
    usage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
    }).optional(),
  }),
  
  // llm.error
  z.object({
    type: z.literal('llm.error'),
    timestamp: z.number(),
    sessionId: z.string(),
    error: SerializedErrorSchema,
  }),
  
  // tool.call
  z.object({
    type: z.literal('tool.call'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  
  // tool.execute
  z.object({
    type: z.literal('tool.execute'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
  }),
  
  // tool.result
  z.object({
    type: z.literal('tool.result'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.string(),
    isError: z.boolean().default(false),
  }),
  
  // tool.error
  z.object({
    type: z.literal('tool.error'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    error: SerializedErrorSchema,
  }),
  
  // hitl.ask
  z.object({
    type: z.literal('hitl.ask'),
    timestamp: z.number(),
    sessionId: z.string(),
    askId: z.string(),
    question: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    options: z.string().array().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  
  // hitl.answer
  z.object({
    type: z.literal('hitl.answer'),
    timestamp: z.number(),
    sessionId: z.string(),
    askId: z.string(),
    answer: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
  }),
  
  // state.change
  z.object({
    type: z.literal('state.change'),
    timestamp: z.number(),
    sessionId: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  
  // checkpoint
  // 注：state 使用 z.unknown() 是为了避免与 state.ts 的循环依赖。
  // 实际运行时校验由 CheckpointSchema (checkpoint.ts) 使用 AgentStateSchema 完成。
  z.object({
    type: z.literal('checkpoint'),
    timestamp: z.number(),
    sessionId: z.string(),
    checkpointId: z.string(),
    position: z.enum(['before_llm', 'after_llm', 'before_tool', 'after_tool']),
    state: z.unknown(), // AgentState snapshot - validated by CheckpointSchema
  }),
  
  // cancel
  z.object({
    type: z.literal('cancel'),
    timestamp: z.number(),
    sessionId: z.string(),
    reason: z.string().optional(),
  }),
  
  // done
  z.object({
    type: z.literal('done'),
    timestamp: z.number(),
    sessionId: z.string(),
    reason: FinishReasonSchema,
  }),
  
  // 🔴 P1 新增：context.updated
  z.object({
    type: z.literal('context.updated'),
    timestamp: z.number(),
    sessionId: z.string(),
    source: z.enum(['skill_loaded', 'config_changed', 'tool_registered', 'mcp_connected', 'manual']),
    changes: z.object({
      toolsAdded: z.string().array().optional(),
      toolsRemoved: z.string().array().optional(),
      skillsLoaded: z.string().array().optional(),
      configChanged: z.record(z.string(), z.unknown()).optional(),
    }),
    previousContext: z.unknown().optional(),
  }),
  
  // 🔴 P0 新增：llm.output.invalid
  z.object({
    type: z.literal('llm.output.invalid'),
    timestamp: z.number(),
    sessionId: z.string(),
    reason: z.string(),
    originalResponse: z.unknown(),
    attempt: z.number(),
  }),
  
  // 🔴 P0 新增：tool.batch
  z.object({
    type: z.literal('tool.batch'),
    timestamp: z.number(),
    sessionId: z.string(),
    batchId: z.string(),
    calls: z.array(z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.record(z.string(), z.unknown()),
    })),
  }),
  
  // 🔴 P2 新增：tool.batch.start
  z.object({
    type: z.literal('tool.batch.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    batchId: z.string(),
    totalCalls: z.number(),
  }),
  
  // 🔴 P2 新增：tool.batch.complete
  z.object({
    type: z.literal('tool.batch.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    batchId: z.string(),
    totalCalls: z.number(),
    successCount: z.number(),
    errorCount: z.number(),
    durationMs: z.number(),
  }),
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ========== 事件类型守卫 ==========

export function isAgentEvent(event: unknown): event is AgentEvent {
  return AgentEventSchema.safeParse(event).success;
}

export function isLLMEvent(event: AgentEvent): event is Extract<AgentEvent, { type: `llm.${string}` }> {
  return event.type.startsWith('llm.');
}

export function isToolEvent(event: AgentEvent): event is Extract<AgentEvent, { type: `tool.${string}` }> {
  return event.type.startsWith('tool.');
}

export function isHITLEvent(event: AgentEvent): event is Extract<AgentEvent, { type: `hitl.${string}` }> {
  return event.type.startsWith('hitl.');
}
```

---

## 2. Agent 状态定义

```typescript
// src/core/state.ts
import { z } from 'zod';

export const AgentStateSchema = z.object({
  sessionId: z.string(),
  agentName: z.string(),
  model: z.object({ provider: z.string(), model: z.string() }),
  
  // 消息历史
  messages: MessageSchema.array(),
  
  // 执行状态
  step: z.number(),
  maxSteps: z.number(),
  
  // 待处理的工具调用
  pendingToolCalls: ToolCallSchema.array(),
  
  // 🔴 P2 新增：批量工具调用追踪
  batchContext: z.object({
    batchId: z.string(),
    totalCalls: z.number(),
    completedCalls: z.number(),
    startedAt: z.number(),
  }).optional(),
  
  // 累积输出
  output: z.string(),
  
  // Token 统计
  tokens: z.object({
    prompt: z.number(),
    completion: z.number(),
  }),
  
  // 🔴 P1 新增：上下文管理状态
  contextManagement: z.object({
    totalTokens: z.number(),
    compactionCount: z.number().default(0),
    lastCompactionAt: z.number().optional(),
  }).optional(),
  
  // 检查点
  lastCheckpoint: z.object({
    id: z.string(),
    timestamp: z.number(),
    position: z.enum(['before_llm', 'after_llm', 'before_tool', 'after_tool']),
  }).optional(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// 状态不可变更新
export function updateState(
  state: AgentState,
  update: Partial<AgentState>
): AgentState {
  return AgentStateSchema.parse({ ...state, ...update });
}
```

---

## 3. 检查点定义

> ⚠️ **P1 设计澄清**：恢复粒度是步骤级（after_llm / after_tool），不是事件级。每个检查点位置对应 Agent Loop 的稳定状态，恢复时从该位置继续。

```typescript
// src/core/checkpoint.ts
import { z } from 'zod';

/**
 * 检查点位置语义
 * 
 * | Position        | 含义                     | 恢复起点              |
 * |-----------------|--------------------------|----------------------|
 * | before_llm      | LLM 请求发出前           | 发起 LLM 请求         |
 * | after_llm       | LLM 响应接收后           | 处理 toolCalls        |
 * | before_tool     | 工具执行前               | 执行工具              |
 * | after_tool      | 工具执行完成后           | 发起下一轮 LLM 请求   |
 * 
 * ⚠️ 恢复粒度：步骤级（Step），不是事件级
 * - 一次 Step = LLM 调用 + 工具执行（如果有）
 * - 检查点在 Step 的稳定边界保存
 * - 恢复时从该边界继续，不会丢失中间状态
 */
export const CheckpointSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  timestamp: z.number(),
  position: z.enum(['before_llm', 'after_llm', 'before_tool', 'after_tool']),
  state: AgentStateSchema,
  pendingEvent: AgentEventSchema.optional(), // 断点时正在处理的事件
  
  // 🔴 P1 新增：跨进程状态
  pendingA2A: z.array(z.object({
    requestId: z.string(),
    targetAgent: z.string(),
    requestType: z.enum(['request', 'notify', 'broadcast']),
    payload: z.unknown(),
    sentAt: z.number(),
    status: z.enum(['pending', 'acknowledged', 'responded', 'timeout']),
  })).optional().default([]),
  
  // 🔴 P1 新增：工具幂等性追踪
  executedTools: z.array(z.object({
    toolCallId: z.string(),
    toolName: z.string(),
    idempotencyKey: z.string(),
    executedAt: z.number(),
    resultHash: z.string().optional(),
  })).optional().default([]),
  
  // 🔴 P1 新增：恢复元数据
  recoveryMetadata: z.object({
    originalSessionId: z.string().optional(),
    recoveryCount: z.number().default(0),
    lastRecoveryAt: z.number().optional(),
  }).optional().default({}),
  
  // 🔴 P1 新增：压缩历史追踪（压缩与 Checkpoint 兼容性）
  compactionHistory: z.array(z.object({
    compactionId: z.string(),
    timestamp: z.number(),
    strategy: z.enum(['truncate-oldest', 'summarize', 'importance-weighted']),
    tokensBefore: z.number(),
    tokensAfter: z.number(),
    removedMessageCount: z.number(),
    summarizedMessageCount: z.number(),
    snapshotRef: z.string().optional(),
  })).optional().default([]),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

/**
 * 🔴 P1 幂等性恢复策略
 * 
 * 恢复后工具执行的幂等性保证：
 * 1. 每个工具调用有唯一的 idempotencyKey = `${sessionId}:${toolCallId}`
 * 2. 恢复时检查 executedTools，跳过已执行的工具
 * 3. 工具执行方需要支持 idempotencyKey 检查
 */
export function isToolExecuted(
  checkpoint: Checkpoint,
  toolCallId: string
): boolean {
  return checkpoint.executedTools?.some(
    (t) => t.toolCallId === toolCallId
  ) ?? false;
}

export function getToolResult(
  checkpoint: Checkpoint,
  toolCallId: string
): string | undefined {
  // 从 state.messages 中查找已执行工具的结果
  const toolMessage = checkpoint.state.messages.find(
    (m) => m.role === 'tool' && m.toolCallId === toolCallId
  );
  return toolMessage?.content;
}
```

---

## 事件层级分类

### Layer 1: 核心 Agent Loop（18 种）

| 事件类型 | 描述 |
|---------|------|
| `agent.start` | Agent 启动 |
| `agent.step` | 步骤开始 |
| `agent.complete` | Agent 完成 |
| `agent.error` | Agent 错误 |
| `llm.request` | LLM 请求 |
| `llm.stream.start` | 流式开始 |
| `llm.stream.text` | 流式文本块 |
| `llm.stream.tool_call` | 流式工具调用块 |
| `llm.stream.end` | 流式结束 |
| `llm.response` | LLM 响应 |
| `llm.error` | LLM 错误 |
| `llm.output.invalid` | LLM 输出校验失败 |
| `tool.call` | 工具调用 |
| `tool.execute` | 工具执行 |
| `tool.result` | 工具结果 |
| `tool.error` | 工具错误 |
| `hitl.ask` | HITL 询问 |
| `hitl.answer` | HITL 回答 |

### Layer 2: 子系统生命周期（15 种）

| 事件类型 | 描述 |
|---------|------|
| `subagent.start` | SubAgent 启动 |
| `subagent.step` | SubAgent 步骤 |
| `subagent.complete` | SubAgent 完成 |
| `subagent.error` | SubAgent 错误 |
| `mcp.connecting` | MCP 连接中 |
| `mcp.connected` | MCP 已连接 |
| `mcp.disconnected` | MCP 断开 |
| `mcp.tools_changed` | MCP 工具变更 |
| `workflow.start` | Workflow 启动 |
| `workflow.step.start` | Workflow 步骤开始 |
| `workflow.step.end` | Workflow 步骤结束 |
| `workflow.suspend` | Workflow 挂起 |
| `workflow.resume` | Workflow 恢复 |
| `workflow.complete` | Workflow 完成 |
| `compaction.start/complete` | 上下文压缩 |

### Layer 3: 横切关注点（7 种）

| 事件类型 | 描述 |
|---------|------|
| `state.change` | 状态变更 |
| `checkpoint` | 检查点 |
| `cancel` | 取消 |
| `done` | 完成 |
| `permission.prompt` | 权限提示 |
| `permission.decision` | 权限决策 |
| `context.updated` | 上下文更新 |

---

## 工具输出校验 (P1)

> 扩展 ToolDefinition 支持 outputSchema，实现结构化输出的 Tier 1 校验。

### ToolDefinition 扩展

```typescript
// src/core/interfaces.ts 扩展
export interface ToolDefinition<
  TInputSchema = unknown,
  TOutputSchema = unknown
> {
  name: string;
  description: string;
  parameters: TInputSchema;              // 现有: 输入参数 Zod schema
  outputSchema?: TOutputSchema;          // 🔴 P1 新增: 输出 Zod schema (可选)
  execute: (args: unknown, ctx?: ToolContext) => Promise<string>;
  
  // 🔴 P1 新增: 安全标记
  requiresApproval?: boolean;
  approvalMessage?: string;
  sandboxRequired?: boolean;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}
```

### 工具输出校验契约 (Tier 1)

```typescript
// src/contracts/tool-output-contract.ts (新建)

import { z } from 'zod';
import type { ToolDefinition } from '../core/interfaces.js';

/** 校验后的工具输出 */
export interface ValidatedToolOutput<T = unknown> {
  /** 原始字符串输出 */
  raw: string;
  /** 结构化输出 (如果 outputSchema 定义且解析成功) */
  structured?: T;
  /** 校验是否通过 */
  isValid: boolean;
  /** 校验错误信息 */
  validationError?: string;
}

/**
 * 工具输出校验 - Tier 1
 *
 * 工具执行输出是外部不可信数据。
 * 使用 safeParse + 优雅降级，永不崩溃。
 */
export function validateToolOutput<T>(
  rawResult: string,
  tool: ToolDefinition<unknown, z.ZodType<T>>
): ValidatedToolOutput<T> {
  // 无 outputSchema → 仅保留原始字符串
  if (!tool.outputSchema) {
    return { raw: rawResult, isValid: true };
  }
  
  // 尝试 JSON 解析
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResult);
  } catch {
    return {
      raw: rawResult,
      isValid: false,
      validationError: 'Output is not valid JSON',
    };
  }
  
  // Zod schema 校验
  const result = (tool.outputSchema as z.ZodType).safeParse(parsed);
  if (result.success) {
    return { raw: rawResult, structured: result.data, isValid: true };
  }
  
  // 优雅降级: 保留原始字符串，标记校验失败
  return {
    raw: rawResult,
    isValid: false,
    validationError: result.error.message,
  };
}
```

### tool.result 事件扩展

```typescript
// src/core/events.ts 扩展 tool.result schema
z.object({
  type: z.literal('tool.result'),
  timestamp: z.number(),
  sessionId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.string(),                    // 原始字符串输出 (向后兼容)
  
  // 🔴 P1 新增: 结构化输出字段
  structuredOutput: z.unknown().optional(),  // 解析后的结构化数据
  isValid: z.boolean().optional(),           // 校验状态
  validationError: z.string().optional(),    // 校验错误
  
  isError: z.boolean().default(false),
})
```

### MCP 工具 outputSchema 适配

```typescript
// src/mcp/tool-adapter.ts 扩展
export function adaptMCPTool(
  tool: MCPTool,
  mcpClient: MCPClient,
  serverName?: string
): ToolDefinition {
  const parameters = jsonSchemaToZod(tool.inputSchema);
  
  // 🔴 P1 新增: 如果 MCP 工具定义了 outputSchema
  const outputSchema = tool.outputSchema 
    ? jsonSchemaToZod(tool.outputSchema) 
    : undefined;
  
  return {
    name: toolName,
    description: tool.description ?? `MCP tool: ${tool.name}`,
    parameters,
    outputSchema,  // 🔴 P1 新增
    execute: async (args: unknown): Promise<string> => {
      return mcpClient.callTool(tool.name, args as Record<string, unknown>);
    },
  };
}
```

### 校验集成位置

**方案 A: 在 ToolRegistry.execute() 中**
```typescript
// src/core/context.ts ToolRegistry 实现
async execute(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<string> {
  const tool = this.get(name);
  // ... 输入校验 ...
  const rawResult = await tool.execute(validatedArgs.data, ctx);
  // 输出校验 (但不修改返回值，保持向后兼容)
  const validated = validateToolOutput(rawResult, tool);
  // 校验元数据通过事件传递
  return rawResult;
}
```

**方案 B: 在 agent-loop.ts executeSingleTool 中**
```typescript
// src/loop/agent-loop.ts
const validated = tool?.outputSchema 
  ? validateToolOutput(result, tool) 
  : { raw: result, isValid: true };

const resultEvent: AgentEvent = {
  type: 'tool.result',
  result: validated.raw,              // 向后兼容
  structuredOutput: validated.structured,  // 🔴 P1 新增
  isValid: validated.isValid,             // 🔴 P1 新增
  validationError: validated.validationError, // 🔴 P1 新增
  // ...
};
```

---

## 决策追溯系统 (P1)

> 基于 Harness V-Validation 要求，建立决策追溯能力，解决「Agent 为什么这么做」的核心疑问。

### llm.response 事件扩展

```typescript
// src/core/events.ts 扩展 llm.response schema
z.object({
  type: z.literal('llm.response'),
  timestamp: z.number(),
  sessionId: z.string(),
  content: z.string(),
  toolCalls: ToolCallSchema.array().optional(),
  finishReason: FinishReasonSchema,
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
  }).optional(),
  
  // 🔴 P1 新增: 推理捕获
  reasoning: z.object({
    rawOutput: z.string().optional(),        // 原始 LLM 输出 (解析前)
    thoughtProcess: z.string().optional(),   // 提取的推理过程
    model: z.string().optional(),            // 模型标识
    confidence: z.number().min(0).max(1).optional(), // 置信度
  }).optional(),
})
```

### decision.trace 事件类型

```typescript
// 新增事件类型
z.object({
  type: z.literal('decision.trace'),
  timestamp: z.number(),
  sessionId: z.string(),
  step: z.number(),
  
  decisionType: z.enum([
    'tool_selection',
    'tool_argument',
    'completion',
    'retry',
    'replan',
    'subagent_delegation',
  ]),
  
  context: z.object({
    inputs: z.record(z.string(), z.unknown()),       // 影响决策的输入
    availableOptions: z.array(z.unknown()).optional(), // 可选项列表
    selected: z.unknown(),                             // 选中的选项
    rationale: z.string().optional(),                  // 选择原因
  }),
  
  llmReasoning: z.object({
    rawOutput: z.string().optional(),
    thoughtProcess: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
  
  confidence: z.number().min(0).max(1).optional(),
  parentDecisionId: z.string().optional(),  // 层级追溯
}),
```

### DecisionTraceStorage 接口

```typescript
// src/core/interfaces.ts 新增
export interface DecisionTraceStorage {
  /** 追加决策记录 (Append-Only) */
  append(trace: DecisionTrace): Promise<void>;
  
  /** 查询决策记录 */
  query(filter: {
    sessionId: string;
    step?: number;
    decisionType?: string;
  }): Promise<DecisionTrace[]>;
  
  /** 获取决策链 (parent → children) */
  getChain(sessionId: string): Promise<DecisionTrace[]>;
}
```

### 推理捕获注入点

```typescript
// src/loop/agent-loop.ts callLLM() 修改
function callLLM(state: AgentState): Observable<StepContext> {
  return from(ctx.llm.chat(state.messages, llmOptions)).pipe(
    mergeMap(response => {
      // 🔴 P1 新增: 捕获原始输出
      const rawOutput = response.rawOutput ?? JSON.stringify(response);
      
      const responseEvent: AgentEvent = {
        type: 'llm.response',
        content: response.content,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason,
        usage: response.usage,
        reasoning: {  // 🔴 P1 新增
          rawOutput,
          thoughtProcess: response.thoughtProcess,
          model: config.model.model,
        },
      };
      return of({ event: responseEvent, state });
    }),
  );
}
```

---

## 外部状态机 (P1)

> 基于 Harness S-State Storage 要求，状态落地外部持久化存储，支持版本回滚和人工接管。

### CheckpointStorage 扩展接口

```typescript
// src/core/interfaces.ts 扩展
export interface ExternalStateMachine extends CheckpointStorage {
  /** 加载或初始化状态 */
  loadOrInitialize(sessionId: string, snapshot?: AgentState): Promise<Checkpoint>;
  
  /** 获取版本历史 */
  getHistory(sessionId: string): Promise<CheckpointVersion[]>;
  
  /** 回滚到指定版本 */
  rollback(sessionId: string, versionId: string): Promise<Checkpoint>;
  
  /** 导出状态供人工检查/修改 */
  exportForTakeover(sessionId: string): Promise<string>;
  
  /** 导入人工修改后的状态 */
  importFromTakeover(sessionId: string, modifiedState: string): Promise<Checkpoint>;
}

export interface CheckpointVersion {
  versionId: string;
  timestamp: number;
  position: CheckpointPosition;
  step: number;
  summary: string;
}
```

### 存储后端实现

| 后端 | 文件 | 用途 |
|------|------|------|
| **FileCheckpointStorage** | `src/storage/file-storage.ts` | 本地开发、Git 版本化 |
| **SqliteCheckpointStorage** | `src/storage/sqlite-storage.ts` | 生产持久化 |
| **RedisCheckpointStorage** | `src/storage/redis-storage.ts` | 分布式系统 |

### Checkpoint Schema 扩展

```typescript
// src/core/checkpoint.ts 扩展
export const CheckpointSchema = z.object({
  // ...existing fields...
  
  // 🔴 P1 新增: 版本元数据
  version: z.object({
    versionId: z.string(),
    parentVersionId: z.string().optional(),
    createdAt: z.number(),
    createdBy: z.enum(['agent', 'human', 'system']),
    summary: z.string().optional(),
  }).optional(),
  
  // 🔴 P1 新增: 决策追踪引用
  decisionTraceRefs: z.array(z.string()).optional(),
});
```

---

## 相关文档

- [02-ZOD-CONTRACT.md](./02-ZOD-CONTRACT.md) - Zod 数据契约与校验策略
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座与 Agent Loop

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | 初始设计 - 事件类型、Agent 状态、Checkpoint |
| v2 | 2026-04-25 | 补充 A2A 跨进程状态、幂等性追踪、恢复元数据 |
| v3 | 2026-04-26 | **P1 新增**: 工具输出校验、决策追溯系统、外部状态机 |
