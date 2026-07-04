# Task 1 union narrow 全面对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 reducer 与 pi AgentMessage 双类型漂移(Extract 派生单一来源)+ 修复 toolResult message_end 误渲染空 assistant 气泡 bug。

**Architecture:** shared re-export `AgentMessage`;reducer 用 `Extract<AgentMessage,{role}>` 派生 `AssistantMessage`/`UserMessage`/`ToolCall`/`Usage`,删本地类型;narrow 守卫 `isAssistant`/`isUser`;`message_end` 非 user/assistant(含 toolResult)走 default 不 push;`message_update` 非 assistant 不存。client 仍 exclude web tsc,以 vitest 为准。

**Tech Stack:** TypeScript 5.9.3,vitest 4.1.9,pnpm workspace,@earendil-works/pi-agent-core 0.79.9。

**Spec:** `docs/superpowers/specs/2026-07-01-arch-task1-union-narrow-design.md`

## Global Constraints
- 改 shared 后必须 `pnpm --filter @agentforge/shared build` rebuild dist(下游经 dist `.d.ts` resolve,既有陷阱)。
- client exclude web tsc(`packages/web/tsconfig.json` include 仅 `src/server`),以 `pnpm -r typecheck` + vitest 为准;LSP 诊断本任务大多真实非误报。
- TDD:red→green→refactor,每步跑命令确认。
- 不改 pi 核心,只消费其 export 类型。
- commit message 结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- `AgentMessage` 实为 7 成员 union(pi-agent-core 自扩展 CustomAgentMessages:user/assistant/toolResult/bashExecution/custom/branchSummary/compactionSummary)。

## File Structure
- `packages/shared/src/index.ts` — 加 `export type { AgentMessage }`。
- `packages/web/src/client/reducer.ts` — 删本地 Usage/ToolCallContent/AssistantMessage,Extract 派生,narrow 守卫,message_end toolResult default,message_update narrow。
- `packages/web/src/client/reducer.test.ts` — fixture helper(mkUsage/mkAssistant/mkUser),升级 ~14 处 fixture,加 3 契约测,调 line 21 expect。
- `packages/web/src/client/main.ts` — 无需改(验证类型自动收敛)。
- `packages/cli/src/compaction-config.ts:35` — 修正注释(AgentMessage 实为 7 成员 union)。

---

### Task 1: shared re-export AgentMessage

**Files:**
- Modify: `packages/shared/src/index.ts`(末尾加 re-export)

**Interfaces:**
- Produces: `@agentforge/shared` 导出 `AgentMessage` 类型,供 reducer 派生。

- [ ] **Step 1: 加 re-export**

在 `packages/shared/src/index.ts` 末尾(line 263 `}` 后)加:
```ts

/** pi AgentMessage 单一来源 re-export:供 web/reducer 派生子类型,消除本地副本漂移。 */
export type { AgentMessage } from "@earendil-works/pi-agent-core";
```

- [ ] **Step 2: rebuild dist**

Run: `pnpm --filter @agentforge/shared build`
Expected: `packages/shared typecheck: Done` + tsc 生成 dist(无错)。

- [ ] **Step 3: 验证 dist 含 re-export**

Run: `grep "AgentMessage" packages/shared/dist/index.d.ts`
Expected: 含 `export type { AgentMessage } from "@earendil-works/pi-agent-core";`。

- [ ] **Step 4: typecheck shared**

Run: `pnpm --filter @agentforge/shared typecheck`
Expected: Done(无错)。

- [ ] **Step 5: commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): re-export pi AgentMessage — 单一来源供 reducer 派生

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: reducer 全面对齐(Extract 派生 + narrow + toolResult bug 修复)

**Files:**
- Modify: `packages/web/src/client/reducer.ts`(类型对齐 + narrow 逻辑)
- Test: `packages/web/src/client/reducer.test.ts`(helper + 升级 fixture + 契约测)

**Interfaces:**
- Consumes: `AgentMessage` from `@agentforge/shared`(Task 1)。
- Produces: `reducer` 消费 `ServerEvent`;`State.streaming: AssistantMessage`;export `AssistantMessage`/`UserMessage`/`ToolCall`/`Usage`(派生);`isAssistant`/`isUser` 守卫;toolResult/bashExecution/... message_end 走 default(修空 assistant 气泡 bug)。

- [ ] **Step 1: 写契约测 + helper(红)**

在 `reducer.test.ts`:

import 行(line 3)改为:
```ts
import { reducer, initState, derivePending, type AssistantMessage, type UserMessage, type Usage, type RenderedMessage, type ServerEvent, type ServerControlEvent } from "./reducer.js";
```

顶部(line 3 后)加 helper:
```ts
type Api = AssistantMessage["api"];
type Provider = AssistantMessage["provider"];
const mkUsage = (o: Partial<Usage> = {}): Usage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, ...o,
});
const mkAssistant = (o: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: "assistant", content: [], api: "" as Api, provider: "" as Provider,
  model: "m", usage: mkUsage(), stopReason: "stop", timestamp: 0, ...o,
});
const mkUser = (o: Partial<UserMessage> = {}): UserMessage => ({ role: "user", content: [], timestamp: 0, ...o });
```

在 `describe("reducer")` 块末尾(line 88 `});` 前)加 3 契约测:
```ts
  it("message_end(toolResult) → state 不变(修空 assistant 气泡 bug,pi emitToolResultMessage agent-loop.js:506-508)", () => {
    const before = initState();
    const after = reducer(before, { type: "message_end", message: { role: "toolResult", toolCallId: "tc1", toolName: "read", content: [], isError: false, timestamp: 0 } });
    expect(after).toBe(before);
  });
  it("message_end(bashExecution) → state 不变(防御,pi 不 emit 但 union 允许)", () => {
    const before = initState();
    const after = reducer(before, { type: "message_end", message: { role: "bashExecution", command: "ls", output: "", exitCode: 0, cancelled: false, truncated: false, timestamp: 0 } });
    expect(after).toBe(before);
  });
  it("message_update(非 assistant) → streaming 不变(防御,user 不流式)", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: mkAssistant({ content: [{ type: "text", text: "hel" }] }) });
    expect(s.streaming).toBeDefined();
    s = reducer(s, { type: "message_update", message: mkUser({ content: [{ type: "text", text: "u" }] }) });
    expect(s.streaming?.content.find((c) => c.type === "text")?.text).toBe("hel");
  });
```

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @agentforge/web test`
Expected: 3 新测 FAIL。`message_end(toolResult)` 当前被 push → `after !== before`;`message_update(非 assistant)` 当前 user 覆盖 streaming → text "hel" 失败。(现有 fixture 因类型未改,vitest 经 esbuild 剥类型仍跑,但新契约测红。)

- [ ] **Step 3: 实现 reducer 类型对齐 + narrow**

改 `packages/web/src/client/reducer.ts`:

line 7 import 改为:
```ts
import type { AgentMessage, SerializedEvent } from "@agentforge/shared";
```

删 line 9(`Usage`)、line 11-16(`ToolCallContent`)、line 17-23(`AssistantMessage`)。替换为派生类型:
```ts
export type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
export type UserMessage = Extract<AgentMessage, { role: "user" }>;
export type ToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
export type Usage = AssistantMessage["usage"];
```

`RenderedMessage`(原 line 24-29)`toolCalls` 改 `ToolCall[]`:
```ts
export type RenderedMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; stopReason?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; text: ""; toolCallId: string; toolName: string; args: unknown;
      status: "done" | "error"; isError: boolean };
```
(`State` 字段名不变,`streaming?: AssistantMessage` / `lastUsage?: Usage` 自动收敛到派生类型。)

`initState` 前加 narrow 守卫:
```ts
const isAssistant = (m: AgentMessage): m is AssistantMessage => m.role === "assistant";
const isUser = (m: AgentMessage): m is UserMessage => m.role === "user";
```

`message_update` case(原 line 65-66)改为:
```ts
    case "message_update":
      return isAssistant(event.message) ? { ...state, streaming: event.message } : state;
```

`message_end` case(原 line 67-85)改为:
```ts
    case "message_end": {
      const msg = event.message;
      if (isUser(msg)) {
        const text = typeof msg.content === "string" ? msg.content : msg.content.find((c) => c.type === "text")?.text ?? "";
        return { ...state, messages: [...state.messages, { role: "user", text }] };
      }
      if (!isAssistant(msg)) return state;  // toolResult/bashExecution/custom/branchSummary/compactionSummary → 不渲染
      const text = msg.content.find((c) => c.type === "text")?.text ?? "";
      const toolCalls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
      const failError = (msg.stopReason === "error" || msg.errorMessage) ? (msg.errorMessage ?? "LLM error") : undefined;
      const messages: RenderedMessage[] = [...state.messages, { role: "assistant", text, stopReason: msg.stopReason, toolCalls }];
      if (msg.stopReason === "aborted" || msg.stopReason === "error") {
        const pending = derivePending(messages, undefined);
        for (const p of pending) {
          messages.push({ role: "tool", text: "", toolCallId: p.toolCallId, toolName: p.toolName, args: p.args, status: "error", isError: true });
        }
      }
      return { ...state, messages, streaming: undefined, lastUsage: msg.usage, error: failError ?? state.error };
    }
```

`derivePending`(原 line 131-157)逻辑不变 —— `streaming: AssistantMessage` 派生后 content `(TextContent|ThinkingContent|ToolCall)[]`,line 150 `b.type === "toolCall"` 已 narrow 到 ToolCall,类型自动收敛。其余 case(agent_end/error/context_budget/tool_execution_end/state)不变。

- [ ] **Step 4: 升级现有 fixture**

`reducer.test.ts` 内联 message 替换为 helper(规则:assistant → `mkAssistant({...})`,user → `mkUser({...})`,去 `as any`):

| 行 | 改为 |
|---|---|
| 11 | `mkAssistant({ content: [{ type: "text", text: "hel" }] })` |
| 12 | `mkAssistant({ content: [{ type: "text", text: "hello" }] })` |
| 17 | `mkAssistant({ content: [{ type: "text", text: "hi" }] })` |
| 18 | `mkAssistant({ content: [{ type: "text", text: "hi" }], usage: mkUsage({ input: 10, output: 5 }) })` |
| 21 | `expect(s.lastUsage).toMatchObject({ input: 10, output: 5 })`(toEqual → toMatchObject,因 Usage 全字段) |
| 25 | `mkAssistant({ content: [], stopReason: "aborted" })` |
| 31 | `mkAssistant({ content: [{ type: "text", text: "" }], stopReason: "error", errorMessage: "boom" })`(去 `as any`) |
| 38 | `mkAssistant({ content: [], errorMessage: "kaput" })`(去 `as any`) |
| 43 | `mkAssistant()` |
| 51 | `mkUser({ content: [{ type: "text", text: "hi" }] })` |
| 58 | `mkAssistant()` |
| 97-100 | `const streaming: AssistantMessage = mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "a.ts" } }] });` |
| 125-128 | `mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] })` |
| 151-154 | `mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] })` |
| 155 | `reducer(initState(), { type: "message_update", message: streaming })`(不变,streaming 已 AssistantMessage) |
| 165-168 | `mkAssistant({ content: [{ type: "text", text: "hi" }, { type: "toolCall", id: "tc1", name: "read", arguments: { path: "a" } }] })` |
| 181-183 | `mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] })` |
| 184-187 | `mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }], stopReason: "aborted" })` |
| 193-196 | `mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }], stopReason: "error", errorMessage: "boom" })` |
| 202-204 | `mkAssistant({ content: [{ type: "text", text: "done" }], stopReason: "stop" })` |
| 211-213 | `mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] })` |
| 222-225 | `mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }], stopReason: "error" })` |
| 233-235 | `mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] })` |
| 259-260 | `mkAssistant()` |
| 263 | 不改(`context_budget` components:{} 既有,vitest runtime OK,非本 task 范围) |

- [ ] **Step 5: 跑绿**

Run: `pnpm --filter @agentforge/web test`
Expected: 全绿 —— 3 新契约测 + 现有 25 测(行为除 toolResult default 外不变)。`State.streaming` narrow 后 `streaming?.content.find` 类型收敛。

- [ ] **Step 6: commit**

```bash
git add packages/web/src/client/reducer.ts packages/web/src/client/reducer.test.ts
git commit -m "refactor(web): reducer Extract 派生 AgentMessage 子类型 + 修 toolResult 误渲染 bug

- 删本地 Usage/ToolCallContent/AssistantMessage,Extract<AgentMessage,{role}> 派生(单一来源)
- narrow 守卫 isAssistant/isUser;message_end 非 user/assistant 走 default
- 修 toolResult message_end 误渲染空 assistant 气泡 bug(pi emitToolResultMessage)
- fixture helper mkUsage/mkAssistant/mkUser,去 as any

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 收尾(main.ts 验证 + compaction-config 注释 + 全量验证)

**Files:**
- Verify: `packages/web/src/client/main.ts`(无需改)
- Modify: `packages/cli/src/compaction-config.ts:35`(注释修正)

- [ ] **Step 1: 验证 main.ts 类型收敛**

Run: `pnpm --filter @agentforge/web test`
Expected: 绿(main.ts 逻辑不变,`streamingText()` 的 `state.streaming?.content?.find((b) => b.type === "text")` 因 streaming 现为 AssistantMessage 自动收敛;client exclude tsc,LSP 诊断应收敛)。

目视 `packages/web/src/client/main.ts:22-25` `streamingText()`:无需改。

- [ ] **Step 2: 修正 compaction-config 注释**

`packages/cli/src/compaction-config.ts:35` 注释:
```ts
    // agentforge 当前不增强 CustomAgentMessages，故 AgentMessage 结构即 pi-ai Message，
```
改为:
```ts
    // agentforge 不增强 CustomAgentMessages,但 pi-agent-core 自扩展(bashExecution/custom/
    // branchSummary/compactionSummary),故 AgentMessage 实为 7 成员 union(pi-ai Message 3 + pi-agent-core 4)。
```

- [ ] **Step 3: shared rebuild(确认 dist 最新)**

Run: `pnpm --filter @agentforge/shared build`
Expected: Done(若 Task 1 后 shared 未再改,dist 已最新;此步兜底)。

- [ ] **Step 4: 全量 typecheck**

Run: `pnpm -r typecheck`
Expected: 5 包全绿(shared/harness/eval/web/cli Done)。reducer exclude web tsc,不报;shared re-export 后下游 resolve 正常。

- [ ] **Step 5: 全量 test**

Run: `pnpm -r test`
Expected: 657+ passed + 1 todo;cli repl flaky pre-existing(若触发,重跑 `pnpm --filter @agentforge/cli test` 确认偶发)。

- [ ] **Step 6: commit**

```bash
git add packages/cli/src/compaction-config.ts
git commit -m "docs(cli): 修正 compaction-config CustomAgentMessages 注释 — AgentMessage 实为 7 成员 union

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖**:
- §3.1 shared re-export → Task 1 ✓
- §3.2 reducer Extract 派生 + 删本地 + narrow 守卫 → Task 2 Step 3 ✓
- §3.3 reducer 逻辑(message_update narrow + message_end toolResult default)→ Task 2 Step 3 ✓
- §3.4 main.ts 验证 → Task 3 Step 1 ✓
- §3.5 fixture helper + 升级 → Task 2 Step 1+4 ✓
- §4 红队吸收(import path→Extract;toolResult bug→契约测;Api/Provider as cast;cacheWrite1h;rebuild 时机)→ Task 1-3 ✓
- §5 TDD 契约测 → Task 2 Step 1 ✓
- §8 compaction-config 注释修正 → Task 3 Step 2 ✓

**2. Placeholder 扫描**:无 TBD/TODO/"implement later"。fixture 表完整列出行号 + 改后代码。✓

**3. 类型一致**:`AssistantMessage`/`UserMessage`/`ToolCall`/`Usage` 在 Task 2 Step 3 定义(export),Step 1 helper + 契约测 import 使用,命名一致。`isAssistant`/`isUser` 守卫名一致。`mkAssistant`/`mkUser`/`mkUsage` helper 名一致。✓

**4. 风险点**:Task 2 Step 4 fixture 升级是机械但量大(~14 处),执行者需逐行核对表。line 21 `toEqual→toMatchObject` 是唯一 expect 调整(Usage 全字段)。context_budget components:{}(line 263/70)不改(既有,vitest runtime OK)。
