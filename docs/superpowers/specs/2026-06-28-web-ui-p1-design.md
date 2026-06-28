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

## 4. 数据流（WS 协议）

### 4.1 下行（server → client）

复用 `serializeEvent` 白名单思路，但 web 版 `serializeWebEvent` 有两处与 rpc 不同：**保留 `message_update`**（rpc 注释 `rpc.ts:34` 明确排除逐 token "A 约束"，web 反其道需要它做流式）+ **补 `audit_finding`**（rpc `rpc.ts:94` 有，原 spec 漏）。

`serializeWebEvent` 白名单：

| 事件 | 转发字段 | 前端用途 |
|---|---|---|
| `agent_start` | type | 标记 turn 开始 |
| `message_update` | type, delta | **流式拼接**（server 端 narrow `text_delta` + 批量 concat，见 §4.1.1/4.1.2）|
| `message_end` | type, message | 定稿一条消息 |
| `tool_execution_end` | type, toolCallId, toolName, args, isError | 工具调用展示 |
| `context_budget` | type, components, total, suggestions, headroom | 可观测侧栏 |
| `compaction` | type, summary, firstKeptEntryId | 压缩提示 |
| `compaction_error` | type, error | 错误提示 |
| `audit_finding` | type, severity, finding | 审计提示 |
| `agent_end` | type | turn 正常结束 |
| `error` | type, message | turn 异常结束（server 合成，见 §4.2）|

非白名单（`turn_*` / `message_start` / `tool_execution_start` / `instinct_observed` / `adr_recorded` / 未知）→ 跳过，同 rpc。

#### 4.1.1 `message_update` 真实形状与流式映射（红队 Finding 1 修正）

`message_update` 真实类型（`@earendil-works/pi-agent-core types.d.ts:374-376`）：

```ts
{ type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
```

`assistantMessageEvent` 是 **13 变体 discriminated union**（`@earendil-works/pi-ai types.d.ts:271`），`.delta: string` **只存在于** `text_delta` / `thinking_delta` / `toolcall_delta` 变体，其余变体（`start` / `*_start` / `*_end` / `done` / `error`）无 `.delta`。

**server 端 narrow + 批量**（不转发全 `message`——大且随生成增长；不转发原始 union——前端处理 union 易错）：server 在 `serializeWebEvent` / 批量层 **narrow `assistantMessageEvent.type === "text_delta"`** 取 `.delta`，16ms 内 concat 聚合，发 `{type:"message_update", delta:"<concat>"}`。前端 reducer 直接 `streaming += e.delta`，无需 narrow（P1 忽略 thinking_delta / toolcall_delta，P2 再分轨）。

不能 `streaming += assistantMessageEvent.delta`（union 未 narrow 会类型错误，且混三轨污染渲染）——故 narrow 责任在 server 端。

#### 4.1.2 背压（红队 Finding 5）

`message_update` 每 SSE chunk 一次，快模型可能每秒数百次。已通过"转发 `assistantMessageEvent`（小）而非全 `message`（大且增长）"大幅降压。P1 额外措施：server 端 **16ms（一帧）批量合并**同 turn 的 `message_update`——累积 delta 到一帧末再发一条聚合 `{type:"message_update", delta:"<concat>"}`。P1 先实现简单批量；实测阈值（长生成 >2k token 场景）后定是否需更激进节流。

### 4.2 上行（client → server）

single-user，简化消息（不沿用 JSON-RPC 2.0 的 id 配对）：

```ts
{ method: "prompt", input: string }
{ method: "abort" }
{ method: "resume", sessionId: string }
```

- `prompt`：调 `harness.prompt(input)`；期间 `onEvent` 推流式事件；正常完成推 `agent_end`，**异常（throw）推合成的 `{type:"error",message}`**（见 §8）
- `abort`：触发 `AbortController.abort()` → `harness.prompt` 内 `agent.abort()`（`harness.ts:327` 已支持 signal）
- `resume`：用 `createJsonlSession` 加载指定 session + `rebuildMessages` 重建 initialMessages，**重建 harness 并重挂 onEvent 订阅**

**resume 不变量（红队 Finding 6）**：`resume` 在 `busy`（turn 进行中）时**先 abort 当前 prompt 再重建**，不允许 busy 时裸重建（否则 in-flight 事件的 onEvent 订阅悬空、late event 无法关联——简化协议无 request id）。`agent_end`/`error` 是 turn 终态，收到终态后 `busy=false` 才接受下一个 prompt/resume。

### 4.3 与 rpc 的差异总结

| | rpc | web |
|---|---|---|
| 传输 | stdio JSONL | WebSocket |
| 协议 | JSON-RPC 2.0（id 配对） | 简化消息 |
| message_update | 排除 | **保留**（转发 assistantMessageEvent，流式）|
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

- `MessageStream`：累积 `text_delta` 流式渲染 markdown（marked）；`message_end` 定稿
- `Composer`：输入框 + 发送（`{method:"prompt"}`）+ 中止（`{method:"abort"}`，busy 时显示）
- `ObservabilitySidebar`：订阅 `context_budget` 显示 total / headroom / suggestions；显示 sessionId + token usage（见 §7）

### 5.3 状态（reducer，含 error/abort 终态——红队 Finding 4 修正）

```ts
type State = { messages: RenderedMessage[]; streaming: string; budget?: BudgetInfo; busy: boolean; error?: string };
// agent_start        → busy = true; error = undefined
// message_update     → streaming += delta   // server 已 narrow text_delta + 批量 concat
// message_end        → messages.push(...); streaming = ""
// agent_end          → busy = false          // 正常终态
// error              → busy = false; error = message   // 异常终态（必须清 busy，否则 UI 锁死）
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

- `harness.prompt` 抛错（abort / timeout / LLM）：server **catch 并合成推 `{type:"error",message}`**（参照 `rpc.ts:191-195` 的 catch+makeError 模式，而非依赖 `agent_end`）；前端 reducer `error → busy=false`（§5.3），UI 不锁死
- abort：用户点中止 → `{method:"abort"}` → `harness.prompt` throw "aborted" → 走 error 路径但 message 标识为 aborted；abort 半成品消息已被 `harness.prompt` 过滤（`harness.ts:385`），不污染 session / resume
- server 端口占用：清晰报错 + 提示 `--port`
- WS 断线：前端自动重连 + resume

## 9. 测试策略

- `serializeWebEvent` 单测：断言**保留 `message_update`**（转发 `assistantMessageEvent`）+ **补 `audit_finding`**（与 rpc.serializeEvent 的两处关键差异回归点）
- 背压批量单测：模拟高频 `message_update`，断言 server 端 narrow `text_delta` + 16ms 内合并为一条聚合 `{delta}`
- server：注入 mock `http` / `ws` + mock `streamFn`（复用 `rpc.test.ts` 模式），断言下行事件序列 + **error 路径合成 `{type:"error"}`**
- 上行 dispatch：`prompt` / `abort` / `resume` 各路径；**resume busy 不变量**（busy 时 resume 先 abort）
- 前端 reducer：纯函数单测——含 **error/abort 终态 → busy=false**（防 UI 锁死回归）+ message_update `streaming += delta`（聚合形态）
- 真对话冒烟：`agentforge ui` 起服务，浏览器发 prompt，验证流式渲染 + 出错不锁死

## 10. 关键决策记录

1. **web 而非 TUI**：远程 / 多端硬需求一票否决 TUI；events 总线让 web 桥接成本接近 TUI
2. **P1 vanilla 而非 React+Vite**（红队修正）：YAGNI，P1 组件少、reducer 简，vanilla 足够验证 web 体验；React+Vite+react-flow 推迟 P2。可逆：P2 切 React 时 WS/reducer 逻辑可复用
3. **P1 safety 降级 deny**：YAGNI，先验证主线；WS 交互确认留 P2
4. **简化 WS 协议而非 JSON-RPC**：single-user 单会话无需 id 配对；用"busy 终态不变量"替代 id 关联（§4.2）
5. **保留 message_update + 转发 assistantMessageEvent**：流式所需；转发轻量 union 事件而非全 message，兼顾背压
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
