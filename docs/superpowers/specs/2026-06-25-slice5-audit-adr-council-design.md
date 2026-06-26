# Slice 5:Audit + ADR + council 设计

- **Date**: 2026-06-25
- **Slice**: 5(ARCH §8 Slice 5 诊断与决策)
- **Status**: Design(red-team Oracle 审后修订 v2,待 plan)
- **依据**: ARCH §4.9 Audit / §4.10 ADR / §6 council skill;compendium `agent-architecture-audit`(12 层失败模型,research/ecc-agent-architecture-compendium.md §1)
- **前置**: Slice 0-4-B 完成(323 测试绿);shared 已预留 `AuditFindingEvent`(severity critical/high/medium/low)+ `AdrRecordedEvent`
- **red-team**: Oracle 对抗审查完成,吸收 2 Blocking + 4 Important + 2 Advisory(见 §9)

---

## 1. 背景与动机

Slice 5 落地 compendium 三块:
- **Audit**(`agent-architecture-audit`):12 层失败模型诊断——检测 wrapper regression / memory contamination / tool discipline failure / hidden repair loops / rendering corruption,出 severity-ranked findings + code-first fix plan。
- **ADR**(`architecture-decision-records`):结构化架构决策记录,存 `docs/adr/`。agentforge 已有 ADR-0001(手动),本 slice 模块化 record helper。
- **council**(`council`):四声决策 skill——多视角审议复杂决策。

## 2. 范围

**纳入**:
- Audit 模块(`audit.ts`):Auditor 接口 + 12 层 checker 框架 + Finding 类型 + 挂载 harness(订阅 events,scan → emit `audit_finding`)
- **2 层实现**(red-team 修正:原 4 层中 tool-selection/memory-contamination 丢弃,见 §9):
  - `tool-execution`(层 7):检测 assistant message 含 toolCall 但无对应 `tool_execution_end` event(幻觉执行)→ critical
  - `answer-shaping`(层 9):检测 final response 格式损坏(空/截断/非预期结构)→ medium
- ADR 模块(`adr.ts`):record/list helper,写 `docs/adr/<NNNN>-<slug>.md`(red-team Advisory 7:drop `adr_recorded` emit,无 consumer)
- council skill(`<cwd>/.agentforge/skills/council/SKILL.md`):四声决策

**defer**(red-team Important 4:defer 层**不注册 stub**,createAuditor 报告 active layers,避免静默 false-healthy):
- Audit 其余 10 层(1 system prompt / 2 session history / 3 memory contamination / 4 distillation / 5 active recall / 6 tool selection / 8 tool interpretation / 10 platform rendering / 11 hidden repair loops / 12 persistence):不注册,留 TODO 注释 + 后续扩
- Audit 强制门禁:诊断性 emit,不阻塞(与 ContextBudget 一致)
- council subagent spawn:本 slice 单 LLM 多视角,subagent 留优化

## 3. 核心决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | Audit = 订阅 events + 每 prompt 后 scan,emit `audit_finding`(诊断性,不阻塞) | red-team Important 5:scan trigger 明确(每 prompt 后,非"每 N turn 或");与 ContextBudget 一致 |
| D2 | 12 层框架 + **2 层实现** + 10 层不注册 | red-team Blocking 1+2:tool-selection(无 required registry)/ memory-contamination(instinct 已隔离 by construction)丢弃;tool-execution + answer-shaping 可检测;不注册 defer 层避免静默 false-healthy(red-team Important 4) |
| D3 | Finding 结构遵循 compendium report schema | compendium 一等公民;severity 与 shared AuditFindingEvent 一致 |
| D4 | ADR = 文件型 `docs/adr/<NNNN>-<slug>.md`,record/list helper,**drop `adr_recorded` emit** | red-team Advisory 7:无 consumer 的 event 是 theater;ADR 是文件 helper,record 返路径即可 |
| D5 | council = skill,单 LLM 多视角 prompt,4 角色独立段落强制 framing | red-team Important 6:4 角色独立段落防 voice collapse;compendium council 一致;subagent spawn 留优化 |
| D6 | Audit 挂 harness(`HarnessOptions.auditor?` + subscribe),ADR 独立 helper,council skill 文件 | Audit 事件驱动挂 harness;ADR/council 独立 |

## 4. 组件设计

### 4.1 Audit 模块(`packages/harness/src/audit.ts`)

```ts
export interface Finding {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  mechanism: string;
  sourceLayer: string;        // "tool-execution" / "answer-shaping"
  rootCause: string;
  evidenceRefs: string[];     // event 引用(toolCallId / message index)
  confidence: number;         // 0-1
  recommendedFix: string;
}

export interface Auditor {
  scan(state: AgentState, events: HarnessEvent[]): Finding[];
  subscribe(events: EventBus): void;   // 订阅 events,累积,每 prompt 后 scan,emit audit_finding
  readonly activeLayers: string[];      // red-team Important 4:报告已注册层
}

export function createAuditor(opts?: { layers?: string[] }): Auditor;
```

**2 层 checker 实现**:
- `tool-execution`(层 7):扫描 state.messages 中 assistant message 的 toolCall blocks,对每个 toolCall.id 检查 events 是否有同 toolCallId 的 `tool_execution_end`。无 → critical finding(幻觉执行)。**red-team Important 3 修正**:排除 aborted turn(state.messages 已滤 stopReason==="aborted",harness.ts:357)+ 排除 in-flight(pendingToolCalls 非空的 toolCall)。即只检测"assistant 已完成 turn(无 pendingToolCalls)但 toolCall 无 execution event"——这是真幻觉执行。
- `answer-shaping`(层 9):检测 final assistant response(无 toolCall 的最后 assistant message)空/截断/非预期结构。空 → medium finding。

**defer 层不注册**:`createAuditor` 默认注册 2 层。10 层 defer 不注册(无 stub 返 [])。`activeLayers` 报告 `["tool-execution", "answer-shaping"]`,消费者知只 2 层 active。

**挂载**:harness 构造时 `auditor?.subscribe(events)`。subscribe 内:累积 events(环形 buffer cap 1000,溢出时 emit 一次 `audit_finding {severity:"low", sourceLayer:"audit-buffer", title:"event buffer overflow, oldest events dropped"}`,red-team Important 5)+ harness.prompt 后调 `scan(state, events)` → findings → emit `audit_finding`(per finding)。

### 4.2 ADR 模块(`packages/harness/src/adr.ts`)

```ts
export interface AdrRecord {
  id: string;          // NNNN
  title: string;
  context: string;
  decision: string;
  alternatives: string[];
  consequences: string;
}

export function recordAdr(record: AdrRecord, opts?: { dir?: string }): string;  // 写 docs/adr/<id>-<slug>.md,返路径(无 emit)
export function listAdrs(opts?: { dir?: string }): AdrRecord[];
```

写 `docs/adr/<NNNN>-<slug>.md`(markdown 模板)。slug 从 title 派生(kebab-case)。无 emit(red-team Advisory 7)。

### 4.3 council skill(`<cwd>/.agentforge/skills/council/SKILL.md`)

```markdown
---
name: council
description: 四声决策——architect/skeptic/user-advocate/operator 四视角审议复杂决策
---
# Council
对复杂决策,从四视角**各独立一段**审视(red-team Important 6:独立段落防 voice collapse):
## architect
架构稳定性/扩展性/边界...
## skeptic
风险/失败模式/反例...
## user-advocate
用户体验/价值...
## operator
运维/成本/可观测...
## 综合
四视角意见 + 综合建议。
```

Skills 模块(Slice 1)发现 + 注入 `<available_skills>`。LLM 按需 invoke。

### 4.4 harness 集成

`HarnessOptions` 加 `auditor?: Auditor`。构造时 `auditor?.subscribe(events)`。`prompt()` 末尾(appendNewMessages 后)调 `auditor?.scan(this._agent.state, recentEvents)` → emit findings。ADR/council 不挂 harness(独立)。

### 4.5 shared 类型:已预留

`AuditFindingEvent`(`{ type:"audit_finding"; severity; finding }`)已 in union。Audit emit `audit_finding`(finding = Finding 序列化)。`AdrRecordedEvent` 保留(shared 不删),但 ADR 模块不 emit(red-team Advisory 7)。

## 5. 测试策略(TDD)

- **audit.test.ts**:
  - tool-execution:构造 state(assistant toolCall,无对应 execution event)→ critical finding;aborted turn toolCall 不报;in-flight(pendingToolCalls)不报
  - answer-shaping:final assistant message 空 → medium finding
  - scan 聚合 2 层;activeLayers = ["tool-execution","answer-shaping"];buffer 溢出 emit low finding
  - subscribe emit audit_finding
- **adr.test.ts**:recordAdr 写文件 + 返路径 + slug 生成;listAdrs 读;无 emit
- **harness.test.ts**:auditor 注入 → prompt 后 scan → emit audit_finding
- **回归**:323 → +N

## 6. 陷阱

- vitest development condition vs tsc dist:改 harness/shared 后 rebuild dist
- GateGuard 拦新文件/编辑,陈述 4 事实
- Audit findings emit 频率:每 scan 多 finding → 多 audit_finding 事件,rpc serializeEvent 加 audit_finding case
- council skill 文件放 `<cwd>/.agentforge/skills/`(项目级,随 repo)
- tool-execution checker:pi AgentState.messages 含 ToolCall block(types.d.ts:30),pendingToolCalls 排除 in-flight(types.d.ts:278-300)

## 7. red-team 审查接入点(已审,见 §9)

- ~~12 层只 4 层~~ → 2 层(丢弃 2 non-functional)
- ~~defer stub 返 []~~ → 不注册 + activeLayers 报告
- ~~scan trigger 模糊~~ → 每 prompt 后
- ~~ADR emit 无 consumer~~ → drop emit
- ~~council voice collapse~~ → 4 角色独立段落

## 8. red-team Oracle 变更记录(v1 → v2)

| red-team finding | 级别 | v2 处理 |
|---|---|---|
| tool-selection checker 无 required-tools registry,无法工作 | 🔴 Blocking | 丢弃 tool-selection 层 |
| memory-contamination 审计非风险(instinct 已 projectHash 隔离 by construction) | 🔴 Blocking | 丢弃 memory-contamination 层 |
| tool-execution 可能 tautology(pi 保证 execution)或 false positive(aborted/in-flight) | 🟡 Important | 保留,排除 aborted turn + in-flight(pendingToolCalls),只检测真幻觉执行 |
| 8 defer stub 静默返 [] = false healthy | 🟡 Important | defer 层不注册,activeLayers 报告 active 层 |
| scan trigger 模糊 + buffer 溢出无信号 | 🟡 Important | scan 每 prompt 后;buffer 溢出 emit low finding |
| council 4-voice 单 LLM voice collapse | 🟡 Important | 4 角色独立段落强制 framing |
| ADR adr_recorded event 无 consumer(theater) | ⚪ Advisory | drop emit,recordAdr 只写文件返路径 |
| 3 独立组件绑一个 slice | ⚪ Advisory | 保留一个 slice(ARCH §8),实现分独立 task(Audit/ADR/council) |
