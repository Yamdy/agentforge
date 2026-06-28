# agentforge Web UI — P1 MVP 设计

- 日期：2026-06-28（2026-06-29 红队修订）
- 状态：草案（待实现）
- 范围：P1 MVP（单会话流式对话 + 基础可观测）
- 关联：`docs/superpowers/specs/2026-06-23-slice3.5-rpc-design.md`（rpc 是 web server 的蓝本）
- 修订：见 §13，基于 red-team Oracle 对抗审查

## 1. 背景与动机

agentforge 当前交互形态是 CLI REPL（`packages/cli/src/repl.ts` + `print-mode.ts`），基于 pi-agent-core。本次优化交互要解决四类痛点：

1. **展示力不足**：REPL 里 markdown / 代码 / diff / 图表格式丢失或难看
2. **多任务并行操控**：只能单线程一条线，缺多会话 / 任务面板 / DAG 可视化
3. **可观测性**：看不到 token / cost、context 窗口占用、compaction 进度
4. **远程 / 多端访问**：只能本地终端

远程访问形态：**单人本地优先**（偶尔从手机 / 另一台电脑查看或接手），不做多账号 / 权限 / 会话隔离。

## 2. 方案选型

### 2.1 web vs TUI

| 维度 | web 主 + CLI 兜底 | 纯 TUI |
|---|---|---|
| 远程 / 多端 | ✅ | ❌（一票否决）|
| 流式 markdown / diff / 图表 | ✅ | ⚠️ TUI 老大难 |
| 多会话并行 / DAG 可视化 | ✅ | ⚠️ 多面板兼容坑 |
| 可观测图表 | ✅ | ⚠️ 受限 |
| 桥接成本 | 复用 events 总线，低 | 复用 print-mode，最低 |

**结论：web 主交互 + CLI 兜底**。远程 / 多端是硬需求，TUI 出局；其余三项 web 全胜。harness 已有 `EventBus`（`packages/harness/src/events.ts`）+ `harness.onEvent`（`packages/harness/src/harness.ts:243`，注释明写"供 RPC 等外部消费者用"），web 桥接成本低。CLI REPL 保留，给纯终端 / 脚本 / CI 兜底。

### 2.2 分阶段

- **P1 MVP**（本 spec）：`agentforge ui` 起 local server + WS 桥 events + 单会话流式对话 + 基础可观测
- **P2**：多会话并行面板 + RFC-DAG 可视化（react-flow）——届时引入 React + Vite
- **P3**：远程访问打磨（鉴权 token、移动端、断线重连）

## 3. 架构

### 3.1 包结构

新增 `packages/web`（pnpm workspace 包）：

```
packages/web/
  package.json          # @agentforge/web，依赖 @agentforge/harness @agentforge/shared @agentforge/cli；devDeps: ws, @types/ws, esbuild, marked
  tsconfig.json
  src/
    server/
      index.ts          # startUiServer(opts): 起 http+ws，构造 harness，静态服务 client 产物
      ws-protocol.ts    # 上行消息解析 + 下行序列化（复用/扩展 cli serializeEvent）
    client/
      index.html        # 单页：消息流 + 输入框 + 可观测侧栏
      main.ts           # WS 客户端 + reducer + 渲染（vanilla TS，无框架）
      style.css
```

`packages/cli/src/index.ts` 加 `ui` 子命令（与 `rfc-dag` / `loop` 并列，模式见 `index.ts:34`/`49`）：

```ts
const hasUiSubcommand = argv[0] === "ui";
if (hasUiSubcommand) {
  const { startUiServer } = await import("@agentforge/web");
  await startUiServer(argv.slice(1), { getApiKey: async (p) => getApiKeyFromEnv(p) });
  return;
}
```

### 3.2 复用点（几乎不碰现有代码）

- `buildHarness`（`packages/cli/src/repl.ts:94`）：rpc / repl 共用的 harness 构造器，web 直接复用
- `createJsonlSession` + `--resume` + `rebuildMessages`：会话持久化 / 恢复全复用
- `serializeEvent`（`packages/cli/src/rpc.ts:44`）：下行事件白名单序列化，web 扩展（保留 `message_update` + 补 `audit_finding`）
- 6 tools / `createSystemPromptWithSkills` / `createSafetyGuard` / `createCompactionConfig` / `createInstinctConfig`：全套复用

web server 是 rpc 的 WS 变体：rpc 把 `harness.onEvent` 事件经 `serializeEvent` 写 stdout JSONL；web 写 WS。`dispatch` 的 prompt 分支（`packages/cli/src/rpc.ts:172`）几乎可直接移植。

**不引入 pi 的 `AgentSession` 中间层**（YAGNI）：pi 在 harness 之上还有 `AgentSession`（`pi/packages/coding-agent/src/core/agent-session.ts:265`），把 `AgentEvent` 升级成 `AgentSessionEvent`（加 `queue_update`/`compaction_*`/`auto_retry_*`，给 `agent_end` 加 `willRetry`）并编排 steer/followUp/retry。agentforge 直接用自写 harness（`packages/harness`），无此层亦无 auto-retry，P1 不引入。借鉴其**设计**而非**代码**：① 事件 union 作传输契约（直接用 `HarnessEvent`）② 错误终态用 `message_end.stopReason`（§8）③ 协议预留 `id`（§4.2）。

## 4. 数据流（WS 协议）

### 4.1 下行（server → client）

复用 `serializeEvent` 白名单思路，但 web 版 `serializeWebEvent` 有两处与 rpc 不同：**保留 `message_update`**（rpc 注释 `rpc.ts:34` 明确排除逐 token "A 约束"，web 反其道需要它做流式）+ **补 `audit_finding`**（rpc `rpc.ts:94` 有，原 spec 漏）。

`serializeWebEvent` 白名单：

| 事件 | 转发字段 | 前端用途 |
|---|---|---|
| `agent_start` | type | 标记 turn 开始 |
| `message_update` | type, message | **流式整条替换**（转发内核累积态 `message`，见 §4.1.1/4.1.2）|
| `message_end` | type, message | 定稿一条消息 |
| `tool_execution_end` | type, toolCallId, toolName, args, isError | 工具调用展示 |
| `context_budget` | type, components, total, suggestions, headroom | 可观测侧栏 |
| `compaction` | type, summary, firstKeptEntryId | 压缩提示 |
| `compaction_error` | type, error | 错误提示 |
| `audit_finding` | type, severity, finding | 审计提示 |
| `agent_end` | type | turn 正常结束 |
| `error` | type, message | turn 异常结束（server 合成，见 §4.2）|

非白名单（`turn_*` / `message_start` / `tool_execution_start` / `instinct_observed` / `adr_recorded` / 未知）→ 跳过，同 rpc。

#### 4.1.1 `message_update` 真实形状与流式映射（红队 Finding 1 + pi 借鉴修正）

`message_update` 真实类型（`@earendil-works/pi-agent-core types.d.ts:374-376`）：

```ts
{ type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
```

**`message` 是内核维护的累积态整条**（核实 `pi/packages/agent/src/agent-loop.ts:332-338`）：内核每收到一个 `text_delta`/`thinking_delta`/`toolcall_delta` 等 stream chunk，就 `partialMessage = event.partial` 覆盖 `context.messages[last]`，再 emit `{type:"message_update", assistantMessageEvent: event, message: {...partialMessage}}`——**每次 emit 的 `message` 都是当前完整累积态的浅拷贝**，消费者无需自己拼片段。

`assistantMessageEvent` 是 13 变体 union（`pi-ai types.d.ts:271`），`.delta` 只在 `*_delta` 变体；但**前端不需要它**——`message` 已累积好。

**pi TUI 的实际消费**（核实 `pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts:2792-2795`）：

```ts
case "message_update":
  this.streamingMessage = event.message;        // 整条替换，不拼 delta
  this.streamingComponent.updateContent(this.streamingMessage);
```

**agentforge web 照搬 pi 方案**（替代原"narrow text_delta + 前端累积"）：server `serializeWebEvent` 对 `message_update` **转发 `{type, message}`（累积态整条），丢弃 `assistantMessageEvent`**（前端不需要原始 delta）。前端 reducer `streaming = event.message`（整条替换），rAF 合帧吸收高频刷新（§4.1.2）。

为何优于原 narrow 方案：① 前端不自己累积→不会漂移漏 delta；② 去掉易错的 union narrow（红队 Finding 1 就因 narrow 误读）；③ 内核已累积好直接用；④ markdown 整条替换比拼 partial delta 更稳。原方案为背压选 narrow，但本地 WS + 前端 rAF 合帧下背压非问题（pi TUI 每 delta 一渲全 message 都扛得住）。

#### 4.1.2 背压（红队 Finding 5 + pi 借鉴修正）

`message_update` 每 stream chunk 一次，快模型可能每秒数百次，每次带全 `message`（随生成增长到几 KB-十几 KB）。**pi rpc mode 不节流**（`rpc-mode.ts:354` `session.subscribe((event) => output(event))` 每个 event 直接输出），**pi TUI 也不节流**（每 delta 一渲全 message，靠差分渲染扛）。agentforge web 照此：**server 不批量**（无状态批量器，直接转发每个 `message_update`），**前端 rAF 合帧**——buffer 最新 `message`，rAF 回调里 flush 一次 `updateContent`，60fps 下至多 60 次渲染/s。本地 WS 带宽对几 KB/帧无压力。原 spec 的 server 端 16ms concat 批量器（Task 4）删除，合帧责任移到前端 reducer（Task 8）。

### 4.2 上行（client → server）

single-user，简化消息（借鉴 pi `RpcCommand` 但 P1 只取子集，不沿用 JSON-RPC 2.0 的 id 配对）：

```ts
{ method: "prompt", input: string }
{ method: "abort" }
{ method: "resume", sessionId: string }
{ method: "get_state" }
// 所有命令可选带 id?: string（为 P2 双向 RPC 预留，见下）
```

- `prompt`：调 `harness.prompt(input)`；期间 `onEvent` 推流式事件；正常完成推 `agent_end`，**异常（throw）推合成的 `{type:"error",message}`**（见 §8）
- `abort`：触发 `AbortController.abort()` → `harness.prompt` 内 `agent.abort()`（`harness.ts:327` 已支持 signal）
- `resume`：用 `createJsonlSession` 加载指定 session + `rebuildMessages` 重建 initialMessages，**重建 harness 并重挂 onEvent 订阅**
- `get_state`（pi 借鉴，`rpc-types.ts:91` `RpcSessionState`）：返回快照 `{isStreaming, isCompacting, sessionId, messageCount, pendingMessageCount}`。前端**连 WS / 重连后先 `get_state` 拿基线**，比单靠 sessionId resume 更稳（知道当前是否在流式、有几条 pending）

**id 预留（为 P2 双向 RPC）**：所有上行命令可选 `id`，server 对应 response 带 `id`。P2 的 safety ask 交互确认（§6）用此模式——server emit `{type:"safety_ask", id, ...}` → 前端弹窗 → 回传 `{method:"safety_response", id, allow}`（借鉴 pi `extension_ui_request/response`，`rpc-types.ts:213-258`）。P1 不实现交互确认，但协议帧位预留，避免后期改协议。

**resume 不变量（红队 Finding 6）**：`resume` 在 `busy`（turn 进行中）时**先 abort 当前 prompt 再重建**，不允许 busy 时裸重建（否则 in-flight 事件的 onEvent 订阅悬空、late event 无法关联）。`agent_end`/`error` 是 turn 终态，收到终态后 `busy=false` 才接受下一个 prompt/resume。`get_state` 可随时调（只读）。

### 4.3 与 rpc 的差异总结

| | rpc | web |
|---|---|---|
| 传输 | stdio JSONL | WebSocket |
| 协议 | JSON-RPC 2.0（id 配对） | 简化消息 |
| message_update | 排除 | **保留**（转发累积态 `message`，整条替换）|
| audit_finding | 白名单 | 白名单 |
| safety ask | 降级 deny | P1 降级 deny（P2 WS 交互）|
| verify | 支持 | P1 不支持 |
| error 信号 | JSON-RPC error | 合成 `{type:"error"}` |

## 5. 前端（vanilla TS，无框架）

### 5.1 选型理由（红队 Over-engineering 修正）

**P1 用 vanilla HTML + TS + marked，不引 React / Vite。** P1 实际只有 3 个组件 + 一个 ~5 行 reducer，vanilla 足够验证"web 体验比 REPL 爽"这一 P1 核心目标，且不提前背第二套构建链 / 第二个包 / 前端依赖树。原 §12 的 YAGNI 对 safety/verify 适用却对 React 用"P2 react-flow"提前辩护，是选择性 YAGNI——故修正。

**React + Vite + react-flow 推迟到 P2**（多会话并行 + DAG 可视化真正需要时）。P1 的 WS client / reducer 逻辑与框架无关，P2 切 React 时可直接复用，重写成本可控（P1 前端 ~250 行）。

markdown 渲染：`marked`（轻量）解析 `streaming` 字符串 → innerHTML；代码高亮 P1 不做（P2 加 highlight.js）。

### 5.2 组件（vanilla）

- `MessageStream`：`message_update` 整条替换 `streaming`（AssistantMessage）+ rAF 合帧渲染 markdown（marked）；`message_end` 定稿
- `Composer`：输入框 + 发送（`{method:"prompt"}`）+ 中止（`{method:"abort"}`，busy 时显示）
- `ObservabilitySidebar`：订阅 `context_budget` 显示 total / headroom / suggestions；显示 sessionId + token usage（见 §7）

### 5.3 状态（reducer，含 error/abort 终态——红队 Finding 4 修正）

```ts
type State = { messages: RenderedMessage[]; streaming?: AssistantMessage; budget?: BudgetInfo; busy: boolean; error?: string };
// agent_start        → busy = true; error = undefined
// message_update     → streaming = event.message（整条替换，内核累积态）；rAF 合帧渲染
// message_end        → messages.push(render(message)); streaming = undefined
//                      若 message.stopReason ∈ {aborted,error} → pendingTools 标 error + 清空
// agent_end          → busy = false（兜底：清 streaming + pendingTools，双保险防锁死）
// error              → busy = false; error = message（server 合成，兜底 harness.prompt throw）
// context_budget     → budget = ...
```

**`agent_end` 不保证在错误路径触发**（pi 仅正常 settle 才 emit）——故 `error` 是独立终态，reducer 必须有 `error → busy=false` 分支，否则出错后 `busy` 永真、Composer 锁死、需刷新（丢 streaming buffer）。

### 5.4 WS 客户端

`main.ts` 内：连接 → 收事件 dispatch reducer → 渲染；断线自动重连（指数退避）+ 重连后 `{method:"resume",sessionId}` 恢复。

## 6. safety ask

**P1 降级 deny**（同 print 模式 `packages/cli/src/print-mode.ts:180` 不传 `safetyAskHandler`）：safety.check 返回 "ask" 时自动拒（reason "safety:ask-no-handler"）。先验证对话 / 流式 / 可观测主线。

P2 再做 WS 交互确认：`safetyAskHandler` 桥接 WS——emit `{type:"safety_ask",...}` → 前端弹窗 → 回传 allow / deny。需处理双向异步 + 超时降级。

## 7. 可观测（红队 Finding 3：usage 已可显示，移出"待确认"）

- `context_budget` 事件 → 侧栏 total / headroom / suggestions（字段见 `packages/shared/src/index.ts` ContextBudgetEvent，~L89-113）
- **token usage 已可用**：`AssistantMessage.usage: Usage`（`@earendil-works/pi-ai types.d.ts:220`）含 `input` / `output` / `cacheRead` / `cacheWrite`，在 `message_end.message`（assistant）与 `agent_end` 的 messages 上。前端从 `message_end` 取 usage 累计显示。
- cost：按 provider 单价表把 usage 折算金额。P1 若单价表就绪则显示，否则只显示 token（cost 留 P2，见 §11）。

## 8. 错误处理（红队 Finding 4 强化）

- **错误/中止优先用内核天然信号**（pi 借鉴，核实 `interactive-mode.ts:2827-2864`）：`message_end` 事件带 `message.stopReason`，`"aborted"`/`"error"` 即终态信号。前端 reducer 在 `message_end` 时若 `stopReason ∈ {aborted,error}`，把所有 `pendingTools` 标 isError 并清空；`agent_end` 兜底再 clear 一次（双保险，防 `message_end` 未清干净锁死）。
- **server 合成 `{type:"error"}` 仅兜底** `harness.prompt` throw 但未走 `message_end` 的情况（如 timeout / harness 层异常），参照 `rpc.ts:191-195` catch+makeError。前端 reducer `error → busy=false`（§5.3）。
- abort：用户点中止 → `{method:"abort"}` → 内核 `message_end.stopReason="aborted"`（首选信号）；若 harness 层 throw 则走合成 error。abort 半成品已被 `harness.prompt` 过滤（`harness.ts:385`），不污染 session/resume。
- **`willRetry` 不引入 P1**：pi 的 `agent_end.willRetry` 是 `AgentSession` 层加的（`agent-session.ts:514`），agentforge 直接用 harness 无此层、亦无 auto-retry 编排，P1 N/A；未来加 retry 再补。
- server 端口占用：清晰报错 + 提示 `--port`
- WS 断线：前端自动重连 + `{method:"get_state"}`/`resume` 恢复基线

## 9. 测试策略

- `serializeWebEvent` 单测：断言**保留 `message_update`**（转发累积态 `message`，丢 `assistantMessageEvent`）+ **补 `audit_finding`**（与 rpc.serializeEvent 的两处关键差异回归点）
- 背压合帧单测：模拟高频 `message_update`，断言前端 rAF 合帧只渲一帧一次（server 不批量，直接转发）
- server：注入 mock `http` / `ws` + mock `streamFn`（复用 `rpc.test.ts` 模式），断言下行事件序列 + **error 路径合成 `{type:"error"}`**
- 上行 dispatch：`prompt` / `abort` / `resume` 各路径；**resume busy 不变量**（busy 时 resume 先 abort）
- 前端 reducer：纯函数单测——含 **error/abort 终态 → busy=false**（防 UI 锁死回归）+ message_update `streaming = message`（整条替换）+ `message_end.stopReason` 终态分支
- 真对话冒烟：`agentforge ui` 起服务，浏览器发 prompt，验证流式渲染 + 出错不锁死

## 10. 关键决策记录

1. **web 而非 TUI**：远程 / 多端硬需求一票否决 TUI；events 总线让 web 桥接成本接近 TUI
2. **P1 vanilla 而非 React+Vite**（红队修正）：YAGNI，P1 组件少、reducer 简，vanilla 足够验证 web 体验；React+Vite+react-flow 推迟 P2。可逆：P2 切 React 时 WS/reducer 逻辑可复用
3. **P1 safety 降级 deny**：YAGNI，先验证主线；WS 交互确认留 P2
4. **简化 WS 协议而非 JSON-RPC**：single-user 单会话无需 id 配对；用"busy 终态不变量"替代 id 关联（§4.2）
5. **保留 message_update + 转发累积态 message**（pi 借鉴修正）：流式所需；转发内核已累积的整条 `message`，前端整条替换 + rAF 合帧；优于原 narrow delta 方案（不漂移、去易错 narrow、对齐内核）
6. **reducer error/abort 终态**：`agent_end` 非错误路径保证，error 必须独立清 busy，防 UI 锁死
7. **resume busy 不变量**：busy 时 resume 先 abort，避免悬空订阅 / late event

## 11. 待确认项（spec → 实现阶段）

- `agentforge ui` 的 argv 解析：复用 `parseArgs` 还是独立（`--port` / `--host` / `--session` / `--resume` 是 web 特有 flag）
- client 产物打包：esbuild 把 `main.ts` 打成单 `bundle.js`，server 静态服务 `index.html` + `bundle.js`
- 背压实测：长生成（>2k output token）下 16ms 批量是否够，是否需更激进节流
- provider 单价表：cost 折算是否 P1 就做（影响 §7 显示金额）
- `text_delta` 等变体的精确字段名：实现时对照 `@earendil-works/pi-ai types.d.ts:271-323` 确认（`.delta` 确认在 `*_delta` 变体）

## 12. 不做（YAGNI）

- 多账号 / 权限 / 会话隔离（单人）
- 多会话并行面板（P2）
- RFC-DAG 可视化（P2）
- React + Vite + react-flow（P2）
- 远程鉴权 token / 移动端适配（P3）
- safety ask 交互确认（P2）
- verify 方法（P1 不暴露）
- thinking / toolcall delta 分轨展示（P2）

## 13. 红队修订记录（2026-06-29）

基于 red-team Oracle 对抗审查（独立 subagent 验证代码引用）修订：

- 🔴 Finding 1：`message_update` 形状误读 → §4.1.1 重写为真实 union + narrow `text_delta`；转发 `assistantMessageEvent` 而非全 `message`
- 🔴 Finding 2：引用缺包前缀 → 全文补 `packages/...` 前缀
- 🟡 Finding 3：usage "待确认"实际已可显示 → §7 移出待确认，P1 显示 token
- 🟡 Finding 4：error 路径 UI 锁死 → §5.3 reducer 加 error/abort 终态、§8 强化 error 合成
- 🟡 Finding 5：message_update 背压 → §4.1.2 定义 16ms 批量 + 转发轻量字段
- ⚪ Finding 6：resume 生命周期 → §4.2 加 busy 不变量
- ⚪ Finding 7：白名单漏 audit_finding → §4.1 补
- ⚪ Finding 8 + Over-engineering：React+Vite 对 P1 过重 → §5.1 改 vanilla，React 推迟 P2

## 14. pi 借鉴修订记录（2026-06-29）

调查 pi 项目（`C:\Users\90514\code\primo\pi`）的 TUI/rpc 实现后吸收（源码核实，非推断）：

- 🔴 message_update 方案改向：原"server narrow `text_delta` + 前端 `streaming += delta`"→ pi 方案"转发累积态 `message` + 前端整条替换 + rAF 合帧"。依据 `agent-loop.ts:332-338`（message 是累积态浅拷贝）+ `interactive-mode.ts:2792-2795`（TUI 整条替换）。影响 Task 3（serializeWebEvent 返工）+ Task 4（删 server 批量器，合帧移前端）+ Task 8（reducer streaming 改 AssistantMessage 整条）。
- 🟡 错误终态用 `message_end.stopReason` + `agent_end` 双保险（`interactive-mode.ts:2827-2864`），server 合成 error 降为兜底。
- 🟡 协议加 `get_state` 快照 + `id` 预留（`rpc-types.ts:91/213-258`），为 P2 safety ask 双向 RPC 留帧位。
- ⚪ `willRetry` 不引入 P1（pi `AgentSession` 层特性，`agent-session.ts:514`；agentforge 无此层无 retry）。
- ⚪ 不引入 `AgentSession` 中间层（YAGNI），只借鉴其设计。
- 反例：pi TUI 散布式实例字段状态（`handleEvent` ~600 行 switch）不学，web 用集中 reducer。
