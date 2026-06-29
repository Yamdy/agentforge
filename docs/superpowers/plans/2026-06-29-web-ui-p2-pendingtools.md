# Web UI P2-2：pendingTools isError 渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P1 defer 的 pendingTools isError 渲染——工具调用进 messages 流渲染（A1）+ derivePending 纯函数推断 pending（不存 State，tool 条目进 messages 自清）+ message_end/agent_end/error 终态标 error（spec §5.3/§8）+ 侧栏概览计数（B1）。

**Architecture:** reducer 纯函数 `derivePending(messages, streaming)`——`executed = messages 里 role:"tool" 条目的 toolCallId`，`pending = (定稿 assistant.toolCalls + streaming toolCall block) − executed`。tool 条目（done/error）进 messages 即进 executed → pending 自清。终态（message_end abort/error / agent_end 兜底 / error 分支）把残留 pending push 为 error tool 条目。协议零改动（server `ws-protocol.ts:37` 已转发 toolCallId，reducer 补收）。删冗余 `State.tools`。

**Tech Stack:** TypeScript, vitest, vanilla TS client, marked, esbuild

**Spec:** `docs/superpowers/specs/2026-06-29-web-ui-p2-pendingtools-design.md`（commit 94d2584，red-team Oracle 7 findings 全吸收）

## Global Constraints

- TypeScript pnpm monorepo（6 包）。自核每步：`tsc --noEmit` + `vitest`，**不信 subagent 报告**（项目有 subagent 报告不实史）。
- **LSP 诊断全程缓存误报**（web 包 stale 索引反复报 "Cannot find module" 等），实际 tsc/vitest 全绿——**以 `tsc --noEmit` + `vitest` 为准，忽略 LSP 诊断**。
- **web tsconfig rootDir: `src/server`**。`packages/web/src/client/reducer.ts` exclude 自 tsc，靠 vitest 验证逻辑；`main.ts` 经 esbuild 打 bundle。
- **client 改后须 rebuild**：`packages/web/package.json` build = `tsc && esbuild src/client/main.ts --bundle→dist/client/bundle.js` + node 复制 index.html/style.css。改 client 后须 `pnpm --filter @agentforge/web build` 才能在 server 生效。
- **本 plan 不改 harness / ws-protocol / server**（协议层已就绪，red-team F5 确认）。只改 client 4 文件（reducer/main/html/css）。
- **GateGuard fact-force hook**：首次 Write/Edit 每文件拦一次，要求陈述 2-4 事实 + 重试；bash 首次也拦。陈述后重试放行。
- pi 借鉴标注：ToolCall 类型（pi-ai types.d.ts:182-188，id/name/arguments）+ toolCallId 匹配键（ToolResult.toolCallId types.d.ts:227）+ message_end.message 含全部 toolCall（agent-loop.ts:353/366 finalMessage 在 executeToolCalls 前 emit，red-team 核实）。
- 铁律：引用源码行号作证据，每个 task 自己跑 tsc + vitest。

---

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `packages/web/src/client/reducer.ts` | 前端纯函数 reducer | 加 `ToolCallContent`/`PendingTool` 类型；`RenderedMessage` 改 union；`AssistantMessage.content` 扩展 ToolCallContent；`ServerEvent.tool_execution_end` 加 `toolCallId`；删 `State.tools`；加 `derivePending`；改 message_end/tool_execution_end/agent_end 分支 + 加 error 分支兜底 |
| `packages/web/src/client/main.ts` | WS 客户端 + 渲染 | render 加 tool 条目 + pending 占位 + 侧栏 tools 概览；加 `formatArgs`（try/catch）；import `derivePending` |
| `packages/web/src/client/index.html` | 单页结构 | 侧栏加 `<div id="tools">` |
| `packages/web/src/client/style.css` | 样式 | 加 `.msg.tool.done/.error/.pending` |
| `packages/web/src/client/reducer.test.ts` | reducer 测试 | 加 derivePending + 各分支测试（P1 零覆盖 tool_execution_end，P2-2 补） |

任务依赖：Task 1（数据模型 + derivePending）→ Task 2/3/4（reducer 各分支用 derivePending + 新类型）；Task 5（main.ts 渲染）依赖 Task 1-4；Task 6 全量验证收尾。

---

### Task 1: reducer 数据模型 + derivePending + initState 删 tools

**Files:**
- Modify: `packages/web/src/client/reducer.ts`（类型定义区 L7-22 + initState L36-38 + 文件末加 derivePending）
- Test: `packages/web/src/client/reducer.test.ts`

**Interfaces:**
- Produces: `ToolCallContent`（`{type:"toolCall", id, name, arguments}`）；`PendingTool`（`{toolCallId, toolName, args}`）；`RenderedMessage` 改 discriminated union（user/assistant/tool 三态）；`AssistantMessage.content: Array<{type?,text?} | ToolCallContent>`；`derivePending(messages, streaming?) => PendingTool[]`；`initState()` 无 `tools` 字段。Task 2-4 用这些类型 + derivePending。

**背景核实**：`reducer.ts` 现状（P2-1 后）：`ToolEvent` L11 无 toolCallId；`AssistantMessage.content` L9 `Array<{type?:string;text?:string}>` 太宽松；`RenderedMessage` L10 `{role,text,stopReason}` 无 tool 条目；`State.tools` L19 + initState L37 `tools:[]`；`ServerEvent.tool_execution_end` L30 无 toolCallId。red-team F5 grep 确认 `reducer.test.ts` 零覆盖 tool_execution_end。

- [ ] **Step 1: Write the failing test**

在 `packages/web/src/client/reducer.test.ts` 顶部 import 加 `derivePending` + `AssistantMessage` 类型，文件内加新 describe：

```ts
import { reducer, initState, derivePending, type AssistantMessage, type RenderedMessage } from "./reducer.js";

describe("derivePending", () => {
  it("空消息返回空", () => {
    expect(derivePending([])).toEqual([]);
  });

  it("streaming 含 toolCall block → pending", () => {
    const streaming: AssistantMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "a.ts" } }],
    };
    expect(derivePending([], streaming)).toEqual([
      { toolCallId: "tc1", toolName: "read", args: { path: "a.ts" } },
    ]);
  });

  it("定稿 assistant.toolCalls 未 execution_end → pending", () => {
    const messages: RenderedMessage[] = [
      { role: "assistant", text: "", toolCalls: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] },
    ];
    expect(derivePending(messages)).toEqual([{ toolCallId: "tc1", toolName: "read", args: {} }]);
  });

  it("toolCall.id 匹配 tool 条目 toolCallId → 不在 pending（已 executed）", () => {
    const messages: RenderedMessage[] = [
      { role: "assistant", text: "", toolCalls: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] },
      { role: "tool", text: "", toolCallId: "tc1", toolName: "read", args: {}, status: "done", isError: false },
    ];
    expect(derivePending(messages)).toEqual([]);
  });

  it("定稿 + streaming 同 id 不重复", () => {
    const messages: RenderedMessage[] = [
      { role: "assistant", text: "", toolCalls: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] },
    ];
    const streaming: AssistantMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
    };
    expect(derivePending(messages, streaming)).toEqual([{ toolCallId: "tc1", toolName: "read", args: {} }]);
  });
});

describe("initState", () => {
  it("无 tools 字段（P2-2 删冗余）", () => {
    const s = initState();
    expect((s as { tools?: unknown }).tools).toBeUndefined();
    expect(s.messages).toEqual([]);
    expect(s.busy).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/web test -- reducer.test.ts -t "derivePending"`
Expected: FAIL（`derivePending` 未导出 / `ToolCallContent` 类型不存在）

- [ ] **Step 3: Write minimal implementation**

在 `packages/web/src/client/reducer.ts`：

(a) L9 后加 `ToolCallContent`，改 `AssistantMessage.content`：
```ts
export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface AssistantMessage {
  role: string;
  content: Array<{ type?: string; text?: string } | ToolCallContent>;
  stopReason?: string;
  usage?: Usage;
  errorMessage?: string;
}
```

(b) L10 `RenderedMessage` 改 union：
```ts
export type RenderedMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; stopReason?: string; toolCalls?: ToolCallContent[] }
  | { role: "tool"; text: ""; toolCallId: string; toolName: string; args: unknown;
      status: "done" | "error"; isError: boolean };
```

(c) L30 `ServerEvent.tool_execution_end` 加 `toolCallId`：
```ts
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; args: unknown; isError: boolean }
```

(d) L12-22 `State` 删 `tools: ToolEvent[]`（`ToolEvent` interface L11 保留作事件契约类型文档）：
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
}
```

(e) L36-38 `initState` 删 `tools`：
```ts
export function initState(): State {
  return { messages: [], busy: false };
}
```

(f) 文件末加 `PendingTool` + `derivePending`：
```ts
export interface PendingTool { toolCallId: string; toolName: string; args: unknown; }

/**
 * 推断 in-flight pending 工具调用（未匹配 tool_execution_end 的 toolCall block）。
 * 纯函数 derive，不存 State：tool 条目进 messages 即进 executed → pending 自清。
 * pi 借鉴：ToolCall.id（types.d.ts:184）=== tool_execution_end.toolCallId（types.d.ts:227）。
 */
export function derivePending(messages: RenderedMessage[], streaming?: AssistantMessage): PendingTool[] {
  const executed = new Set(
    messages.filter((m): m is Extract<RenderedMessage, { role: "tool" }> => m.role === "tool")
      .map((m) => m.toolCallId)
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

- [ ] **Step 4: Run test to verify it passes + 处理 tool_execution_end 中间态**

删 `State.tools` 后，`tool_execution_end` 分支（L69-70 用 `state.tools`）会 broken。**本 task 一并把 tool_execution_end 分支改为 push done tool 条目**（与 Task 2 合并实现），避免中间态破坏：

reducer.ts L69-70 `tool_execution_end` 分支改为：
```ts
    case "tool_execution_end":
      return {
        ...state,
        messages: [...state.messages, {
          role: "tool", text: "", toolCallId: event.toolCallId, toolName: event.toolName,
          args: event.args, status: event.isError ? "error" : "done", isError: event.isError,
        }],
      };
```

Run: `pnpm --filter @agentforge/web test -- reducer.test.ts`
Expected: PASS（derivePending 5 + initState 1）。tool_execution_end 分支已改（Task 2 测试下步加，本步不破坏既有测试）。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/reducer.ts packages/web/src/client/reducer.test.ts
git commit -m "feat(web): reducer 数据模型 + derivePending + tool_execution_end 分支（P2-2 Task 1+2 合并）"
```

---

### Task 2: tool_execution_end 分支测试（status 语义，实现已含 Task 1）

**Files:**
- Test: `packages/web/src/client/reducer.test.ts`（实现已在 Task 1 Step 4 完成）

**Interfaces:**
- Consumes: Task 1 的 `RenderedMessage` union + `ServerEvent.tool_execution_end.toolCallId`
- Verifies: `tool_execution_end` → push `role:"tool"` 条目（`status: isError?"error":"done"`，red-team F2）

**背景核实**：Task 1 Step 4 已把 tool_execution_end 分支改为 push tool 条目 + status 语义。本 task 补测试 pin 行为。

- [ ] **Step 1: Write the test**

在 `reducer.test.ts` 加：
```ts
describe("reducer tool_execution_end", () => {
  it("push done tool 条目（toolCallId/status/isError 透传）", () => {
    const state = reducer(initState(), {
      type: "tool_execution_end", toolCallId: "tc1", toolName: "read", args: { path: "a" }, isError: false,
    });
    expect(state.messages).toEqual([
      { role: "tool", text: "", toolCallId: "tc1", toolName: "read", args: { path: "a" }, status: "done", isError: false },
    ]);
  });

  it("isError:true → status:'error'（red-team F2：执行失败≠成功）", () => {
    const state = reducer(initState(), {
      type: "tool_execution_end", toolCallId: "tc1", toolName: "bash", args: {}, isError: true,
    });
    expect(state.messages[0]).toMatchObject({ status: "error", isError: true });
  });

  it("进 executed → derivePending 排除", () => {
    const streaming: AssistantMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
    };
    let state = reducer(initState(), { type: "message_update", message: streaming });
    state = reducer(state, { type: "tool_execution_end", toolCallId: "tc1", toolName: "read", args: {}, isError: false });
    expect(derivePending(state.messages, state.streaming)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes（实现已在 Task 1 完成，应直接绿）**

Run: `pnpm --filter @agentforge/web test -- reducer.test.ts -t "tool_execution_end"`
Expected: PASS（3 测试）

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/client/reducer.test.ts
git commit -m "test(web): tool_execution_end status 语义测试（P2-2 Task 2，F2）"
```

---

### Task 3: message_end 分支（toolCalls 提取 + 终态 push error）

**Files:**
- Modify: `packages/web/src/client/reducer.ts`（message_end 分支 L46-62）
- Test: `packages/web/src/client/reducer.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ToolCallContent` + `derivePending`
- Produces: `message_end` → push assistant 条目含 `toolCalls`（从 message.content 提取 toolCall block）；`stopReason∈{aborted,error}` → derivePending 取 pending push error tool 条目（自清）

**背景核实**：reducer.ts L46-62 现状 message_end 提取 text + failError，push `{role, text, stopReason}`（无 toolCalls）。red-team 核实：message_end.message 含全部 toolCall blocks（pi agent-loop.ts:353/366 finalMessage 在 executeToolCalls 前 emit）→ derivePending 传 `streaming:undefined` 不漏。

- [ ] **Step 1: Write the failing test**

在 `reducer.test.ts` 加：
```ts
describe("reducer message_end", () => {
  it("assistant 含 toolCall → push assistant 含 toolCalls + pending", () => {
    const state = reducer(initState(), {
      type: "message_end",
      message: { role: "assistant", content: [
        { type: "text", text: "hi" },
        { type: "toolCall", id: "tc1", name: "read", arguments: { path: "a" } },
      ] },
    });
    const last = state.messages[state.messages.length - 1];
    expect(last).toMatchObject({ role: "assistant", text: "hi" });
    expect((last as { toolCalls?: unknown }).toolCalls).toEqual([
      { type: "toolCall", id: "tc1", name: "read", arguments: { path: "a" } },
    ]);
    expect(derivePending(state.messages, state.streaming)).toEqual([
      { toolCallId: "tc1", toolName: "read", args: { path: "a" } },
    ]);
  });

  it("stopReason:'aborted' → pending 标 error push + 自清", () => {
    let state = reducer(initState(), { type: "message_update", message: {
      role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
    } });
    state = reducer(state, { type: "message_end", message: {
      role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
      stopReason: "aborted",
    } });
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error" && m.isError)).toBe(true);
    expect(derivePending(state.messages, state.streaming)).toEqual([]);
  });

  it("stopReason:'error' → 同 aborted 标 error", () => {
    const state = reducer(initState(), { type: "message_end", message: {
      role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
      stopReason: "error", errorMessage: "boom",
    } });
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error")).toBe(true);
    expect(state.error).toBe("boom");
  });

  it("stopReason:'stop' → 不标 error（pending 待 execution_end 自消）", () => {
    const state = reducer(initState(), { type: "message_end", message: {
      role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop",
    } });
    expect(state.messages.some((m) => m.role === "tool")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/web test -- reducer.test.ts -t "message_end"`
Expected: FAIL（message_end 未提取 toolCalls / 未终态 push error）

- [ ] **Step 3: Write minimal implementation**

reducer.ts L46-62 `message_end` 分支改为：
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
      // 终态：pending toolCall 标 error push（进 executed → derivePending 自清）。
      // message_end.message 含全部 toolCall（pi agent-loop.ts:353/366 finalMessage 在 executeToolCalls 前 emit，red-team 核实）。
      if (msg?.stopReason === "aborted" || msg?.stopReason === "error") {
        const pending = derivePending(messages, undefined);
        for (const p of pending) {
          messages.push({ role: "tool", text: "", toolCallId: p.toolCallId, toolName: p.toolName, args: p.args, status: "error", isError: true });
        }
      }
      return { ...state, messages, streaming: undefined, lastUsage: msg?.usage, error: failError ?? state.error };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/web test -- reducer.test.ts`
Expected: PASS（message_end 4 + 既有）

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/reducer.ts packages/web/src/client/reducer.test.ts
git commit -m "feat(web): message_end 提取 toolCalls + 终态 push error（P2-2 Task 3）"
```

---

### Task 4: agent_end 兜底 + error 分支（双推 pin + Failure mode 吸收）

**Files:**
- Modify: `packages/web/src/client/reducer.ts`（agent_end 分支 L63-64 + error 分支 L65-66）
- Test: `packages/web/src/client/reducer.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `derivePending`
- Produces: `agent_end` → derivePending 残留 pending push error + 清 streaming + busy=false（兜底）；`error` → 同 agent_end 兜底（red-team Failure mode：harness.prompt throw 未走 message_end 时 streaming 含 toolCall 不静默丢失）

**背景核实**：reducer.ts L63-64 agent_end 现状只 `{...state, busy:false, streaming:undefined}`（不清 pending）；L65-66 error 现状只 `{...state, busy:false, error:event.message}`（不清 pending，red-team Failure mode）。red-team F1：agent_end 双推 safe by sequencing（message_end 先 push error 进 executed，agent_end derivePending 返回空）——加测试 pin。

- [ ] **Step 1: Write the failing test**

在 `reducer.test.ts` 加：
```ts
describe("reducer agent_end / error 兜底", () => {
  it("agent_end(残留 pending) → push error + 清 streaming + busy false", () => {
    let state = reducer(initState(), { type: "message_end", message: {
      role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
    } });
    state = reducer(state, { type: "agent_end" });
    expect(state.busy).toBe(false);
    expect(state.streaming).toBeUndefined();
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error")).toBe(true);
    expect(derivePending(state.messages, state.streaming)).toEqual([]);
  });

  it("message_end(error) → agent_end：无重复 error 条目（双推 pin，red-team F1）", () => {
    let state = reducer(initState(), { type: "message_end", message: {
      role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
      stopReason: "error",
    } });
    const countAfterMessageEnd = state.messages.filter((m) => m.role === "tool" && m.toolCallId === "tc1").length;
    state = reducer(state, { type: "agent_end" });
    const countAfterAgentEnd = state.messages.filter((m) => m.role === "tool" && m.toolCallId === "tc1").length;
    expect(countAfterAgentEnd).toBe(countAfterMessageEnd);  // 不双推
  });

  it("error(server 合成, streaming 含 toolCall) → push error + 清 streaming（Failure mode 吸收）", () => {
    let state = reducer(initState(), { type: "message_update", message: {
      role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
    } });
    state = reducer(state, { type: "error", message: "boom" });
    expect(state.busy).toBe(false);
    expect(state.streaming).toBeUndefined();
    expect(state.error).toBe("boom");
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/web test -- reducer.test.ts -t "agent_end"`
Expected: FAIL（agent_end 未 push error / error 分支未清 pending）

- [ ] **Step 3: Write minimal implementation**

reducer.ts L63-66 改 agent_end + error 分支：
```ts
    case "agent_end": {
      // 兜底：残留 pending push error（双保险，防 message_end 未清干净锁死）。
      const pending = derivePending(state.messages, state.streaming);
      const errorEntries = pending.map((p) => ({
        role: "tool" as const, text: "" as const, toolCallId: p.toolCallId, toolName: p.toolName,
        args: p.args, status: "error" as const, isError: true,
      }));
      return { ...state, busy: false, streaming: undefined, messages: [...state.messages, ...errorEntries] };
    }
    case "error": {
      // server 合成 error 兜底（harness.prompt throw 未走 message_end，spec §8）：
      // 同 agent_end——derivePending 取残留 pending（含 streaming toolCall）push error + 清 streaming。
      // red-team Failure mode：不加则 pending 静默丢失（UI 悬挂）。
      const pending = derivePending(state.messages, state.streaming);
      const errorEntries = pending.map((p) => ({
        role: "tool" as const, text: "" as const, toolCallId: p.toolCallId, toolName: p.toolName,
        args: p.args, status: "error" as const, isError: true,
      }));
      return { ...state, busy: false, streaming: undefined, error: event.message,
        messages: [...state.messages, ...errorEntries] };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/web test -- reducer.test.ts`
Expected: PASS（agent_end/error 3 + 既有全部）

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/reducer.ts packages/web/src/client/reducer.test.ts
git commit -m "feat(web): agent_end 兜底 + error 分支清 pending（P2-2 Task 4，F1+Failure mode）"
```

---

### Task 5: main.ts 渲染 + index.html + style.css

**Files:**
- Modify: `packages/web/src/client/main.ts`（render L27-49 + 加 formatArgs + toolsEl + import derivePending）
- Modify: `packages/web/src/client/index.html`（侧栏 L18-23 加 `<div id="tools">`）
- Modify: `packages/web/src/client/style.css`（加 .msg.tool 样式）

**Interfaces:**
- Consumes: Task 1-4 的 `derivePending` + `RenderedMessage` union
- Produces: render 渲染 tool 条目（done/error）+ pending 占位（黄）+ 侧栏 `tools: ✓N ⚠M ⏳K`；`formatArgs(args)` try/catch 兜底

**背景核实**：main.ts L13 侧栏元素（budget/usage/error/count），无 tools；L27-49 render 只渲 messages（marked.parse text）+ streaming + 侧栏文本，不渲 tool；L8 import reducer/initState/State。index.html L18-23 侧栏结构。style.css 现有 .msg 样式。red-team F4：formatArgs JSON.stringify 循环/BigInt throw 需 try/catch。F6：渲染顺序 messages→streaming→pending 匹配 pi 时序。

**测试策略**：main.ts 是 UI（DOM），P1 惯例靠 build + 接线审查 + 冒烟（不强制 DOM 单测，reducer 纯函数已测）。本 task 验证 `pnpm --filter @agentforge/web build` 绿（esbuild bundle 含新 render）+ 接线审查。

- [ ] **Step 1: Modify index.html**

`packages/web/src/client/index.html` 侧栏（L18-23）加 `<div id="tools"></div>`：
```html
  <aside id="sidebar">
    <div id="budget">—</div>
    <div id="usage"></div>
    <span id="count"></span>
    <div id="tools"></div>
    <div id="error"></div>
  </aside>
```

- [ ] **Step 2: Modify style.css**

`packages/web/src/client/style.css` 加（文件末，照现有 .msg 风格）：
```css
.msg.tool { font-family: monospace; font-size: 0.85em; padding-left: 1.5em; }
.msg.tool.done { color: #4a7; }
.msg.tool.error { color: #e55; }
.msg.tool.pending { color: #c93; }
```

- [ ] **Step 3: Modify main.ts**

(a) L8 import 加 `derivePending`：
```ts
import { reducer, initState, derivePending, type State } from "./reducer.js";
```

(b) L13 侧栏元素加 `toolsEl`：
```ts
const budgetEl = $("budget"), usageEl = $("usage"), errorEl = $("error"), countEl = $("count"), toolsEl = $("tools");
```

(c) L22-25 `streamingText` 后加 `formatArgs`：
```ts
/** 工具 args 简短摘要（try/catch 兜底循环/BigInt，red-team F4）。 */
function formatArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args) ?? "";
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  } catch {
    return "[unserializable]";
  }
}
```

(d) L27-49 `render` 改——messages 循环加 tool 分支 + 末尾 pending 占位 + 侧栏 tools 概览：
```ts
function render() {
  rafScheduled = false;
  stream.innerHTML = "";
  for (const m of state.messages) {
    const div = document.createElement("div");
    if (m.role === "tool") {
      const cls = m.status === "error" || m.isError ? "error" : "done";
      div.className = `msg tool ${cls}`;
      const icon = m.status === "error" ? "⚠" : m.isError ? "✗" : "✓";
      div.textContent = `${icon} ${m.toolName} ${formatArgs(m.args)}`;
    } else {
      div.className = `msg ${m.role === "user" ? "user" : "assistant"}`;
      div.innerHTML = marked.parse(m.text) as string;
    }
    stream.appendChild(div);
  }
  if (state.streaming) {
    const div = document.createElement("div");
    div.className = "msg assistant streaming";
    div.innerHTML = marked.parse(streamingText()) as string;
    stream.appendChild(div);
  }
  // pending 占位（streaming 的 toolCall / 定稿未执行 toolCall），渲染在 streaming 之后（F6：assistant 先说话再调工具）
  const pending = derivePending(state.messages, state.streaming);
  for (const p of pending) {
    const div = document.createElement("div");
    div.className = "msg tool pending";
    div.textContent = `⏳ ${p.toolName} ${formatArgs(p.args)}`;
    stream.appendChild(div);
  }
  stream.scrollTop = stream.scrollHeight;
  sendBtn.hidden = state.busy;
  abortBtn.hidden = !state.busy;
  budgetEl.textContent = state.budget ? `token: ${state.budget.total} / headroom ${state.budget.headroom}` : "—";
  countEl.textContent = state.messageCount != null ? `msgs: ${state.messageCount}` : "";
  const done = state.messages.filter((m) => m.role === "tool" && !m.isError).length;
  const err = state.messages.filter((m) => m.role === "tool" && m.isError).length;
  toolsEl.textContent = `tools: ✓${done} ⚠${err} ⏳${pending.length}`;
  usageEl.textContent = state.lastUsage ? `in ${state.lastUsage.input ?? 0} / out ${state.lastUsage.output ?? 0}` : "";
  errorEl.textContent = state.error ?? "";
}
```

- [ ] **Step 4: Build + 接线审查**

Run: `pnpm --filter @agentforge/web build`
Expected: EXIT 0（bundle.js 含新 render + html/css 复制到 dist/client）

接线审查：onopen/connect/form/abort 不变；render 新增 tool 渲染 + pending + toolsEl；derivePending import 正确；formatArgs 是 function declaration（hoisting OK）。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/main.ts packages/web/src/client/index.html packages/web/src/client/style.css
git commit -m "feat(web): render tool 条目 + pending 占位 + 侧栏概览（P2-2 Task 5）"
```

---

### Task 6: 全量验证（自核）

**Files:** 无改动（验证 only）

- [ ] **Step 1: 全量 typecheck**

Run: `pnpm -r typecheck`
Expected: 4 包（shared/harness/cli/eval）+ web EXIT 0。注意 reducer.ts exclude 自 tsc，靠 vitest；main.ts 改动经 build 已验证。

- [ ] **Step 2: 全量 build**

Run: `pnpm -r build`
Expected: web bundle.js + dist/client（index.html/style.css）生成；其他包 dist 更新。

- [ ] **Step 3: 全量 test**

Run: `pnpm -r test`
Expected: 605 基线（P2-1 后）+ P2-2 新增（derivePending 5 + initState 1 + tool_execution_end 3 + message_end 4 + agent_end/error 3 = 16 新增）→ ~621 全绿。注意 cli 可能有 pre-existing flaky（testTimeout 15000 已配，若 timeout 重跑）。

- [ ] **Step 4: 自核 reducer 接线**

亲读 reducer.ts 全文确认：类型（ToolCallContent/RenderedMessage union/State 无 tools）+ derivePending + 5 分支（message_end/tool_execution_end/agent_end/error + 不变的 message_update/state/context_budget）逻辑与 spec §5 一致；无残留 `state.tools` 引用。

- [ ] **Step 5: 自核 main.ts 接线**

亲读 main.ts render 确认：tool 条目（done/error 图标）+ pending 占位（黄）+ 侧栏 `tools: ✓N ⚠M ⏳K` + formatArgs try/catch + 渲染顺序 messages→streaming→pending（F6）。

- [ ] **Step 6: 更新 SDD ledger + memory**

`.superpowers/sdd/progress.md` 加 P2-2 完成节；memory `agentforge-project-direction.md` Web UI 段更新 P2-2 完成。push origin/pi（用户授权后）。

---

## Self-Review

**1. Spec coverage**：
- §3.1 derivePending → Task 1 ✓
- §3.2 事件行为表（message_update/message_end/tool_execution_end/agent_end/error）→ Task 1-4 ✓（error 分支 §5.4 red-team 吸收）
- §3.3 isError 终态语义 → Task 3（message_end）+ Task 4（agent_end/error）✓
- §3.4 渲染 A1+B1 → Task 5 ✓
- §4 数据模型 → Task 1 ✓
- §5 reducer 逻辑 → Task 1-4 ✓
- §6 渲染 → Task 5 ✓
- §7 文件清单 → File Structure ✓（ws-protocol/server 无改动）
- §8 测试 → Task 1-4 测试 ✓（§8.1 derivePending / §8.2 reducer 行为 / §8.3 兼容回归）
- §9 决策 / §10 pi 借鉴 / §11 red-team → Global Constraints + 各 task 背景核实 ✓

**2. Placeholder scan**：无 TBD/TODO。Task 1 Step 4 把 tool_execution_end 分支一并改（与 Task 2 合并实现），避免删 State.tools 后中间态 broken——Task 2 退化为纯测试 pin，非 placeholder。

**3. Type consistency**：`ToolCallContent`（Task 1 定义）→ Task 3 message_end 用（`as ToolCallContent[]`）；`PendingTool`（Task 1）→ Task 3/4 derivePending 返回；`RenderedMessage` union（Task 1）→ Task 1/2 tool_execution_end push + Task 3/4 push + Task 5 render narrow；`derivePending(messages, streaming?)` 签名跨 task 一致；`ServerEvent.tool_execution_end.toolCallId`（Task 1）→ Task 1/2 用。一致。

**4. 风险**：Task 1 删 `State.tools` 致 tool_execution_end 分支中间态 broken——Task 1 Step 4 已把 tool_execution_end 分支一并改（合并 Task 2 实现），消除中间态。建议实现时 Task 1+2 连续做或 workflow 串行。
