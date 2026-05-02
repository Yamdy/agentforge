# Zod 数据契约层

> 本文档定义 AgentForge 的数据校验策略，核心思想：校验强度与数据信任度成正比，而非一刀切全量校验。

---

## 1. 信任度分级模型

框架处理的数据来源可按信任度分为三层，每层采用不同的校验策略：

```
┌─────────────────────────────────────────────────────────────┐
│                    信任度分级校验模型                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────┐                                   │
│  │  Tier 1: 外部不可信   │  LLM 输出、MCP 响应、用户输入      │
│  │  → 强校验 + 兜底降级  │  safeParse + fallback extract     │
│  └──────────────────────┘                                   │
│           │                                                  │
│  ┌──────────────────────┐                                   │
│  │  Tier 2: 跨模块边界   │  事件总线、Checkpoint 序列化       │
│  │  → 编译时 Schema 校验 │  Schema = 契约，TypeScript 推断    │
│  └──────────────────────┘                                   │
│           │                                                  │
│  ┌──────────────────────┐                                   │
│  │  Tier 3: 模块内部     │  Agent 内部状态、临时变量           │
│  │  → 仅 TypeScript 类型 │  不做运行时校验，靠编译器            │
│  └──────────────────────┘                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Tier 1：外部不可信数据 — 强校验 + 兜底降级

外部数据（LLM 返回、MCP 响应、用户输入）不可信，必须校验，且校验失败时不能崩溃——要降级到可用状态。

### 2.1 LLM 响应兜底

LLM 返回结构不稳定（JSON 格式错乱、字段缺失、类型不对），需要兜底提取可用字段：

```typescript
// src/contracts/llm-contract.ts
import { z } from 'zod';

// LLM 响应 Schema（对外部数据的严格定义）
export const LLMResponseSchema = z.object({
  content: z.string(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  })).optional(),
  finishReason: z.enum(['stop', 'tool_calls', 'length', 'error', 'cancelled']),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
  }).optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// 兜底降级：从残缺数据中提取可用信息
function extractToolCall(raw: unknown): { id: string; name: string; args: Record<string, unknown> } {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof obj.id === 'string' ? obj.id : generateId(),
    name: typeof obj.name === 'string' ? obj.name : 'unknown',
    args: (typeof obj.args === 'object' && obj.args !== null && !Array.isArray(obj.args))
      ? obj.args as Record<string, unknown>
      : {},
  };
}

// 校验入口：强校验 + 兜底
export function validateLLMResponse(raw: unknown): LLMResponse {
  const result = LLMResponseSchema.safeParse(raw);
  if (result.success) return result.data;

  // 校验失败 → 兜底降级，提取可用字段
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    content: typeof obj.content === 'string' ? obj.content : '',
    toolCalls: Array.isArray(obj.tool_calls)
      ? obj.tool_calls.map(extractToolCall)
      : Array.isArray(obj.toolCalls)
        ? obj.toolCalls.map(extractToolCall)
        : undefined,
    finishReason: (
      typeof obj.finish_reason === 'string' &&
      ['stop', 'tool_calls', 'length', 'error', 'cancelled'].includes(obj.finish_reason)
    ) ? obj.finish_reason as LLMResponse['finishReason']
      : typeof obj.finishReason === 'string'
        ? obj.finishReason as LLMResponse['finishReason']
        : 'stop',
    usage: undefined,  // 非关键字段，缺失可接受
  };
}
```

### 2.2 MCP 响应兜底

MCP 服务端是外部进程，响应格式不可信：

```typescript
// src/contracts/mcp-contract.ts

export const MCPToolResponseSchema = z.object({
  content: z.array(z.object({
    type: z.enum(['text', 'image', 'resource']),
    text: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional(),
  })),
  isError: z.boolean().default(false),
});

export type MCPToolResponse = z.infer<typeof MCPToolResponseSchema>;

// 兜底：MCP 响应可能只有字符串
export function validateMCPResponse(raw: unknown): MCPToolResponse {
  const result = MCPToolResponseSchema.safeParse(raw);
  if (result.success) return result.data;

  // 降级：把任意值包装为 text content
  return {
    content: [{
      type: 'text',
      text: typeof raw === 'string' ? raw : JSON.stringify(raw),
    }],
    isError: false,
  };
}
```

### 2.3 用户输入兜底

用户输入虽不可信，但结构简单（字符串），兜底逻辑也很简单：

```typescript
// src/contracts/user-input-contract.ts

export const UserInputSchema = z.object({
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export function validateUserInput(raw: unknown): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (typeof raw === 'object' && raw !== null && 'content' in raw) {
    const content = (raw as { content: unknown }).content;
    if (typeof content === 'string' && content.length > 0) return content;
  }
  return '';  // 兜底：空字符串
}
```

---

## 3. Tier 2：跨模块边界 — 编译时 Schema 契约

跨模块通信的数据（事件总线、Checkpoint 序列化、DI 接口参数），需要 Schema 作为契约。但校验发生在开发时（TypeScript 编译），运行时不额外消耗性能。

### 3.1 事件 Schema 即契约

事件类型定义本身就是跨模块契约：

```typescript
// 事件生产者必须遵守 Schema
function emitLLMResponse(response: LLMResponse): AgentEvent {
  // TypeScript 编译时确保 response 满足 LLMResponseSchema
  return {
    type: 'llm.response',
    timestamp: Date.now(),
    sessionId: this.sessionId,
    content: response.content,
    toolCalls: response.toolCalls,
    finishReason: response.finishReason,
    usage: response.usage,
  };
}

// 事件消费者按类型窄化
function handleEvent(event: AgentEvent): void {
  // TypeScript discriminated union 自动窄化
  if (event.type === 'llm.response') {
    // event.content, event.toolCalls 等全部有类型
    console.log(event.content);
  }
}
```

### 3.2 Checkpoint 序列化契约

Checkpoint 需要跨进程/跨存储，序列化/反序列化时需要校验：

```typescript
// src/contracts/checkpoint-contract.ts

// 序列化时校验（写出边界）
export function serializeCheckpoint(checkpoint: Checkpoint): string {
  CheckpointSchema.parse(checkpoint);  // 防御性校验
  return JSON.stringify(checkpoint);
}

// 反序列化时校验（读入边界 — 外部数据！）
export function deserializeCheckpoint(raw: string): Checkpoint {
  const parsed = JSON.parse(raw);
  return CheckpointSchema.parse(parsed);  // 外部存储 → 强校验
}
```

### 3.3 DI 接口参数契约

Context 中各接口的方法签名即为契约，TypeScript 编译时保证：

```typescript
// 接口 = 编译时契约
interface LLMAdapter {
  chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
  stream(messages: Message[], options?: LLMOptions): AsyncGenerator<LLMChunk>;
}

// 实现方必须满足签名，否则编译失败
class OpenAIAdapter implements LLMAdapter {
  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    const raw = await this.client.chat(messages, options);
    return validateLLMResponse(raw);  // Tier 1 兜底在适配层
  }
}
```

---

## 4. Tier 3：模块内部 — 仅 TypeScript 类型

模块内部数据（Agent 内部临时状态、循环变量、中间计算结果），不需要运行时校验，仅靠 TypeScript 类型系统：

```typescript
// 内部状态（无 Zod Schema，纯 TypeScript 接口）
interface LoopContext {
  currentStep: number;
  accumulatedText: string;
  pendingCalls: ToolCall[];
}

// 内部辅助函数（TypeScript 类型推导足够）
function mergeToolResults(
  existing: Map<string, string>,
  results: Array<{ id: string; result: string }>,
): Map<string, string> {
  for (const r of results) {
    existing.set(r.id, r.result);
  }
  return existing;
}
```

**不加 Zod 的理由**：

1. 内部数据由框架代码完全控制，不存在格式不一致的可能
2. 运行时校验有性能开销，循环内每步校验会显著拖慢 Agent Loop
3. TypeScript 编译已足够保证类型安全

---

## 5. 校验策略总览

| 信任层 | 数据来源 | 校验方式 | 失败策略 | 性能开销 |
|--------|---------|---------|---------|---------|
| **Tier 1** | LLM 返回、MCP 响应、用户输入 | `safeParse` + 兜底降级 | 降级到可用状态，不崩溃 | 每次外部调用一次 |
| **Tier 2** | 事件总线、Checkpoint、DI 参数 | Schema = TypeScript 契约 | 编译时类型错误 | 无运行时开销（除序列化边界） |
| **Tier 3** | 模块内部状态、临时变量 | 仅 TypeScript 类型 | 编译时类型错误 | 无 |

---

## 6. 版本兼容预留

跨进程/跨存储的协议需要版本号，内部模块不需要。

```typescript
// src/contracts/versioned-contract.ts

// 跨进程协议：加版本号（MCP JSON-RPC、Checkpoint 文件格式）
export const VersionedMCPRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  version: z.string().default('1.0.0'),
  method: z.string(),
  params: z.record(z.unknown()).default({}),
  id: z.union([z.string(), z.number()]),
});

export const VersionedCheckpointSchema = z.object({
  version: z.string().default('1.0.0'),
  checkpoint: CheckpointSchema,
});

// 版本兼容读取
export function loadCheckpoint(raw: unknown): Checkpoint {
  const versioned = VersionedCheckpointSchema.safeParse(raw);
  
  if (!versioned.success) {
    // 尝试无版本号格式（向后兼容）
    return CheckpointSchema.parse(raw);
  }
  
  const { version, checkpoint } = versioned.data;
  
  // 按版本号迁移
  if (semver.lt(version, '1.1.0')) {
    return migrateCheckpointFromV1_0(checkpoint);
  }
  
  return checkpoint;
}

// 内部事件：不加版本号（同进程，同代码版本）
// AgentEventSchema 无版本字段 — 框架升级时所有模块一起更新
```

**版本号原则**：

| 场景 | 是否需要版本号 | 理由 |
|------|-------------|------|
| MCP 请求/响应 | ✅ 需要 | 跨进程，服务端和客户端可能不同版本 |
| Checkpoint 存储 | ✅ 需要 | 持久化到磁盘，读取时可能跨版本 |
| 事件总线 | ❌ 不需要 | 同进程内，框架代码同版本 |
| 内部状态 | ❌ 不需要 | 同模块内，编译时一致 |
| DI 接口参数 | ❌ 不需要 | 同进程，TypeScript 保证 |

---

## 7. 校验在事件循环中的位置

```
外部数据输入
     │
     ├─ LLM 响应 ──→ validateLLMResponse() ──→ AgentEvent（Tier 1）
     │                  │
     │                  └─ 校验失败 → 兜底降级 → 仍发出事件
     │
     ├─ MCP 响应 ───→ validateMCPResponse() ──→ ToolResult（Tier 1）
     │
     └─ 用户输入 ──→ validateUserInput() ───→ HITL Answer（Tier 1）

事件循环内部
     │
     ├─ 事件经过 → TypeScript 类型窄化（Tier 2，零开销）
     │
     ├─ Checkpoint 写出 → serializeCheckpoint()（Tier 2，防御性校验）
     │
     └─ Checkpoint 读入 → deserializeCheckpoint()（Tier 1，外部数据）
```

---

## 8. 设计约束

| 约束 | 描述 |
|------|------|
| **兜底不崩溃** | Tier 1 校验失败必须降级，绝不 throw 到 Agent Loop 外 |
| **校验仅在边界** | 数据进入事件循环时校验一次，流内部不重复校验 |
| **内部不加 Zod** | Tier 3 模块内部禁止 `z.object()` 定义，用 TypeScript 接口 |
| **版本号仅跨进程** | 不给内部事件/状态加版本号，避免过度设计 |
| **适配层负责校验** | LLM/MCP 适配器内部调 Tier 1 校验，返回已验证数据 |

---

## 相关文档

- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 核心类型定义
- [03-DI.md](./03-DI.md) - DI 接口定义
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 错误边界设计