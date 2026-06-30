# CONTEXT — agentforge 领域词汇

协议层(事件流)概念,供架构讨论与代码命名统一。架构词汇见 `.claude/skills/improve-codebase-architecture/LANGUAGE.md`(Module / Interface / Depth / Seam / Adapter / Leverage / Locality / Deletion test)。本文档由 `/improve-codebase-architecture` grilling(2026-06-30)沉淀,后续 grilling 中 sharpen 术语时就地更新。

## 事件层(harness 产出)

- **HarnessEvent** — harness 事件总线的事件联合类型 = pi `AgentEvent` | harness 自定义事件(`compaction`/`compaction_error`/`instinct_observed`/`audit_finding`/`adr_recorded`/`context_budget`/`tool_execution_end`)。定义于 `packages/shared/src/index.ts`。是 discriminated union,每个成员有 `type` 字面量。
- **forwarded event(转发事件)** — harness 产出、经 `subscribe` 转发上 wire 的事件(`agent_start`/`message_*`/`tool_execution_end`/`compaction` 等)。来源是 harness。
- **synthesized event(合成事件)** — server 自身生成、非 harness 产出的控制事件(`state`/`resumed`/`error`)。来源是 server。
- 区分 forwarded vs synthesized 是为了让 reducer 对每类处理意图显式,而非靠 `default` 静默吸收合成 no-op。

## wire 层(序列化后)

- **SerializedEvent** — `HarnessEvent` 经 `serializeEvent` 序列化后上 wire 的普通对象形态。定义于 shared,是 wire 形状的**单一来源**(消除 web/rpc/reducer 三处手写平行)。
- **ServerControlEvent** — server 合成控制事件的联合 = `state` | `resumed` | `error`。
- **ServerEvent** — client reducer 消费的 wire 事件联合 = `SerializedEvent | ServerControlEvent`。web 专用(rpc 不消费)。从 shared 派生,非手写。
- **serializeEvent** — shared 中的事件→wire 映射核心函数,web/rpc 共享。`opts` 控制两 adapter 巠异:`includeMessageUpdate`(web 转发 `message_update` / rpc 丢)、`includeToolArgs`(web 带 `args` / rpc 丢)。用 `switch(event.type)` discriminant 窄化,零 `as` 重断言。

## 相关约束

- `agent_start`/`agent_end` 只从 harness 转发,server 不再合成(web `handlePrompt` 曾合成致双发,已删)。reducer 不再为该双发幂等防御。
- rpc 纯转发不合成任何事件;web 删合成后与 rpc 行为对齐。
