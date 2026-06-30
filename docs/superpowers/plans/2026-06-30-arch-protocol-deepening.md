# Plan: 协议层架构深化(A+B+C+H)

- **Date**: 2026-06-30
- **Branch**: pi
- **Spec**: `architecture-review-20260630-144633.html`(temp)+ `CONTEXT.md`(领域词汇)
- **Skill**: `/improve-codebase-architecture` grilling 定型
- **范围**: A(discriminant 窄化)+ B(web/rpc 共享序列化核心)+ C(ServerEvent 从 shared 派生)+ H(删 web 合成 start/end)+ G 部分(ServerControlEvent 分离)

## 背景

`/improve-codebase-architecture` 侦察 + grilling 定型:Card A/B/C 是同源集群 —— 序列化器绕开 `HarnessEvent` discriminant(手写 `as` 重断言)→ 无法共享 narrowing → web/rpc 两份手写 9-case switch(#B)+ reducer 手写平行 `ServerEvent` union(#C,已静默漂移 `firstKeptEntryId`)。H(agent_start/end 双发)渗透进 C 的 union(start/end 既是 forwarded 又 synthesized)。详见 temp HTML 报告与 `CONTEXT.md`。

## 决策(grilling 结晶)

| 决策 | 选择 |
|---|---|
| 共享核心层 | shared 包(已有 `serializeEntry` 运行时先例,web/rpc 共同叶子依赖) |
| start/end 双发 | 删 `handlePrompt` 合成,靠 harness 转发 |
| rpc 本地 serializeEvent | 删(grep 确认无外部消费),用 shared |
| wire 类型 | 单一 `SerializedEvent` union + `ServerEvent = SerializedEvent \| ServerControlEvent` |

## 依赖顺序

shared(被依赖)→ web → cli。先建 `shared.serializeEvent`,再 web/cli 接线。web/cli 均已依赖 shared(`import type { HarnessEvent }`),加 value import 无新依赖。

## Task 分解(每 Task TDD:测试先行)

### Task 1: shared `serializeEvent` + `SerializedEvent`(核心)

**测试**(从 `rpc.test.ts` 白名单迁移 + opts 差异):
- 9 case 白名单返回正确字段:`agent_start`/`agent_end`(只 type)、`message_update`、`message_end`、`tool_execution_end`、`context_budget`、`compaction`、`compaction_error`、`audit_finding`
- `opts.includeMessageUpdate=false`(默认)→ `message_update` 返回 undefined;`true` → 返回 `{type, message}`
- `opts.includeToolArgs=false`(默认)→ `tool_execution_end` 无 `args`;`true` → 带 `args`
- 非白名单(`turn_*`/`message_start`/`tool_execution_start`/`update`/`instinct_observed`/`adr_recorded`)→ undefined
- discriminant 窄化:零 `as`,字段直接 `event.xxx`(编译期类型安全)

**实现**(`packages/shared/src/index.ts`):
- `export function serializeEvent(event: HarnessEvent, opts?: {includeMessageUpdate?:boolean; includeToolArgs?:boolean}): SerializedEvent | undefined`
- `switch(event.type)` 窄化,7 个相同 case 直接返回窄化字段;`message_update`/`tool_execution_end` 按 opts
- `export type SerializedEvent =` 所有可能返回对象形状的 union

**风险**:无(纯新增)。

### Task 2: shared 契约测(锁 Card C 漂移)

**测试**:
- 遍历 `HarnessCustomEvent` 每个成员,断言 `serializeEvent(member, web opts)` 返回符合 `SerializedEvent`
- 断言非白名单成员 → undefined
- 断言 `compaction` 输出含 `firstKeptEntryId`(锁漂移点)

**实现**:`packages/shared/src/index.test.ts` 加契约测。

**风险**:无。

### Task 3: web `ws-protocol` 接 shared

**测试**:`ws-protocol.test.ts` 现有 5 case 仍绿(行为不变)。

**实现**(`packages/web/src/server/ws-protocol.ts`):
- `serializeWebEvent(e)` → `serializeEvent(e, {includeMessageUpdate:true, includeToolArgs:true})`(薄包装,保留文件因含 `parseClientMessage`)
- 删原手写 switch + 全部 `as`

**风险**:web 已 `import type { HarnessEvent } from "@agentforge/shared"`(ws-protocol.ts:1),加 value import 无新依赖。

### Task 4: web server 删合成 start/end

**前置验证**(先测):harness 经 `subscribe` 必发 `agent_start`/`agent_end`(pi Agent 契约)。加测试:mock harness prompt 流程,断定转发 agent_start/end 到 wire。

**测试**:
- `server/index.test.ts`:`handlePrompt` 不再合成 `agent_start`/`agent_end`,仅靠 harness 转发
- reducer 的"双 agent_end 幂等"防御用例(`reducer.test.ts:220-229`)删除或改为单发(因不再双发)

**实现**(`packages/web/src/server/index.ts`):
- 删 `handlePrompt` 的 `send({type:"agent_start"})`(L56)和 `send({type:"agent_end"})`(L60)
- `error` 合成保留(catch 分支清 busy 兜底)

**风险**:若 harness 漏发 `agent_end`,client busy 卡死 —— 前置验证测试覆盖。`error` 仍清 busy 作兜底。

### Task 5: web reducer `ServerEvent` 派生

**测试**:`reducer.test.ts` 现有 20+ case 仍绿(行为不变)。

**实现**(`packages/web/src/client/reducer.ts`):
- `import type { SerializedEvent } from "@agentforge/shared"`
- `ServerControlEvent = {type:"state";...} | {type:"resumed";...} | {type:"error";...}`
- `ServerEvent = SerializedEvent | ServerControlEvent`(删手写 forwarded 部分)
- `compaction` case:类型现含 `firstKeptEntryId`,reducer 可忽略不读(类型一致即消除漂移)

**风险**:无(类型重述,行为不变)。

### Task 6: cli rpc 删本地 serializeEvent

**测试**:`rpc.test.ts` 的 `serializeEvent` 白名单 describe 块删除(已迁移 Task 1);保留 `dispatch` 集成测试。

**实现**(`packages/cli/src/rpc.ts`):
- 删 `serializeEvent`(L44-105)
- `dispatch`(L179)调 `serializeEvent(e, {includeMessageUpdate:false, includeToolArgs:false})` from shared
- `import { serializeEvent } from "@agentforge/shared"`

**风险**:cli 已 `import type { HarnessEvent } from "@agentforge/shared"`(rpc.ts:17),加 value import 无新依赖。

### Task 7: 全量验证 + 冒烟核实

- `pnpm -r typecheck`(5 包绿)
- `pnpm -r build`(web bundle + harness dist rebuild)
- `pnpm -r test`(621 基线 + shared 新增 + 删 rpc serializeEvent 测试,净增)
- `pending-mock-server.mjs` 冒烟核实:若事件序列含合成 start/end,改为模拟 harness 转发
- Playwright 冒烟重跑(pending⏳→done✓/error⚠ 全链路绿)

## 验收

- 5 包 typecheck + build + test 全绿
- `serializeEvent` 零 `as`(discriminant 窄化)
- `ServerEvent` 从 shared 派生,`firstKeptEntryId` 漂移消失(契约测锁定)
- web 不再合成 `agent_start`/`agent_end`
- Playwright 冒烟绿

## 不在本轮(留下一轮)

- **D**(serializeWebEvent shallow 透传收口):随 Task 3 落地大部分自然消失
- **E**(parseClientMessage ↔ dispatch exhaustive):独立小重构
- **F**(reducer 单一入口,resumed/乐观 busy 收口):依赖本轮 union 形态
- **I**(契约测):Task 2 已覆盖核心,冒烟 mock 复用留后续
