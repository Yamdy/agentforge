# agentforge Web UI — P2-1：get_state 快照协议设计

- 日期：2026-06-29
- 状态：草案（待实现）
- 范围：P2-1（get_state 快照协议 + id 帧位落实）
- 关联：
  - `docs/superpowers/specs/2026-06-28-web-ui-p1-design.md`（P1 spec，§4.2/§8/§13 是本 spec 依据）
  - pi 蓝本：`C:\Users\90514\code\primo\pi\packages\coding-agent\src\modes\rpc\rpc-types.ts:91-104`（RpcSessionState）、`rpc-mode.ts:442-458`（get_state handler）、`core/agent-session.ts`（状态跟踪）

## 1. 背景与动机

P1 已完成 web UI MVP（单会话流式对话 + 可观测侧栏）。P1 spec §13 + §4.2 把 `get_state` 快照协议 + `id` 帧位列为 🟡 有意 defer 到 P2 的增量（非 bug）——Task5 ledger（`.superpowers/sdd/progress.md` L37）记 "get_state + id 降 P2"。

**P2-1 目标**：落实 get_state 快照协议——server 解析 `{method:"get_state"}` + 返回会话快照，前端连/重连后先 get_state 拿基线。同时落实 `id` 帧位（spec §4.2 L142"所有命令可选带 id"，P1 仅预留未解析），为 P2 后续 safety ask 双向 RPC 铺路（spec §13 L279）。

**价值**：重连状态同步更稳——client 知道 server 当前是否流式、当前活跃 sessionId、消息数，避免误判卡死；id 帧位让请求-响应可关联，为 safety ask 留协议基础。

## 2. pi 借鉴（源码核实，非推断）

调查 pi 的 get_state 实现链（`C:\Users\90514\code\primo\pi`）：

### 2.1 handler 零计算、纯透传

pi `rpc-mode.ts:442-458` 的 `get_state` handler 不计算任何字段，全部 `session.*` getter 透传：

```ts
case "get_state": {
  const state: RpcSessionState = {
    model: session.model,
    isStreaming: session.isStreaming,
    isCompacting: session.isCompacting,
    sessionId: session.sessionId,
    messageCount: session.messages.length,
    pendingMessageCount: session.pendingMessageCount,
    // ...
  };
  return success(id, "get_state", state);
}
```

**agentforge 借鉴**：handleGetState 同样薄——直接读 server 状态/transcript，不计算。

### 2.2 各字段跟踪机制（核实）

| 字段 | pi 机制 | 源码 |
|---|---|---|
| isStreaming | AgentLoop `AgentState.isStreaming` flag（turn in-flight） | `agent.ts:463/495`、`types.ts:331-335` |
| isCompacting | **AbortController 存在性**——3 个 controller（auto/manual/branch）任一存在=压缩中；压缩**异步**（`async compact()`+await，controller 后台跑期间一直在） | `agent-session.ts:829-836,284-289,1652-1781` |
| sessionId | SessionManager 委托（持久层） | `agent-session.ts:858-861` |
| messageCount | **AgentLoop `messages: AgentMessage[]` 数组长度**（transcript，压缩时被替换骤降）——非计数器 | `rpc-mode.ts:454`、`agent.ts:119` |
| pendingMessageCount | AgentSession 双队列（`_steeringMessages` + `_followUpMessages` 文本镜像）长度和 | `agent-session.ts:1402-1405,277-279` |

### 2.3 可借鉴 / 不可照搬

**可借鉴**：
- handler 零计算透传模式
- messageCount = transcript 数组长度（非计数器）——简单可靠，压缩骤降语义正确
- isStreaming / sessionId 委托模式

**不可照搬**（agentforge spec §3.2 YAGNI 不引入 AgentSession 层）：
- **isCompacting 的 AbortController 存在性判定**依赖异步压缩编排。agentforge harness 压缩是**同步**的（`maybeCompact` 在 `harness.prompt` 内 await，`harness.ts:354-356/470-515`），同步压缩时控制流在压缩函数内，不会并发处理 get_state——**没有"压缩中"可观测窗口**。故 agentforge isCompacting 恒 false（本质正确，非偷懒）。**依赖 Node 单线程事件循环**：`handlePrompt` 的 await 链与 `ws.on("message")` dispatch 同循环，get_state 无法插入压缩期间；若未来 compaction 改异步编排（如 pi `agent-session.ts:2273` 的 fire-and-forget 模式），此 false 会失真，需重新评估。
- **pendingMessageCount 的双队列**整体缺失。agentforge P1 无 steer/follow_up 消息队列（handlePrompt busy 时直接回 error"busy"不排队，`server/index.ts:54`），字段无对应物。故恒 0（本质正确）。

**核心**：pi 字段是 AgentSession 层状态投影，AgentSession 层（AbortController 状态机 + 双队列 + SessionManager）正是 agentforge 没有的。字段值真实性取决于子系统是否存在——agentforge 如实返回 false/0 是 YAGNI 的必然。

## 3. 架构 / 组件改动

### 3.1 `packages/harness/src/harness.ts`（加 1 行 getter）

新增 public getter 暴露当前 transcript（pi `session.messages` 对应物）：

```ts
get messages(): AgentMessage[] { return this._agent.state.messages; }
```

server handleGetState 读 `harness.messages.length` 作 messageCount。`_agent` 当前 private（`harness.ts:337/382/445/503` 已内部用 `this._agent.state.messages`），getter 透传不改内部逻辑。

### 3.2 `packages/web/src/server/ws-protocol.ts`（协议层）

- `ClientMessage` 类型：加 `{ok:true; method:"get_state"; id?: string}` 变体；prompt/abort/resume 三个变体各加 `id?: string`
- `parseClientMessage`：加 `get_state` 分支（无参数）；**所有命令解析可选 `id`**：

```ts
const id = typeof o.id === "string" ? o.id : undefined;
// 各 ok 变体携带 id
```

### 3.3 `packages/web/src/server/index.ts`（handleGetState + 修 bug）

- `handleGetState(id?)`（同步，只读）：

```ts
const handleGetState = (id?: string) => {
  send({
    type: "state", id,
    sessionId,
    isStreaming: busy,
    isCompacting: false,
    messageCount: harness.messages.length,
    pendingMessageCount: 0,
  });
};
```

  busy 时也能调（只读不打断 turn，spec §4.2 L152）。
- **修 handleResume bug**（L69-78）：更新 server `sessionId = sid`（当前未更新）；messageCount 无需手动设（resume 重建 harness 后 `harness.messages.length` 自动 = initialMessages 数）
- `ws.on("message")` dispatch 加 `else if (msg.method === "get_state") handleGetState(msg.id)`

### 3.4 `packages/web/src/client/reducer.ts`（state 分支）

- `ServerEvent` union 加：

```ts
| { type: "state"; id?: string; sessionId: string; isStreaming: boolean;
    isCompacting: boolean; messageCount: number; pendingMessageCount: number }
```

- `State` 加 `sessionId?: string` + `messageCount?: number`
- reducer `state` 分支：

```ts
case "state":
  return { ...state, sessionId: event.sessionId, busy: event.isStreaming, messageCount: event.messageCount };
```

  设基线；in-flight 的 agent_start/message_update 等事件随后覆盖 busy。

### 3.5 `packages/web/src/client/main.ts`（onopen + 渲染）

- onopen：总是 `send({method:"get_state", id:<seq>})` + `if (sessionId) send({method:"resume", sessionId})`（维持现状）
- onmessage：`state` 事件**只经 reducer** 设显示状态（`state.sessionId`/`messageCount`/`busy` 基线）；**main.ts 顶层 `sessionId` 变量仍只由 `resumed` 事件设**（P1 现状不变）。**显示用 sessionId（reducer）与 resume 控制用 sessionId（main.ts）分离**——避免 get_state 快照的 sessionId 在 resume 失败时"粘住"坏 sessionId（red-team Finding 1）：若 state 设 main.ts sessionId 且 resume 失败（session 文件缺失→server 发 error），client 已采纳的 sessionId 会在下次重连反复重试同一死 session。代价：首次连接侧栏显示 sessionId（reducer）但 main.ts 不记，重连不自动 resume（与 P1 现状一致，符合 A 方案"恢复维持现状"）
- render() 侧栏加 `messageCount` 显示

## 4. 数据流

### 4.1 首次连接（client 无 sessionId）

onopen → send get_state → server 回 `{type:"state", sessionId:<server的>, isStreaming:false, isCompacting:false, messageCount:0, pendingMessageCount:0}` → reducer 设 sessionId/busy=false/messageCount=0 + 侧栏显示。新起 server 空历史，`harness.messages.length=0` 一致。

### 4.2 重连（client 有 sessionId + 内存历史）

onopen → send get_state + resume → server 回 state 快照（当前 busy/sessionId/`harness.messages.length`）+ resumed（重建 harness、更新 server sessionId）→ 后续 in-flight 事件继续推给新 conn（subscribe 是 harness.onEvent 全局订阅，conn 更新后事件发新 conn）。

### 4.3 prompt 期间 get_state（spec §4.2 可随时调）

busy=true 时 client send get_state → server 回 `{isStreaming:true,...}`（只读，turn 不打断）→ client 显示"流式中"。

## 5. 错误处理

- get_state 只读同步，不抛错；parseClientMessage 的 get_state 无参数不校验失败；`id` 非字符串时忽略（undefined）
- **顺带修 handleResume 的 sessionId 未更新 bug**（get_state 依赖正确 sessionId）
- state 与 resumed 竞态：resume 重建期间 get_state 可能读到 resume 前状态——可接受（基线显示，resumed + 后续事件纠正）；onopen 并发发 get_state + resume，不强求顺序

## 6. 测试策略（TDD）

- **ws-protocol**：parseClientMessage 解析 `{method:"get_state"}` → `{ok:true, method:"get_state"}`；各命令带 id 透传（`{method:"get_state", id:"1"}` → id:"1"；prompt/abort/resume 带 id）；id 非字符串忽略
- **harness**：`harness.messages` getter 返回当前 transcript（透传 `_agent.state.messages`）；可顺带验证 prompt 后长度增长
- **server**（复用 `index.test.ts` mock 模式）：
  - handleGetState 返回 5 字段快照（isStreaming=busy、sessionId、isCompacting=false、messageCount=`harness.messages.length`、pendingMessageCount=0）
  - messageCount = transcript 长度：prompt 后 get_state 返回增长值
  - resume 后 get_state：sessionId 更新为新 sid、messageCount=initialMessages 数
  - get_state 带 id → state 事件带相同 id
  - get_state 只读：busy 期间调不打断 turn（busy 仍 true）
  - state 与 resumed 顺序：state 先到不破坏 resume 路径；**resume 失败（session 缺失）后 client 顶层 sessionId 不粘**（仍只由 resumed 设，red-team Finding 1 回归点）
- **reducer**：state 事件设**显示** sessionId/busy/messageCount（不动 main.ts resume 控制）；id 保留
- **Playwright 冒烟**（mock streamFn，无需 API key）：首次连接 get_state 拿基线 + 侧栏 messageCount；重连 get_state

## 7. 字段语义决策

| 字段 | agentforge 语义 | pi 对比 | 理由 |
|---|---|---|---|
| isStreaming | = server `busy` | AgentLoop isStreaming flag | turn 进行中；abort teardown 窗口可能短暂不一致（`finally` 设 busy=false 但 agent loop 仍 draining waitForIdle），可接受（基线显示） |
| sessionId | = 当前活跃 session（修 handleResume 更新） | SessionManager 委托 | get_state 依赖正确值 |
| isCompacting | 恒 `false` | AbortController 存在性（异步压缩） | harness 同步压缩无可观测窗口（§2.3） |
| messageCount | = `harness.messages.length`（transcript 数组长度） | `session.messages.length` | 与 pi 行为一致（两者 compaction 都替换 messages 数组，长度同步骤降），非计数器 |
| pendingMessageCount | 恒 `0` | 双队列长度和 | P1 无消息队列（§2.3）；client 须容忍未来 >0（向前兼容，未来加队列时） |

isCompacting/pendingMessageCount 退化是"协议帧位增量"的本质——字段对齐 pi 协议，值如实反映 agentforge 当前能力（无 AgentSession 层），为未来（异步压缩/消息队列）留位。

## 8. 关键决策记录

1. **新增 `{type:"state"}` 下行事件**（非 pi response wrapper、非绑 resumed）——P1 简化消息协议一致（spec §4.3 非 JSON-RPC）+ get_state 可独立于 resume 随时调（spec §4.2）
2. **id 一并落实**（parseClientMessage 解析所有命令可选 id + state response 带 id）——spec §13，get_state 是 P2 首个请求-响应用例，为 safety ask 铺路
3. **messageCount = transcript 数组长度**（pi 借鉴，非计数器）——给 harness 加 1 行 getter，简化 server（去掉计数器变量/subscribe 计数/resume 设值），resume 后自动正确
4. **isCompacting 恒 false / pendingMessageCount 恒 0**——agentforge 无 AgentSession 层（spec §3.2 YAGNI），如实退化，非偷懒
5. **handler 零计算透传**（pi 借鉴）——handleGetState 直接读状态 send
6. **顺带修 handleResume sessionId bug**——get_state 依赖正确 sessionId
7. **前端 onopen 总是发 get_state + 有 sessionId 则 resume**（维持现状恢复逻辑）——A 方案，智能恢复留后续

## 9. 不做（YAGNI）

- isCompacting 真实跟踪（需异步压缩编排，agentforge 同步压缩）
- pendingMessageCount 真实跟踪（需 steer/follow_up 消息队列子系统）
- get_state 驱动的智能重连恢复（client 对比 messageCount 检测历史缺失 → 决定 resume/等事件）——留后续
- pi response wrapper 形态（破坏 P1 简化协议一致性）
- safety ask 交互确认（P2 后续，本次仅落实 id 帧位）

## 10. 与 P1 spec 的关系

本 spec 是 P1 spec §13（🟡）+ §4.2 get_state/id 预留的落实。P1 spec §4.2 L141/148/152 描述的 get_state 行为在本 spec 实体化；§13 L279 的"get_state + id 预留"从"预留"变"落实"。不修改 P1 spec。
