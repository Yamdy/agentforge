# agentforge Web UI — P2-2 pendingTools isError 渲染 设计

- 日期：2026-06-29
- 状态：草案（待实现）
- 范围：P2-2——工具调用渲染 + pendingTools 推断 + 终态 isError 标记
- 关联：`docs/superpowers/specs/2026-06-28-web-ui-p1-design.md`（P1 spec §5.3/§8 定义了 pendingTools 行为但 P1 defer 未实现）、`docs/superpowers/specs/2026-06-29-web-ui-p2-getstate-design.md`（P2-1，已完成）
- 前置：P2-1 get_state 快照协议已完成（commit 1d94d04，605 测试绿）

## 1. 背景与动机

P1 spec §5.3/§8 明确定义了 pendingTools 的终态行为：

> `message_end` 时若 `stopReason ∈ {aborted,error}`，把所有 `pendingTools` 标 isError 并清空；`agent_end` 兜底再 clear 一次（双保险，防 `message_end` 未清干净锁死）。

但 P1 实现时此行为被 defer（P1 review 记录：`reducer pendingTools 标 isError 缺（P1 tools 未渲染，defer）`）。原因有二：

1. **P1 前端未渲染 tools**：`main.ts` `render()` 只渲 messages/streaming/budget/count/usage/error，完全不渲染工具调用。
2. **reducer `tools` 是已完成累积，无 pending 概念**：`tool_execution_end` 事件累积到 `State.tools: ToolEvent[]`，只有"已完成"工具，没有"in-flight 未执行"的 pending 概念，无从标 isError。

P2-2 补齐这两项：渲染工具调用 + 推断 pending + 终态标 isError。

## 2. 现状（P2-1 后）

### 2.1 reducer.ts 现状

```ts
export interface ToolEvent { toolName: string; args: unknown; isError: boolean; }  // 无 toolCallId
export interface AssistantMessage {
  role: string;
  content: Array<{ type?: string; text?: string }>;  // 太宽松，扫不到 toolCall block
  stopReason?: string; usage?: Usage; errorMessage?: string;
}
export interface RenderedMessage { role: string; text: string; stopReason?: string; }  // 无 tool 条目
export interface State {
  messages: RenderedMessage[]; streaming?: AssistantMessage; budget?: BudgetInfo;
  busy: boolean; error?: string; lastUsage?: Usage;
  tools: ToolEvent[];  // 已完成累积，未渲染
  sessionId?: string; messageCount?: number;
}
// ServerEvent tool_execution_end: { type; toolName; args; isError }  // 无 toolCallId
```

`message_end` 分支处理 stopReason 提取 failError，但**不标 pendingTools isError**；`agent_end` 兜底只清 streaming，**不清 pendingTools**；`tool_execution_end` 累积到 `state.tools`（从不渲染）。

### 2.2 协议层已就绪（P2-2 无需改协议）

**关键事实**：server `serializeWebEvent` 对 `tool_execution_end` **已转发 `toolCallId`**（`ws-protocol.ts:37`）：

```ts
case "tool_execution_end": {
  const e = event as { toolCallId: string; toolName: string; args: unknown; isError: boolean };
  return { type, toolCallId: e.toolCallId, toolName: e.toolName, args: e.args, isError: e.isError };
}
```

P1 reducer 的 `ServerEvent` 类型没收 toolCallId（P1 简化丢弃）。P2-2 reducer 补收即可——**协议层零改动**。

### 2.3 pi-ai 类型事实（匹配键依据）

pi-ai `types.d.ts:182-188`：

```ts
export interface ToolCall {
  type: "toolCall";      // block type 值
  id: string;            // = toolCallId（匹配键）
  name: string;          // = toolName
  arguments: Record<string, any>;  // = args
  thoughtSignature?: string;
}
// AssistantMessage.content: (TextContent | ThinkingContent | ToolCall)[]  (types.d.ts:213)
// ToolResult（tool_execution_end 源）: toolCallId / toolName / isError  (types.d.ts:227-232)
```

**匹配键**：assistant message 的 toolCall block `.id` === `tool_execution_end` 的 `toolCallId`。pending = toolCall blocks 未匹配 execution_end。

## 3. 设计

### 3.1 核心机制：derivePending（纯函数 derive，不存 State）

pending **不存 State**，每次 derive。避免"显式 pendingTools 状态"与 messages/tool 条目的同步坑（漏清/双源不一致）。

```ts
executed = messages 里 role==="tool" 条目（done + error）的 toolCallId 集合
pending  = (定稿 assistant.toolCalls + streaming.content 的 toolCall block) − executed
```

**自清原理**：tool 条目（done 或 error）进 messages 即进 `executed` 集合 → derivePending 自动排除 → pending 自动清。无需手动清空 pending 状态。

### 3.2 事件 → reducer 行为

| 事件 | 行为 |
|---|---|
| `message_update` | `streaming = event.message`（不变；streaming 的 toolCall block 经 derivePending 计入 pending）|
| `message_end` | push assistant 条目（含 `toolCalls`）到 messages；若 `stopReason∈{aborted,error}` → derivePending 取当前 pending，每个 push **error tool 条目**（进 executed → pending 自清）|
| `tool_execution_end` | push **done tool 条目**到 messages（toolCallId/status:"done"/isError）；进 executed → 对应 pending 自消 |
| `agent_end` | 兜底：derivePending 取残留 pending，push error tool 条目（双保险，防 message_end 未清干净）+ 清 streaming + busy=false |

### 3.3 isError 终态语义（spec §5.3/§8 落地）

- **aborted**（用户中止）：pending toolCall 永不收到 execution_end → 标 `status:"error", isError:true` push 为 error tool 条目（历史可见"这些工具未执行完"）→ derivePending 自清。
- **error**（LLM 失败）：同 aborted，pending toolCall 标 error。
- **正常 turn**（toolCall → execution_end）：pending 临时存在（streaming/定稿后、execution_end 前），execution_end 来后转 done tool 条目，pending 自消，不残留。

### 3.4 渲染决策（用户选定 A+B）

- **A1 消息流内**：tool 条目作为 `role:"tool"` 进 messages 流，位置在 assistant message 之后（assistant 产 toolCall → 工具执行 → tool 结果条目）。历史 turn 工具自然可见。
- **B1 侧栏概览**：`tools: ✓N ⚠M ⏳K`（done/error 从 messages 统计，pending 从 derivePending 计），与 budget/usage/count 并列，无 turn 边界跟踪。

## 4. 数据模型改动（reducer.ts）

### 4.1 新增 ToolCallContent

```ts
export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

### 4.2 AssistantMessage.content 扩展

```ts
export interface AssistantMessage {
  role: string;
  content: Array<{ type?: string; text?: string } | ToolCallContent>;  // 加 ToolCallContent
  stopReason?: string;
  usage?: Usage;
  errorMessage?: string;
}
```

### 4.3 RenderedMessage 扩展（discriminated union，red-team F3 吸收）

```ts
export type RenderedMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; stopReason?: string; toolCalls?: ToolCallContent[] }
  | { role: "tool"; text: ""; toolCallId: string; toolName: string; args: unknown;
      status: "done" | "error"; isError: boolean };
```

`status`：`"done"`=执行成功；`"error"`=执行失败（`tool_execution_end.isError:true`，red-team F2 吸收）或终态未执行完（aborted/LLM error）。侧栏 `⚠err` 按 `isError` 合并二者。union 替代可选字段，消除"assistant 带 toolCallId"等 nonsense 混合态（编译期防）。

### 4.4 ServerEvent tool_execution_end 加 toolCallId

```ts
| { type: "tool_execution_end"; toolCallId: string; toolName: string; args: unknown; isError: boolean }
```

### 4.5 删 State.tools（冗余）

```ts
export interface State {
  messages: RenderedMessage[];
  streaming?: AssistantMessage;
  budget?: BudgetInfo;
  busy: boolean;
  error?: string;
  lastUsage?: Usage;
  sessionId?: string;
  messageCount?: number;
  // 删 tools: ToolEvent[] —— tool 条目进 messages 后，侧栏从 messages 统计；ToolEvent 类型保留给事件契约
}
```

`initState()` 同步删 `tools: []`。

### 4.6 derivePending helper

```ts
export interface PendingTool { toolCallId: string; toolName: string; args: unknown; }

export function derivePending(messages: RenderedMessage[], streaming?: AssistantMessage): PendingTool[] {
  const executed = new Set(
    messages.filter((m) => m.role === "tool").map((m) => m.toolCallId!)
  );
  const calls: PendingTool[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const tc of m.toolCalls) {
        if (!executed.has(tc.id)) {
          calls.push({ toolCallId: tc.id, toolName: tc.name, args: tc.arguments });
        }
      }
    }
  }
  if (streaming) {
    for (const b of streaming.content) {
      if (b.type === "toolCall" && !executed.has(b.id)) {
        calls.push({ toolCallId: b.id, toolName: b.name, args: b.arguments });
      }
    }
  }
  return calls;
}
```

## 5. reducer 逻辑改动

### 5.1 message_end 分支

```ts
case "message_end": {
  const msg = event.message;
  const text = msg?.content?.find((c) => c.type === "text")?.text ?? "";
  const toolCalls = msg?.content?.filter((c) => c.type === "toolCall") as ToolCallContent[] | undefined;
  const failError = (msg?.stopReason === "error" || msg?.errorMessage)
    ? (msg?.errorMessage ?? "LLM error") : undefined;
  const messages: RenderedMessage[] = [...state.messages, {
    role: "assistant", text, stopReason: msg?.stopReason, toolCalls,
  }];
  // 终态：pending toolCall 标 error push（进 executed → derivePending 自清）
  if (msg?.stopReason === "aborted" || msg?.stopReason === "error") {
    // streaming 已 undefined；message_end.message 含全部 toolCall blocks（pi agent-loop.ts:353/366
    // finalMessage 在 executeToolCalls 前 emit，red-team 核实——传 streaming:undefined 不漏）
    const pending = derivePending(messages, undefined);
    for (const p of pending) {
      messages.push({ role: "tool", text: "", toolCallId: p.toolCallId, toolName: p.toolName, args: p.args, status: "error", isError: true });
    }
  }
  return { ...state, messages, streaming: undefined, lastUsage: msg?.usage, error: failError ?? state.error };
}
```

### 5.2 tool_execution_end 分支

```ts
case "tool_execution_end":
  return {
    ...state,
    messages: [...state.messages, {
      role: "tool", text: "", toolCallId: event.toolCallId, toolName: event.toolName,
      args: event.args, status: event.isError ? "error" : "done", isError: event.isError,
    }],
  };
// red-team F2：执行失败的工具（isError:true）status:"error" 非 "done"（"done"=成功）。
```

### 5.3 agent_end 分支（兜底清残留 pending）

```ts
case "agent_end": {
  const pending = derivePending(state.messages, state.streaming);
  const errorEntries = pending.map((p) => ({
    role: "tool" as const, text: "", toolCallId: p.toolCallId, toolName: p.toolName,
    args: p.args, status: "error" as const, isError: true,
  }));
  return { ...state, busy: false, streaming: undefined, messages: [...state.messages, ...errorEntries] };
}
```

### 5.4 error 分支（red-team Failure mode 吸收）

```ts
case "error": {
  // server 合成 error 兜底（harness.prompt throw 未走 message_end，spec §8）：
  // 同 agent_end 兜底——derivePending 取残留 pending（含 streaming toolCall）push error + 清 streaming。
  // 不加则 pending toolCall 静默丢失（UI 悬挂 streaming + 永不标记 error 的 pending）。
  const pending = derivePending(state.messages, state.streaming);
  const errorEntries = pending.map((p) => ({
    role: "tool" as const, text: "" as const, toolCallId: p.toolCallId, toolName: p.toolName,
    args: p.args, status: "error" as const, isError: true,
  }));
  return { ...state, busy: false, streaming: undefined, error: event.message,
    messages: [...state.messages, ...errorEntries] };
}
```

### 5.5 message_update / 其他分支

不变。`message_update` 的 `streaming = event.message` 让 derivePending 经 main.ts render 计入 streaming 的 toolCall block。

## 6. 渲染改动（main.ts）

### 6.1 render() 消息流

```ts
for (const m of state.messages) {
  const div = document.createElement("div");
  if (m.role === "tool") {
    const cls = m.status === "error" || m.isError ? "error" : "done";
    div.className = `msg tool ${cls}`;
    const icon = m.status === "error" ? "⚠" : (m.isError ? "✗" : "✓");
    div.textContent = `${icon} ${m.toolName} ${formatArgs(m.args)}`;
  } else {
    div.className = `msg ${m.role === "user" ? "user" : "assistant"}`;
    div.innerHTML = marked.parse(m.text) as string;
  }
  stream.appendChild(div);
}
// streaming assistant text（在 pending 之前：assistant 先说话，其 toolCall 作 pending 随后）
if (state.streaming) { /* 现有 streaming 渲染，不变 */ }
// pending 占位（streaming 的 toolCall / 定稿未执行 toolCall）
const pending = derivePending(state.messages, state.streaming);
for (const p of pending) {
  const div = document.createElement("div");
  div.className = "msg tool pending";
  div.textContent = `⏳ ${p.toolName} ${formatArgs(p.args)}`;
  stream.appendChild(div);
}
```

`formatArgs(args)`：简短摘要（JSON.stringify 截断到 ~80 字符），避免长 args 撑爆 UI。**try/catch 兜底**（red-team F4：循环引用/BigInt 致 `JSON.stringify` throw，不兜底则一个坏 tool args 炸整个 render）：

```ts
function formatArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args) ?? "";
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  } catch { return "[unserializable]"; }
}
```

### 6.2 侧栏概览

```ts
const done = state.messages.filter((m) => m.role === "tool" && !m.isError).length;
const err = state.messages.filter((m) => m.role === "tool" && m.isError).length;
toolsEl.textContent = `tools: ✓${done} ⚠${err} ⏳${pending.length}`;
```

### 6.3 index.html

侧栏加 `<div id="tools"></div>`（与 budget/usage/count/error 并列）。

### 6.4 style.css

```css
.msg.tool { font-family: monospace; font-size: 0.85em; padding-left: 1.5em; }
.msg.tool.done { color: #4a7; }
.msg.tool.error { color: #e55; }
.msg.tool.pending { color: #c93; }
```

## 7. 文件改动清单

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/web/src/client/reducer.ts` | 数据模型 + derivePending + message_end/tool_execution_end/agent_end 逻辑 | 核心 |
| `packages/web/src/client/main.ts` | render tool 条目 + pending 占位 + 侧栏概览 + formatArgs | 渲染 |
| `packages/web/src/client/index.html` | 侧栏加 `<div id="tools">` | |
| `packages/web/src/client/style.css` | .msg.tool.done/.error/.pending 样式 | |
| `packages/web/src/server/ws-protocol.ts` | **无改动** | 已转发 toolCallId |
| `packages/web/src/server/index.ts` | **无改动** | |

## 8. 测试策略（reducer 纯函数单测为主）

### 8.1 derivePending 单测
- 空消息 → []
- streaming 含 toolCall block → [该 toolCall]（pending）
- 定稿 assistant.toolCalls + 未 execution_end → pending
- toolCall block.id === tool_execution_end.toolCallId → 不在 pending（已 executed）
- 定稿 + streaming 混合，去重（同 id 不重复）

### 8.2 reducer 行为单测
- `tool_execution_end` → messages 末尾 push tool 条目（toolCallId/status: `isError?"error":"done"`/isError 透传，red-team F2）
- `tool_execution_end`(isError:true) → status:"error"（非 "done"）
- `message_end`(assistant 含 toolCall) → push assistant 条目含 toolCalls；derivePending 含该 toolCall（pending）
- `message_end`(stopReason:"aborted") → pending toolCall 标 error push（status:"error"/isError:true）；之后 derivePending 归空
- `message_end`(stopReason:"error") → 同 aborted
- `message_end`(stopReason:"stop") → 不标 error（正常完成，pending 待 execution_end 自消）
- `message_end`(stopReason:"error") → `agent_end`：**无重复 error 条目**（同 toolCallId 不双推，red-team F1——message_end push 进 executed，agent_end derivePending 返回空）
- `agent_end`（无 message_end 终态）→ 残留 pending push error（兜底）+ busy=false + streaming 清
- `error`（server 合成，streaming 含 toolCall）→ derivePending push error + 清 streaming + busy=false（red-team Failure mode 吸收，§5.4）
- 正常 turn 全流程：message_end(assistant 含 toolCall) → derivePending=[toolCall] → tool_execution_end → derivePending=[]（不残留）
- 现有回归：message_end failError 提取 / agent_end 清 streaming / state 事件 / initState 不含 tools

### 8.3 兼容回归
- 删 State.tools 安全：grep 确认 `reducer.test.ts` 零覆盖 tool_execution_end（P1 gap——tool_execution_end 分支从未测试，Oracle 核实），main.ts 不读 state.tools。P2-2 补 tool_execution_end 测试（§8.2）。
- main.ts render 不破坏现有 messages/streaming/budget/count/usage/error 渲染

## 9. 关键决策记录

1. **derivePending 纯函数 derive，不存 State**：避免显式 pendingTools 状态与 messages/tool 条目双源同步坑（漏清/不一致）。tool 条目进 messages 即进 executed 集合，pending 自动清。
2. **tool 条目进 messages 流（A1）**：历史 turn 工具自然可见，位置语义正确（assistant 产 toolCall → tool 结果）。删冗余 State.tools。
3. **侧栏概览计数（B1）**：YAGNI turn 边界跟踪；从 messages 统计 + derivePending 计 pending 足够。
4. **isError 终态 push error 条目**：spec §5.3"标 error + 清空"语义=标 error（push error tool 条目历史可见）+ 清空（进 executed → derivePending 自清）。非"直接丢弃不显示"。
5. **协议零改动**：server 已转发 toolCallId（ws-protocol.ts:37），P2-2 仅 reducer 补收。
6. **AssistantMessage.content 扩展 ToolCallContent**：当前 `{type?,text?}` 太宽松扫不到 toolCall；扩展后 derivePending 可从 streaming.content 取 toolCall block。
7. **red-team Oracle 全吸收**（2026-06-29）：error 分支漏 pending（最关键，§5.4 补）/ tool_execution_end status 语义（§5.2）/ union（§4.3）/ formatArgs try/catch（§6.1）/ 双推测试 pin（§8.2）/ 删 tools 安全确认（§8.3）。详见 §11。

## 10. pi 借鉴 + 不引入

- **借鉴**：pi-ai ToolCall 类型结构（types.d.ts:182-188，id/name/arguments）+ toolCallId 匹配键（ToolResult.toolCallId types.d.ts:227）。pi TUI 工具调用渲染在 assistant message 上下文（interactive-mode.ts），agentforge 用 messages 流 role:"tool" 条目实现等价语义。
- **不引入**：pi AgentSession 层的 queue_update / tool_execution_start 事件（agentforge spec §3.2 YAGNI 无此层）。pending 推断靠 assistant message toolCall block + tool_execution_end 匹配，无需 tool_execution_start（白名单本就排除 tool_execution_start，spec §4.1）。
- **不引入**：tool args 详细 diff 展示 / tool result content 渲染（P1 §12 defer thinking/toolcall delta 分轨展示，P2-2 只显示 toolName + args 摘要 + 状态）。

## 11. red-team Oracle 审查结果（2026-06-29，全吸收）

独立 subagent 审核（隔离本会话，实读 pi agent-loop.ts 核实时序）。所有代码引用验证准确。findings：

- 🔴(最关键) **error 分支漏 pending**（Failure mode）：harness.prompt throw 未走 message_end 时，streaming 含 toolCall，reducer error 分支只设 busy=false → pending 静默丢失。**吸收**：§5.4 error 分支 derivePending push error + 清 streaming（同 agent_end 兜底）。
- 🟡 F1 **agent_end 双推**：safe by sequencing（message_end 先 push error 进 executed，agent_end derivePending 返回空）。**吸收**：§8.2 加显式测试 pin（message_end(error)→agent_end 无双推）。
- 🟡 F2 **tool_execution_end status 语义**：isError:true 工具设 status:"done" 错（"执行失败"≠"成功"）。**吸收**：§5.2 `status: event.isError ? "error" : "done"`。
- ⚪ F3 **RenderedMessage union**：可选字段有 nonsense 混合态风险。**吸收**：§4.3 改 discriminated union。
- ⚪ F4 **formatArgs throw**：循环/BigInt 致 JSON.stringify throw 炸 render。**吸收**：§6.1 try/catch 兜底。
- ⚪ F5 **删 State.tools 安全 + P1 测试 gap**：grep 确认 reducer.test.ts 零覆盖 tool_execution_end（P1 shipped untested），main.ts 不读 state.tools。**吸收**：§8.3 记录，P2-2 补测试。
- ⚪ F6 **渲染顺序**：messages→streaming→pending 匹配 pi 时序（message_update 累积→message_end 定稿→executeToolCalls→tool_execution_end）。**sound，无需改**。
- **关键假设验证**：message_end.message 含全部 toolCall blocks（pi agent-loop.ts:353/366 finalMessage 在 executeToolCalls 前 emit）——derivePending 传 streaming:undefined 不漏。toolCall.id === tool_execution_end.toolCallId（pi-ai ToolCall.id vs ToolResult.toolCallId，executeToolCalls 同源）。agent_end 在 message_end 后（正常 settle 路径，reducer 顺序处理）。
