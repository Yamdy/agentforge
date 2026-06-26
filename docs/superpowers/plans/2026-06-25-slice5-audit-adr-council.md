# Slice 5(Audit + ADR + council)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 建 Audit 模块(12 层框架 + 2 层实现:tool-execution/answer-shaping)+ ADR 模块(record/list helper)+ council skill。

**Architecture:** Audit 订阅 EventBus + 每 prompt 后 scan,emit `audit_finding`(诊断性);2 层 checker 实现,10 层不注册(activeLayers 报告);ADR 文件型 helper(无 emit);council skill 文件。spec: `docs/superpowers/specs/2026-06-25-slice5-audit-adr-council-design.md`(v2,red-team 全吸收)。

**Tech Stack:** TypeScript / pnpm monorepo / vitest / `@earendil-works/pi-agent-core`(AgentState/AgentMessage/AgentTool)/ node:fs。

## Global Constraints

- pi 分支无 remote:commit 留本地不 push,message 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`
- TDD 铁律:RED → GREEN → commit
- 改 harness/shared 后须 `pnpm --filter @agentforge/harness build` rebuild dist
- GateGuard 拦新文件/编辑/首次 bash,陈述 4 事实放行
- `AgentState.messages` 含 assistant message(ToolCall block 在 content 数组,pi types.d.ts:30);`pendingToolCalls` 排除 in-flight(types.d.ts:278-300);aborted turn messages 已滤(harness.ts:357)
- shared `AuditFindingEvent`(`{type:"audit_finding";severity;finding}`)已预留;`AdrRecordedEvent` 保留但不 emit

---

## Task 1: audit.ts 类型 + Auditor 接口 + createAuditor 骨架

**Files:** Create `packages/harness/src/audit.ts`, `audit.test.ts`; Modify `packages/harness/src/index.ts`(export)

**Interfaces:**
- Produces: `Finding` / `Auditor` 接口 + `createAuditor(opts?:{layers?})` 骨架(activeLayers 返注册层;scan/subscribe stub T2/T4 填)

- [ ] Step 1: 写失败测试 — `createAuditor()` 返对象有 `scan`/`subscribe`/`activeLayers`;默认 `activeLayers === ["tool-execution","answer-shaping"]`
- [ ] Step 2: 验 RED
- [ ] Step 3: 写实现 — Finding/Auditor 接口 + createAuditor(默认注册 2 层,scan/subscribe stub)+ activeLayers getter
- [ ] Step 4: 验 GREEN + build
- [ ] Step 5: Commit

## Task 2: tool-execution checker(层 7)

**Files:** Modify `audit.ts`, `audit.test.ts`

**Interfaces:** Consumes `AgentState.messages`(assistant ToolCall blocks)+ events(`tool_execution_end` toolCallId);Produces finding severity critical

- [ ] Step 1: 写失败测试 — 构造 state(assistant message 含 ToolCall id="t1",无 pendingToolCalls)+ events(无 t1 的 tool_execution_end)→ scan 返 critical finding(sourceLayer "tool-execution")。aborted turn(stopReason==="aborted" message)不报。pendingToolCalls 非空(toolCall in-flight)不报
- [ ] Step 2: 验 RED
- [ ] Step 3: 写实现 — checker 扫 messages 的 assistant ToolCall blocks,排除 aborted/pendingToolCalls,对每个 toolCall.id 检查 events 无同 toolCallId 的 tool_execution_end → critical finding(evidenceRefs=[toolCallId])
- [ ] Step 4: 验 GREEN + build
- [ ] Step 5: Commit

## Task 3: answer-shaping checker(层 9)

**Files:** Modify `audit.ts`, `audit.test.ts`

- [ ] Step 1: 写失败测试 — final assistant message(无 ToolCall 的最后 assistant message)content 空/纯空白 → medium finding(sourceLayer "answer-shaping")。非空不报
- [ ] Step 2: 验 RED
- [ ] Step 3: 写实现 — checker 取最后 assistant message(无 ToolCall),contentToString 空/空白 → medium finding
- [ ] Step 4: 验 GREEN + build
- [ ] Step 5: Commit

## Task 4: subscribe + 环形 buffer + scan trigger + emit audit_finding

**Files:** Modify `audit.ts`, `audit.test.ts`

**Interfaces:** Consumes `EventBus`;Produces subscribe(累积 events 环形 cap 1000 + 每 prompt 后 scan + emit audit_finding per finding)

- [ ] Step 1: 写失败测试 — subscribe(events)后 emit 若干 events → 内部 buffer 累积;scan 后 findings → events 收到 audit_finding(per finding,severity/finding 字段)。buffer 溢出(emit 1001 events)→ emit 1 个 low finding(sourceLayer "audit-buffer",title "event buffer overflow")
- [ ] Step 2: 验 RED
- [ ] Step 3: 写实现 — subscribe 累积 events(环形 cap 1000,溢出 emit low finding 一次)+ 暴露 scan(state)(harness prompt 后调)+ findings → events.emit({type:"audit_finding",severity,finding})
- [ ] Step 4: 验 GREEN + build
- [ ] Step 5: Commit

## Task 5: harness 集成(HarnessOptions.auditor + prompt 后 scan)

**Files:** Modify `packages/harness/src/harness.ts`, `harness.test.ts`

**Interfaces:** Consumes `Auditor`(T1-T4);Produces `HarnessOptions.auditor?` + 构造 subscribe + prompt 末尾 scan

- [ ] Step 1: 写失败测试 — 注入 auditor(mock scan 返 finding),prompt 后 events 收到 audit_finding;无 auditor 不报错
- [ ] Step 2: 验 RED
- [ ] Step 3: 写实现 — HarnessOptions 加 `auditor?:Auditor`;构造 `auditor?.subscribe(events)`;prompt 末尾(appendNewMessages 后)`auditor?.scan(this._agent.state, recentEvents)`(recentEvents 从 subscribe buffer 或 events 取)
- [ ] Step 4: 验 GREEN + build
- [ ] Step 5: Commit

## Task 6: adr.ts recordAdr/listAdrs

**Files:** Create `packages/harness/src/adr.ts`, `adr.test.ts`; Modify `index.ts`(export)

**Interfaces:** Produces `AdrRecord` + `recordAdr(record, opts?:{dir?}): string`(写 `docs/adr/<id>-<slug>.md`,返路径,无 emit)+ `listAdrs(opts?): AdrRecord[]`

- [ ] Step 1: 写失败测试 — recordAdr({id:"0002",title:"Test Decision",...}) 写 `docs/adr/0002-test-decision.md`(tmpdir),返路径;文件含 Context/Decision/Alternatives/Consequences 段;listAdrs 读回。无 emit
- [ ] Step 2: 验 RED
- [ ] Step 3: 写实现 — recordAdr(slug 从 title kebab-case,写 markdown 模板,返路径);listAdrs 读 dir/*.md 解析。IO 错 try/catch
- [ ] Step 4: 验 GREEN + build
- [ ] Step 5: Commit

## Task 7: council skill 文件

**Files:** Create `.agentforge/skills/council/SKILL.md`

- [ ] Step 1: 写 SKILL.md(frontmatter name/description + 四角色独立段落,见 spec §4.3)
- [ ] Step 2: 测试 — skills.test.ts 加:loadSkills 发 `<cwd>/.agentforge/skills/council` → council 在 daily/library 列表;formatSkillsForSystemPrompt 含 council
- [ ] Step 3: 验 GREEN + build
- [ ] Step 4: Commit

## Task 8: rpc serializeEvent audit_finding case

**Files:** Modify `packages/cli/src/rpc.ts`, `rpc.test.ts`

- [ ] Step 1: 写失败测试 — serializeEvent({type:"audit_finding",severity:"critical",finding:{...}}) 返 {type,severity,finding}
- [ ] Step 2: 验 RED
- [ ] Step 3: 写实现 — serializeEvent 加 `case "audit_finding"`(cast 读 severity/finding)
- [ ] Step 4: 验 GREEN + build
- [ ] Step 5: Commit

## Task 9: 全量回归

- [ ] Step 1: `pnpm --filter @agentforge/harness build && pnpm -r typecheck && pnpm -r test`
- [ ] Step 2: 预期 3 包 typecheck Done + 全测试 PASS(323 → +N audit/adr/harness/rpc 新测试)
- [ ] Step 3: 若 typecheck 报 union 歧义(audit_finding 字段),加 cast 修复
- [ ] Step 4: Commit(若修)

---

## Self-Review

**Spec coverage**:spec D1(scan emit)→ T4+T5;D2(2 层)→ T2+T3;D3(Finding schema)→ T1;D4(ADR drop emit)→ T6;D5(council 4 角色)→ T7;D6(挂载)→ T5。§4.1-§4.5 → T1-T8。§5 测试 → 各 task。全覆盖。

**Placeholder scan**:各 task TDD 步骤含关键断言(非完整代码,spec v2 有接口)。无 TBD。

**Type consistency**:`Finding`/`Auditor`(T1)→ T2-T5 一致;`AdrRecord`(T6);`activeLayers`(T1)→ T4/T5 一致;audit_finding event 字段(severity/finding)→ T8 一致。

**风险**:T2 tool-execution 需精确排除 aborted/pendingToolCalls(否则 false positive);T4 环形 buffer 溢出信号;T5 recentEvents 来源(subscribe buffer vs events 重放);T7 council skill 放 `<cwd>/.agentforge/skills/`(项目级)。
