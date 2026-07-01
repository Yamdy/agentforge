# Task 1 — union narrow 全面对齐 设计

- **Date**: 2026-07-01
- **Branch**: `pi` @ `61bed01`
- **Status**: 设计认可,待写 plan
- **关联**: handoff `agentforge-arch-handoff-20260630.md` Task 1;前序 commit `61bed01`(协议层架构深化 A+B+C+H)
- **Skill 流程**: brainstorming → red-team(Oracle)→ 本 spec → writing-plans → TDD

---

## 1. 背景与问题

### 1.1 摩擦根源
`packages/shared/src/index.ts:1` import pi `AgentMessage`(用于 `SerializedEvent.message_update/message_end.message`,line 147-148)但**未 re-export**。下游 `packages/web/src/client/reducer.ts` 拿不到 `AgentMessage` 类型,自造本地 `AssistantMessage`(line 17-23,简化无 api/provider/model/usage/timestamp)、`ToolCallContent`(line 11-16)、`Usage`(line 9,全可选)。

协议层深化(commit 61bed01)派生 `ServerEvent = SerializedEvent | ServerControlEvent`(reducer.ts:55)后,`event.message` 是 pi `AgentMessage`,与本地简化类型不兼容 → reducer.ts:66/69-73/84 类型摩擦。

### 1.2 AgentMessage 实际结构(7 成员 union)
**关键发现(修正 handoff "LSP 全缓存误报" 认知)**:`AgentMessage` 非 3 成员。pi-agent-core `dist/harness/messages.d.ts:38-45` 用 declaration merging 扩展 `CustomAgentMessages`:

```
AgentMessage = UserMessage | AssistantMessage | ToolResultMessage   (pi-ai Message)
             | BashExecutionMessage | CustomMessage
             | BranchSummaryMessage | CompactionSummaryMessage      (pi-agent-core 扩展)
```

role 判别式:`user` / `assistant` / `toolResult` / `bashExecution` / `custom` / `branchSummary` / `compactionSummary`。`BashExecutionMessage` / `BranchSummaryMessage` / `CompactionSummaryMessage` **无 content 字段**。LSP 诊断提到的 `BashExecutionMessage` **真实存在,非误报**。

### 1.3 真实 bug:toolResult 误渲染
pi `agent-loop.js:506-508` `emitToolResultMessage` 对每个 `ToolResultMessage` emit `message_start` + `message_end`。reducer.ts:73 `msg?.role === "user" ? {user} : {assistant}` 把 toolResult(及任何非 user)当 assistant → push `{role:"assistant", text:"", toolCalls:undefined}` **空 assistant 气泡**。当前 UI 每个 tool 结果显示:tool 条目(tool_execution_end,正常)+ 空 assistant 气泡(message_end toolResult,bug)。

## 2. 目标与非目标

**目标**:
- 消除 reducer 与 pi AgentMessage 双类型漂移(单一来源)。
- 修复 toolResult 误渲染 bug。
- reducer 类型自洽(ServerEvent 派生后 event.message 与 reducer 类型兼容)。

**非目标**:
- 不把 client 纳入 web tsc(不碰 DOM lib / tsconfig 拆分,选项 c 已否决)。
- 不改 SerializedEvent / ServerControlEvent / ServerEvent 形态(协议层零改)。
- 不改 pi 核心。

## 3. 设计

### 3.1 shared 改动(`packages/shared/src/index.ts`)
```ts
export type { AgentMessage } from "@earendil-works/pi-agent-core";
```
- 已确认 pi-agent-core `types.ts:271` export `AgentMessage`,经 `base.d.ts:19 export * from "./types.ts"` re-export。
- **不加 `@earendil-works/pi-ai` 依赖**(红队 🔴 finding 1:pi-ai 类型在 pi-agent-core 内是 `import type`,不经 `export *` re-export)。
- 改后**立即** `pnpm --filter @agentforge/shared build`(红队 failure mode:rebuild dist 再动 reducer,下游经 dist `.d.ts` resolve)。

### 3.2 reducer 类型对齐(`packages/web/src/client/reducer.ts`)
从 AgentMessage 派生子类型(真正单一来源,非引入第二源 pi-ai):
```ts
import type { AgentMessage } from "@agentforge/shared";
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type UserMessage = Extract<AgentMessage, { role: "user" }>;
type ToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
type Usage = AssistantMessage["usage"];
```
- 删本地 `Usage`(line 9)、`ToolCallContent`(line 11-16)、`AssistantMessage`(line 17-23)。
- `State.streaming: AssistantMessage | undefined`(narrow 存)。
- `State.lastUsage: Usage | undefined`(`Usage = AssistantMessage["usage"]`,含 `cacheWrite1h?` 可选;其余 `input`/`output`/`cacheRead`/`cacheWrite`/`totalTokens`/`cost` 必填)。
- `RenderedMessage.toolCalls: ToolCall[]`。
- narrow 守卫:`isAssistant = (m: AgentMessage): m is AssistantMessage => m.role === "assistant"`;`isUser` 同理。
- 保留本地:`BudgetInfo`/`ToolEvent`/`PendingTool`/`RenderedMessage`/`State`/`ServerControlEvent`(渲染/控制层自有,非 pi)。

### 3.3 reducer 逻辑
- `message_update`(line 66):`isAssistant(event.message)` → 存 streaming;else 不变(防御性,pi 语义只对 assistant 流式)。
- `message_end`(line 67-85)显式 narrow:
  - `isUser(msg)` → push user 条目(content 可能 `string`,提取 text)。
  - `isAssistant(msg)` → push assistant 条目(text/toolCalls/stopReason/usage)。
  - 其余 5 种(toolResult/bashExecution/custom/branchSummary/compactionSummary)/default → 返回 state 不 push。
- `derivePending`(line 131):streaming 现 `AssistantMessage`,content `(TextContent|ThinkingContent|ToolCall)[]`,`b.type === "toolCall"` narrow 到 `ToolCall`。逻辑不变,类型收敛。

### 3.4 main.ts(`packages/web/src/client/main.ts`)
`streamingText()`(line 22-25)逻辑不变:streaming 是 `AssistantMessage`,content 数组,`.find(b => b.type === "text")` 收敛到 `TextContent | undefined`。类型摩擦消失(client exclude tsc,LSP 诊断收敛)。

### 3.5 test fixture helper(`packages/web/src/client/reducer.test.ts`)
```ts
type Api = AssistantMessage["api"]; type Provider = AssistantMessage["provider"];
const mkUsage = (o: Partial<Usage> = {}): Usage => ({ input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0, cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}, ...o });
const mkAssistant = (o: Partial<AssistantMessage> = {}): AssistantMessage => ({ role:"assistant",content:[], api:"" as Api, provider:"" as Provider, model:"m", usage:mkUsage(), stopReason:"stop", timestamp:0, ...o });
const mkUser = (o: Partial<UserMessage> = {}): UserMessage => ({ role:"user",content:[],timestamp:0, ...o });
```
- ~14 处内联 message fixture 替换为 `mkAssistant`/`mkUser`。
- `AssistantMessage` 类型标注(line 97/125/151)改派生 `AssistantMessage`。
- api/provider 用 `as` cast(**fixture-only 例外**,红队 🟡 finding 3:避免硬编码 literal 与 pi-ai enum 耦合)。
- 现有 `as any`(line 31/38)随 fixture 升级消除。

## 4. 红队审查(Oracle)findings 与吸收

| # | 严重度 | finding | 吸收 |
|---|---|---|---|
| 1 | 🔴 Blocking | §2 import path 错:pi-ai 类型是 `import type` 不经 `export *` re-export;`export type {AssistantMessage} from pi-agent-core` 失败 | 改 Extract 派生(§3.2),只 re-export AgentMessage,不加 pi-ai 依赖 |
| 2 | 🟡 Important | 低估 bug:pi 确实 emit message_end(toolResult)(agent-loop.js:506-508),当前空 assistant 气泡是真实 bug,非防御 | §1.3/§3.3 修正为真实 bug 修复;TDD 契约测验证修复 |
| 3 | 🟡 Important | mkAssistant 的 Api/Provider 默认值与 pi-ai enum 耦合 | §3.5 用 `as Api`/`as Provider` cast(fixture-only) |
| 4 | 🟡 Important | Usage.cacheWrite1h 可选,§3 "字段全必填" 不精确 | §3.2 修正:cacheWrite1h? 可选,其余必填 |
| 5 | ⚪ Advisory | fixture 行号 97/125/151 正确,~14 处合理 | 无需改 |
| — | failure mode | shared dist stale:应在 §2 后立即 rebuild | §3.1 改为 §2 后立即 rebuild |

## 5. 测试策略(TDD,red→green→refactor)

1. 先加契约测(红):
   - `message_end(toolResult)` → state 不变(不 push,验证 bug 修复)。
   - `message_end(bashExecution)` → state 不变(防御,pi 不 emit 但类型允许)。
   - `message_update(非 assistant)` → streaming 不变。
2. `pnpm --filter @agentforge/web test` 红 → 实现 §3 → 绿。
3. 全量验证:
   - `pnpm --filter @agentforge/shared build`(rebuild dist)
   - `pnpm -r typecheck`(5 包绿)
   - `pnpm -r test`(657+ passed,cli repl flaky pre-existing)
4. reducer.test.ts 现有 25 测全绿(除 toolResult 改进外行为不变)。

## 6. 风险与回滚

- **改 shared rebuild dist**:§3.1 后立即 rebuild;漏 rebuild → 下游 tsc 经旧 `.d.ts` resolve 报错(既有陷阱)。
- **行为改变**:toolResult message_end 从"误渲染空 assistant 气泡"→"不渲染"。修当前 bug,非回归。TDD 契约测覆盖。
- **Api/Provider cast**:fixture-only,不进生产;pi-ai enum 改名时 cast 仍编译(fixture 不依赖语义)。
- **LSP 诊断**:本任务大多真实(非误报),以 tsc/vitest 为准但仍需正视。
- **回滚**:单 commit(reducer + shared + test,可选 compaction-config 注释修正),`git revert`。

## 7. 验证命令

```bash
pnpm --filter @agentforge/shared build   # 改 shared 后必跑
pnpm -r typecheck                        # 5 包 tsc
pnpm -r test                             # vitest(cli repl flaky pre-existing)
```

## 8. 验证证据(行号)

- `reducer.ts`:9(Usage)/11-16(ToolCallContent)/17-23(AssistantMessage)/55(ServerEvent)/66,69-73,84(摩擦)/73(bug ternary)/131(derivePending)
- `shared/index.ts`:1(import AgentMessage)/144-175(SerializedEvent)/147-148(message: AgentMessage)
- `main.ts`:22-25(streamingText)
- `reducer.test.ts`:31,38(as any)/97,125,151(AssistantMessage 标注)
- pi-agent-core `types.d.ts`:271(AgentMessage export)
- pi-agent-core `messages.d.ts`:38-45(CustomAgentMessages 扩展)/7(BashExecutionMessage)
- pi-agent-core `agent-loop.js`:506-508(emitToolResultMessage)
- pi-ai `types.d.ts`:206(UserMessage)/211(AssistantMessage)/225(ToolResultMessage)/234(Message)/182(ToolCall)/189(Usage)
- `web/tsconfig.json`:7(include src/server only)
- `shared/package.json`:21(仅 pi-agent-core 依赖)
- `cli/compaction-config.ts`:35(注释"agentforge 不增强 CustomAgentMessages"——注:pi-agent-core 自身扩展,AgentMessage 实为 7 成员;**该注释不准确,实现时一并修正**)

---

无敏感信息泄露。
