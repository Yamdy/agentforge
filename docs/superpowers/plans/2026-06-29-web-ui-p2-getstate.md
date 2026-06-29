# Web UI P2-1：get_state 快照协议 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实 web UI get_state 快照协议——server 解析 `{method:"get_state"}` 返回会话快照 `{type:"state",...}`，前端连/重连后先 get_state 拿基线；同时落实 id 帧位（所有命令可选带 id），为 P2 safety ask 铺路。

**Architecture:** 新增 `{type:"state"}` 下行事件（非 pi response wrapper、非绑 resumed，与 P1 简化消息协议一致）。handler 零计算透传（pi 借鉴）：handleGetState 直接读 server 状态 + `harness.messages.length`。给 harness 加 1 行 `messages` getter（messageCount=transcript 数组长度，pi 一致）。isCompacting 恒 false / pendingMessageCount 恒 0（agentforge 无 AgentSession 层，如实退化）。顺带修 handleResume 的 sessionId 未更新 bug。

**Tech Stack:** TypeScript, vitest, ws, pnpm workspace, `@earendil-works/pi-agent-core`, `@agentforge/harness`

**Spec:** `docs/superpowers/specs/2026-06-29-web-ui-p2-getstate-design.md`（commit c1863d0，red-team Oracle 6 findings 全吸收）

## Global Constraints

- TypeScript pnpm monorepo（6 包）。自核每步：`tsc --noEmit` + `vitest`，**不信 subagent 报告**（项目有 subagent 报告不实史）。
- **LSP 诊断全程缓存误报**（web 包 stale 索引反复报 "Cannot find module" 等），实际 tsc/vitest 全绿——**以 `tsc --noEmit` + `vitest` 为准，忽略 LSP 诊断**。
- **web tsconfig rootDir: `src/server`**（对齐 package.json exports `./dist/server/index.js`）。`packages/web/src/client/reducer.ts` exclude 自 tsc，靠 vitest 验证逻辑。
- **client 改后须 rebuild**：`packages/web/package.json` build = `tsc && esbuild src/client/main.ts --bundle→dist/client/bundle.js` + node 复制 index.html/style.css 到 dist/client。改 client 后须 `pnpm --filter @agentforge/web build` 才能在 server 生效。
- **GateGuard fact-force hook**：首次 Write/Edit 每文件拦一次，要求陈述 2-4 事实 + 重试；bash 首次也拦。陈述后重试放行。
- **循环依赖**：cli `dynamic import("@agentforge/web")` 破环。
- handler 零计算透传（pi 借鉴 `rpc-mode.ts:442-458`）——handleGetState 不计算，直接读状态 send。
- 铁律：引用源码行号作证据，每个 task 自己跑 tsc + vitest。

---

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `packages/harness/src/harness.ts` | `AgentForgeHarness` class | 加 `get messages()` public getter（透传 `_agent.state.messages`） |
| `packages/web/src/server/ws-protocol.ts` | 上行解析 + 下行序列化 | `ClientMessage` 加 get_state 变体 + 所有变体加 `id?`；`parseClientMessage` 加 get_state 分支 + 解析可选 id |
| `packages/web/src/server/index.ts` | startUiServer（http+ws+harness） | 加 `handleGetState`；修 `handleResume` 更新 sessionId（含 const→let）；dispatch 加 get_state |
| `packages/web/src/client/reducer.ts` | 前端纯函数 reducer | `ServerEvent` 加 state 变体；`State` 加 sessionId?/messageCount?；reducer 加 state 分支 |
| `packages/web/src/client/main.ts` | WS 客户端 + 渲染 | onopen 发 get_state；render 侧栏加 messageCount 显示 |
| `packages/web/src/client/index.html` | 单页结构 | 侧栏加 `<span id="count">` 元素 |
| `packages/web/src/server/ws-protocol.test.ts` | ws-protocol 测试 | 加 get_state 解析 + id 透传 + id 非字符串忽略 |
| `packages/web/src/client/reducer.test.ts` | reducer 测试 | 加 state 事件测试 |
| `packages/web/src/server/index.test.ts` | server 测试 | 加 get_state 快照 + id 透传 + messageCount + resume sessionId 更新 |
| `packages/harness/src/harness.test.ts` | harness 测试 | 加 messages getter 测试 |

任务依赖：Task 1（harness getter）→ Task 3（server 用 harness.messages.length）；Task 2（ws-protocol）→ Task 3（dispatch get_state）；Task 4（reducer）独立；Task 5（main.ts）依赖 Task 3+4；Task 6 全量验证收尾。

---

### Task 1: harness `messages` getter

**Files:**
- Modify: `packages/harness/src/harness.ts`（加 public getter，在现有 `agent` getter 后，约 L235）
- Test: `packages/harness/src/harness.test.ts`

**Interfaces:**
- Produces: `AgentForgeHarness.messages: AgentMessage[]`（public getter，透传 `this._agent.state.messages`）。Task 3 `handleGetState` 读 `harness.messages.length`。

**背景核实**：`harness.ts` 现有 `private _agent`（内部用 `this._agent.state.messages`，见 L337/382/445/503），有 3 个 public getter（`agent` L235 / `verifier` L293 / `instinctStore` L308），**无 `messages` getter**（red-team 验证不冲突）。`AgentMessage` 已 import（`appendNewMessages` 用 `as AgentMessage`）。

- [ ] **Step 1: Write the failing test**

在 `packages/harness/src/harness.test.ts` 的 `describe("AgentForgeHarness", ...)` 内加：

```ts
it("messages getter 返回当前 transcript（prompt 后增长，含 user+assistant）", async () => {
  const { harness } = buildHarness();
  expect(harness.messages.length).toBe(0);
  await harness.prompt("hi");
  // user prompt + assistant 回复
  expect(harness.messages.length).toBe(2);
  expect(harness.messages[0].role).toBe("user");
  expect(harness.messages[1].role).toBe("assistant");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agentforge/harness test -- harness.test.ts -t "messages getter"`
Expected: FAIL（`harness.messages` is undefined——getter 不存在）

- [ ] **Step 3: Write minimal implementation**

在 `packages/harness/src/harness.ts` 现有 `get agent()` getter（约 L235）后加：

```ts
/** 当前 transcript（pi session.messages 对应物）。get_state 快照读其 length 作 messageCount。 */
get messages(): AgentMessage[] {
  return this._agent.state.messages;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agentforge/harness test -- harness.test.ts -t "messages getter"`
Expected: PASS

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @agentforge/harness typecheck`（或 `npx tsc -p packages/harness/tsconfig.json --noEmit`）
Expected: EXIT 0（忽略 LSP 误报）

- [ ] **Step 6: Commit**

```bash
git add packages/harness/src/harness.ts packages/harness/src/harness.test.ts
git commit -m "feat(harness): add messages getter for get_state snapshot

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: ws-protocol get_state + id 解析

**Files:**
- Modify: `packages/web/src/server/ws-protocol.ts`（`ClientMessage` 类型 L75-79 + `parseClientMessage` L81-96）
- Test: `packages/web/src/server/ws-protocol.test.ts`

**Interfaces:**
- Produces: `parseClientMessage` 现在解析 `{method:"get_state"}` → `{ok:true, method:"get_state", id?}`；所有 ok 变体携带可选 `id?: string`。Task 3 dispatch 读 `msg.method === "get_state"` + `msg.id`。

**背景核实**：当前 `ClientMessage`（L75-79）只有 prompt/abort/resume + error，无 id；`parseClientMessage`（L81-96）get_state 落 default 拒 "unknown method"。spec §4.2 L142"所有命令可选带 id"。

- [ ] **Step 1: Write the failing tests**

在 `packages/web/src/server/ws-protocol.test.ts` 的 `describe("parseClientMessage", ...)` 内加：

```ts
it("解析 get_state", () => {
  expect(parseClientMessage(JSON.stringify({ method: "get_state" })))
    .toEqual({ ok: true, method: "get_state" });
});
it("各命令可选 id 透传", () => {
  expect(parseClientMessage(JSON.stringify({ method: "get_state", id: "1" })))
    .toEqual({ ok: true, method: "get_state", id: "1" });
  expect(parseClientMessage(JSON.stringify({ method: "prompt", input: "hi", id: "2" })))
    .toEqual({ ok: true, method: "prompt", input: "hi", id: "2" });
  expect(parseClientMessage(JSON.stringify({ method: "abort", id: "3" })))
    .toEqual({ ok: true, method: "abort", id: "3" });
  expect(parseClientMessage(JSON.stringify({ method: "resume", sessionId: "s", id: "4" })))
    .toEqual({ ok: true, method: "resume", sessionId: "s", id: "4" });
});
it("id 非字符串忽略（undefined）", () => {
  expect(parseClientMessage(JSON.stringify({ method: "get_state", id: 123 })))
    .toEqual({ ok: true, method: "get_state" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agentforge/web test -- ws-protocol.test.ts`
Expected: FAIL（get_state 落 "unknown method"、id 不透传）

- [ ] **Step 3: Write minimal implementation**

替换 `packages/web/src/server/ws-protocol.ts` 的 `ClientMessage` 类型（L75-79）为：

```ts
export type ClientMessage =
  | { ok: true; method: "prompt"; input: string; id?: string }
  | { ok: true; method: "abort"; id?: string }
  | { ok: true; method: "resume"; sessionId: string; id?: string }
  | { ok: true; method: "get_state"; id?: string }
  | { ok: false; error: string };
```

替换 `parseClientMessage`（L81-96）为：

```ts
export function parseClientMessage(data: string): ClientMessage {
  let obj: unknown;
  try { obj = JSON.parse(data); } catch { return { ok: false, error: "invalid json" }; }
  if (typeof obj !== "object" || obj === null) return { ok: false, error: "invalid request" };
  const o = obj as { method?: unknown; input?: unknown; sessionId?: unknown; id?: unknown };
  const id = typeof o.id === "string" ? o.id : undefined;
  if (o.method === "prompt") {
    if (typeof o.input !== "string") return { ok: false, error: "prompt requires input: string" };
    return { ok: true, method: "prompt", input: o.input, ...(id !== undefined ? { id } : {}) };
  }
  if (o.method === "abort") return { ok: true, method: "abort", ...(id !== undefined ? { id } : {}) };
  if (o.method === "resume") {
    if (typeof o.sessionId !== "string") return { ok: false, error: "resume requires sessionId: string" };
    return { ok: true, method: "resume", sessionId: o.sessionId, ...(id !== undefined ? { id } : {}) };
  }
  if (o.method === "get_state") return { ok: true, method: "get_state", ...(id !== undefined ? { id } : {}) };
  return { ok: false, error: `unknown method: ${String(o.method)}` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agentforge/web test -- ws-protocol.test.ts`
Expected: PASS（含原 6 测试 + 新 3 测试全绿）

- [ ] **Step 5: typecheck**

Run: `npx tsc -p packages/web/tsconfig.json --noEmit`
Expected: EXIT 0（忽略 LSP 误报）

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/server/ws-protocol.ts packages/web/src/server/ws-protocol.test.ts
git commit -m "feat(web): parseClientMessage get_state + optional id on all commands

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: server handleGetState + 修 handleResume sessionId bug + dispatch

**Files:**
- Modify: `packages/web/src/server/index.ts`（`sessionId` const→let L26；`handleResume` L69-78 加 `sessionId = sid`；加 `handleGetState`；dispatch L98-104 加 get_state）
- Test: `packages/web/src/server/index.test.ts`

**Interfaces:**
- Consumes: Task 1 `harness.messages.length`；Task 2 `parseClientMessage` get_state + `msg.id`
- Produces: 下行 `{type:"state", id?, sessionId, isStreaming, isCompacting, messageCount, pendingMessageCount}` 事件。Task 4 reducer 处理；Task 5 main.ts 经 reducer 显示。

**背景核实**：`index.ts` L26 `const sessionId = args.session ?? args.resume ?? randomUUID()`——**const 无法 reassign**，handleResume（L69-78）重建 harness 但**未更新 server sessionId 变量**（red-team 验证的 bug）。`harness` 是 `let`（L36）。`busy`（L39）是 isStreaming 源。dispatch 在 `ws.on("message")` L98-104。

- [ ] **Step 1: Write the failing tests**

在 `packages/web/src/server/index.test.ts` 顶部 import 区加（若未有）：

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

在 `describe("startUiServer", ...)` 内加：

```ts
it("get_state 返回 5 字段快照 + id 透传 + messageCount=transcript 长度", async () => {
  const hello = msg("hello");
  const streamFn = vi.fn(() => makeStream([
    { type: "start", partial: hello },
    { type: "done", reason: "stop", message: hello },
  ]));
  const server = await startUiServer([], { streamFn, getApiKey: () => "k", port: 0 });
  try {
    const WebSocket = (await import("ws")).WebSocket;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    const state1 = await new Promise<any>((resolve) => {
      ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "state") resolve(m); });
      ws.send(JSON.stringify({ method: "get_state", id: "q1" }));
    });
    expect(state1.id).toBe("q1");
    expect(state1.isStreaming).toBe(false);
    expect(state1.isCompacting).toBe(false);
    expect(state1.pendingMessageCount).toBe(0);
    expect(state1.messageCount).toBe(0);
    expect(typeof state1.sessionId).toBe("string");
    // prompt 后 messageCount 增长（user + assistant = 2）
    await new Promise<void>((resolve) => {
      ws.on("message", (d) => { if (JSON.parse(d.toString()).type === "agent_end") resolve(); });
      ws.send(JSON.stringify({ method: "prompt", input: "hi" }));
    });
    const state2 = await new Promise<any>((resolve) => {
      ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "state") resolve(m); });
      ws.send(JSON.stringify({ method: "get_state" }));
    });
    expect(state2.messageCount).toBe(2);
    ws.close();
  } finally {
    await server.close();
  }
}, 15000);

it("resume 后 get_state 返回新 sessionId（修 handleResume 未更新 bug）", async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "af-resume-"));
  // 预置一个 session 文件（createJsonlSession + appendEntry，entry 格式对照 @agentforge/shared MessageEntry）
  const { createJsonlSession } = await import("@agentforge/harness");
  const sess = createJsonlSession(join(sessionDir, "preexist.jsonl"));
  sess.appendEntry({
    entryId: "e1", parentId: null, timestamp: 1, type: "message",
    role: "user", content: [{ type: "text", text: "hi" }],
  } as any);
  const hello = msg("ok");
  const streamFn = vi.fn(() => makeStream([
    { type: "start", partial: hello },
    { type: "done", reason: "stop", message: hello },
  ]));
  const server = await startUiServer([], { streamFn, getApiKey: () => "k", port: 0, sessionDir });
  try {
    const WebSocket = (await import("ws")).WebSocket;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    await new Promise<void>((resolve) => {
      ws.on("message", (d) => { if (JSON.parse(d.toString()).type === "resumed") resolve(); });
      ws.send(JSON.stringify({ method: "resume", sessionId: "preexist" }));
    });
    const state = await new Promise<any>((resolve) => {
      ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "state") resolve(m); });
      ws.send(JSON.stringify({ method: "get_state" }));
    });
    expect(state.sessionId).toBe("preexist");
    expect(state.messageCount).toBe(1); // rebuildMessages 重建 1 条历史
    ws.close();
  } finally {
    await server.close();
  }
}, 15000);

it("get_state 只读：busy 期间调不打断 turn（isStreaming=true）", async () => {
  const hello = msg("hello");
  const streamFn = vi.fn(() => makeStream([
    { type: "start", partial: hello },
    { type: "done", reason: "stop", message: hello },
  ]));
  const server = await startUiServer([], { streamFn, getApiKey: () => "k", port: 0 });
  try {
    const WebSocket = (await import("ws")).WebSocket;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    // 发 prompt 后立即 get_state（turn 进行中）
    ws.send(JSON.stringify({ method: "prompt", input: "hi" }));
    const state = await new Promise<any>((resolve) => {
      ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "state") resolve(m); });
      ws.send(JSON.stringify({ method: "get_state" }));
    });
    expect(state.isStreaming).toBe(true);
    // turn 仍正常完成
    const ended = await new Promise<boolean>((resolve) => {
      ws.on("message", (d) => { if (JSON.parse(d.toString()).type === "agent_end") resolve(true); });
    });
    expect(ended).toBe(true);
    ws.close();
  } finally {
    await server.close();
  }
}, 15000);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agentforge/web test -- index.test.ts`
Expected: FAIL（无 state 事件返回 / get_state 落 unknown method）

- [ ] **Step 3: Write minimal implementation**

3a. `packages/web/src/server/index.ts` L26 `const sessionId` 改 `let sessionId`：

```ts
let sessionId = args.session ?? args.resume ?? randomUUID();
```

3b. `handleResume`（L69-78）在 `harness = buildHarness(...)` 后、`send({type:"resumed"...})` 前加 `sessionId = sid;`：

```ts
const handleResume = async (sid: string) => {
  if (busy && abortCtl) abortCtl.abort();
  const newSession = createJsonlSession(`${sessionDir}/${sid}.jsonl`);
  const leafId = newSession.getLeafId();
  if (!leafId) { send({ type: "error", message: `resume: no session ${sid}` }); return; }
  const msgs = rebuildMessages(newSession.getPathToRoot(leafId));
  harness = buildHarness({ args, session: newSession, initialMessages: msgs, streamFn: deps.streamFn, getApiKey: deps.getApiKey });
  sessionId = sid; // 修 bug：更新 server sessionId 变量（get_state 依赖）
  subscribe();
  send({ type: "resumed", sessionId: sid });
};
```

3c. 在 `handleResume` 后加 `handleGetState`（同步，只读，pi 借鉴零计算透传）：

```ts
const handleGetState = (id?: string) => {
  send({
    type: "state",
    ...(id !== undefined ? { id } : {}),
    sessionId,
    isStreaming: busy,
    isCompacting: false, // agentforge 同步压缩无可观测窗口（spec §2.3）
    messageCount: harness.messages.length,
    pendingMessageCount: 0, // P1 无消息队列（spec §2.3）
  });
};
```

3d. `ws.on("message")` dispatch（L98-104）加 get_state 分支：

```ts
ws.on("message", (data) => {
  const msg = parseClientMessage(data.toString());
  if (!msg.ok) { send({ type: "error", message: msg.error }); return; }
  if (msg.method === "prompt") void handlePrompt(msg.input);
  else if (msg.method === "abort") abortCtl?.abort();
  else if (msg.method === "resume") void handleResume(msg.sessionId);
  else if (msg.method === "get_state") handleGetState(msg.id);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agentforge/web test -- index.test.ts`
Expected: PASS（含原 2 测试 + 新 3 测试全绿）

- [ ] **Step 5: typecheck**

Run: `npx tsc -p packages/web/tsconfig.json --noEmit`
Expected: EXIT 0（忽略 LSP 误报）

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/server/index.ts packages/web/src/server/index.test.ts
git commit -m "feat(web): handleGetState snapshot + fix handleResume sessionId update

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: reducer state 分支

**Files:**
- Modify: `packages/web/src/client/reducer.ts`（`State` L12-20 + `ServerEvent` L21-31 + reducer switch L37-71）
- Test: `packages/web/src/client/reducer.test.ts`

**Interfaces:**
- Consumes: Task 3 下行 `{type:"state",...}` 事件
- Produces: `State.sessionId` / `State.messageCount`（Task 5 main.ts render 读取显示）。`busy` 设为 `event.isStreaming`（基线，in-flight agent_start 等随后覆盖）。

**背景核实**：reducer.ts `State`（L12-20）无 sessionId/messageCount；`ServerEvent`（L21-31）无 state 变体；reducer switch 无 state 分支。`resumed` 事件在 main.ts 处理（非 reducer）——P2-1 不改（显示/resume 分离，spec §3.5）。

- [ ] **Step 1: Write the failing test**

在 `packages/web/src/client/reducer.test.ts` 的 `describe("reducer", ...)` 内加：

```ts
it("state 事件设显示 sessionId/busy/messageCount（不动 main.ts resume 控制）", () => {
  const s = reducer(initState(), {
    type: "state", sessionId: "s-1", isStreaming: true,
    isCompacting: false, messageCount: 5, pendingMessageCount: 0,
  });
  expect(s.sessionId).toBe("s-1");
  expect(s.busy).toBe(true);
  expect(s.messageCount).toBe(5);
});
it("state 事件 isStreaming=false 设 busy 基线", () => {
  const s = reducer(initState(), {
    type: "state", sessionId: "s-2", isStreaming: false,
    isCompacting: false, messageCount: 0, pendingMessageCount: 0,
  });
  expect(s.busy).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agentforge/web test -- reducer.test.ts`
Expected: FAIL（state 落 default，state 不变）

- [ ] **Step 3: Write minimal implementation**

3a. `State`（L12-20）加 `sessionId?: string` + `messageCount?: number`：

```ts
export interface State {
  messages: RenderedMessage[];
  streaming?: AssistantMessage;
  budget?: BudgetInfo;
  busy: boolean;
  error?: string;
  lastUsage?: Usage;
  tools: ToolEvent[];
  sessionId?: string;
  messageCount?: number;
}
```

3b. `ServerEvent`（L21-31）加 state 变体（在 `resumed` 前）：

```ts
  | { type: "state"; id?: string; sessionId: string; isStreaming: boolean; isCompacting: boolean; messageCount: number; pendingMessageCount: number }
  | { type: "resumed"; sessionId: string };
```

3c. reducer switch（L37-71）加 state 分支（在 `default` 前）：

```ts
    case "state":
      return { ...state, sessionId: event.sessionId, busy: event.isStreaming, messageCount: event.messageCount };
    default:
      return state;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agentforge/web test -- reducer.test.ts`
Expected: PASS（含原测试 + 新 2 测试全绿）

- [ ] **Step 5: typecheck**

Run: `npx tsc -p packages/web/tsconfig.json --noEmit`
Expected: EXIT 0（reducer.ts exclude 自 tsc，靠 vitest；忽略 LSP 误报）

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/client/reducer.ts packages/web/src/client/reducer.test.ts
git commit -m "feat(web): reducer state event → sessionId/busy/messageCount baseline

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: main.ts onopen 发 get_state + 侧栏渲染 messageCount

**Files:**
- Modify: `packages/web/src/client/main.ts`（onopen L60 + render L26-47 + 加 stateSeq）
- Modify: `packages/web/src/client/index.html`（侧栏加 `<span id="count">`）

**Interfaces:**
- Consumes: Task 3 server get_state 响应 `{type:"state"}`；Task 4 reducer state 分支（state 事件经 reducer 自动设 state.sessionId/messageCount）
- Produces: 前端连/重连后发 get_state 拿基线；侧栏显示 messageCount。

**背景核实**：main.ts onopen（L60）现状 `if (sessionId) ws.send(resume)`，首次连接不发 get_state。onmessage（L54-59）已 dispatch reducer（state 事件自动经 reducer）。`resumed` 仍 main.ts 设 sessionId（L56，现状不变——显示/resume 分离 spec §3.5）。render（L26-47）侧栏有 budget/usage/error，无 messageCount。index.html 侧栏结构需加 count 元素。

- [ ] **Step 1: 改 index.html 加 count 元素**

读 `packages/web/src/client/index.html`，在侧栏（budget/usage 附近）加：

```html
<span id="count"></span>
```

（确切位置对照 index.html 现有侧栏结构，与 budget/usage 同级。）

- [ ] **Step 2: 改 main.ts onopen 发 get_state**

`packages/web/src/client/main.ts` 模块级加（在 `let rafScheduled` L18 附近）：

```ts
let stateSeq = 0;
```

`connect()` 的 `ws.onopen`（L60）改为：

```ts
ws.onopen = () => {
  ws!.send(JSON.stringify({ method: "get_state", id: String(++stateSeq) }));
  if (sessionId) ws!.send(JSON.stringify({ method: "resume", sessionId }));
};
```

- [ ] **Step 3: 改 main.ts render 显示 messageCount**

render（L26-47）加 countEl。在 L13 `const budgetEl = $("budget"), usageEl = $("usage"), errorEl = $("error");` 加 `countEl`：

```ts
const budgetEl = $("budget"), usageEl = $("usage"), errorEl = $("error"), countEl = $("count");
```

render 内（budgetEl.textContent 附近 L44）加：

```ts
countEl.textContent = state.messageCount != null ? `msgs: ${state.messageCount}` : "";
```

- [ ] **Step 4: build client**

Run: `pnpm --filter @agentforge/web build`
Expected: EXIT 0（bundle.js 含 get_state + countEl；dist/client 更新 bundle.js/index.html/style.css）

- [ ] **Step 5: typecheck**

Run: `npx tsc -p packages/web/tsconfig.json --noEmit`
Expected: EXIT 0（忽略 LSP 误报；main.ts exclude 自 server tsc，靠 build）

- [ ] **Step 6: mock streamFn Playwright 冒烟（验证 UI 行为）**

main.ts 是 DOM 副作用，靠冒烟验证（P1 惯例）。起 mock server + Playwright 驱动：

```bash
# 复用 P1 mock-server 冒烟模式：startUiServer([], { streamFn: mock, getApiKey:()=>\"k\", port }) 服务真实 client bundle
# Playwright 打开 http://127.0.0.1:<port>，断言：
# 1. 首次连接后侧栏 #count 显示 "msgs: 0"（get_state 基线）
# 2. 发 prompt "hi" → 流式回复完成 → #count 显示 "msgs: 2"（user+assistant）
# 3. busy 期间 #count 仍可刷新（get_state 只读）
```

手动/脚本验证上述 3 断言（参考 P1 `web-ui-smoke.png` 冒烟流程）。若用 Playwright MCP：navigate → snapshot 找 #count → 断言文本。

Expected: 3 断言全过

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/client/main.ts packages/web/src/client/index.html
git commit -m "feat(web): client onopen sends get_state + sidebar messageCount

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 全量验证 + 收尾

**Files:**
- 无新改动；全量回归 + mock 冒烟收尾

- [ ] **Step 1: 全量 typecheck**

Run: `pnpm -r typecheck`
Expected: EXIT 0（5 包绿：shared/harness/eval/web/cli）

- [ ] **Step 2: 全量 build**

Run: `pnpm -r build`
Expected: EXIT 0（web bundle.js + dist/client html/css 部署）

- [ ] **Step 3: 全量 test**

Run: `pnpm -r test`
Expected: 全绿（P1 基线 596 + P2-1 新增：harness 1 + ws-protocol 3 + reducer 2 + server 3 = 9 新测试）

- [ ] **Step 4: 真 LLM 冒烟（可选，需 API key）**

```bash
set -a; source .env; set +a; node packages/cli/dist/index.js ui
# 浏览器打开，发 prompt，验证流式 + 侧栏 messageCount + 重连 get_state
```

或用 mock streamFn 冒烟（无需 key，推荐）。

- [ ] **Step 5: 更新 SDD ledger**

在 `.superpowers/sdd/progress.md` 末节加 P2-1 完成记录（commit hash + 验证结果）。

- [ ] **Step 6: 最终 commit + push**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs(sdd): P2-1 get_state complete

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin pi
```
