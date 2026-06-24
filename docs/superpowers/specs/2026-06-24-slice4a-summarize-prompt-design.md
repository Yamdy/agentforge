# Slice 4-A: SUMMARIZE_PROMPT 质量改进 — 设计

- **Date**: 2026-06-24
- **Status**: Draft（待实现）
- **Slice**: 4-A（Slice 4 第一个子项目；4-B instinct 待 4-A 完成后单独 brainstorm）
- **Base**: `bb52636`（Slice 2.5 final-fix）+ `4cb0535`（遗留 Minor 清理）
- **Branch**: pi（无 remote，本地 commit 不 push）

## 1. 背景与动机

Slice 2.5 T9 真对话验证暴露：DeepSeek 对现 `SUMMARIZE_PROMPT`（`packages/cli/src/compaction-config.ts:12-16`，措辞 "files read/written/edited / key decisions / unfinished tasks"——代码 agent 假设）+ 非代码/短对话产生不相关幻觉（BeamMP/garden）而非真实摘要。

T9 四步诊断结论：`completeSimple` + messages + systemPrompt 传法全正确（PONG/blue-Whiskers 诊断证实 messages 真到达 DeepSeek，systemPrompt 生效），根因 = `SUMMARIZE_PROMPT` 措辞 + DeepSeek 行为。**不是 compaction 接通 bug**。

**caveat**：T9 用 computing essay（非代码）测。`SUMMARIZE_PROMPT` 措辞本为代码 agent 设计——真实代码对话（read/edit/多 turn）可能并不幻觉。故 4-A 首要任务是确认问题真实性，再决定是否改进。

## 2. 范围

### 2.1 含
- 前置验证：真实端到端确认 `SUMMARIZE_PROMPT` 对真实代码对话是否幻觉。
- 改进（若验证确认幻觉）：user message 传摘要指令 + 强约束。
- 回归验证：改进后真实端到端确认摘要质量改善。
- 探索性轮试：A 不奏效→B/C。

### 2.2 不含（非目标）
- 分段摘要/大历史 deepseek 输入上限（遗留2，推后实际观察）。
- instinct 模块（4-B 独立 spec→plan→实现周期）。
- compaction 阶段边界真实检测（ADR-0001⑤，远期复用 Audit）。
- streamSimple 全链路改造（仅作 C 方案轮试候选）。

## 3. 条件分支

前置验证结果决定后续：

| 验证结果 | 后续动作 |
|---|---|
| 真实代码对话**不幻觉** | 4-A 关闭。记录"T9 是 computing essay 场景误报"结论。不改 prompt。ledger+memory 更新。 |
| **也幻觉** | 进改进 task（§4）。 |

## 4. 改进方案（user message + 强约束）

改动 `packages/cli/src/compaction-config.ts`。

### 4.1 SUMMARIZE_PROMPT 重写

更强约束，明确禁止幻觉行为，保留代码 agent 要素：

```
Summarize the conversation that follows for context retention.
Output ONLY a factual summary. Do NOT continue the conversation.
Do NOT invent or add information not present in the conversation.

Preserve: key decisions and their rationale; files read/written/edited
(with paths); important errors encountered and resolutions; unfinished tasks.
Omit verbatim tool-call arguments and large file contents.
```

### 4.2 传法变更

`createSummaryGenerator` 内 `completeSimple` 调用：

- **现**：`{ systemPrompt: SUMMARIZE_PROMPT, messages: messages as unknown as Message[] }`
- **改**：`{ systemPrompt: "You are a summarization assistant.", messages: [summaryInstructionUserMsg, ...messages] as unknown as Message[] }`
  - `summaryInstructionUserMsg = { role: "user", content: SUMMARIZE_PROMPT }`
  - 即摘要指令从 systemPrompt 移到 messages 首条 user message；systemPrompt 留极简角色定义。

### 4.3 风险点

连续两条 user（指令 user + 原对话首条 user）——DeepSeek 可能困惑。
- 验证时观察：若困惑（如把指令当对话一部分），fallback：
  - (i) 加 assistant 占位 `{role:"assistant",content:"Understood. Here is the summary:"}` 后接原对话——会割裂对话，不推荐。
  - (ii) 把原对话扁平化为 user content：`{role:"user", content: SUMMARIZE_PROMPT + "\n\n<conversation>\n" + serialize(messages) + "\n</conversation>"}`——丢失 role 结构但指令清晰。
  - (iii) systemPrompt 留摘要指令 + user message 放对话——回退接近原状但加强约束。
- 这些 fallback 即轮试候选 B/C 的变体。

## 5. 数据流与错误处理

- **数据流**：不变。compaction 触发→`compactorDeps.generateSummary(messages, signal)`→`createSummaryGenerator` 内 `completeSimple`。仅 `completeSimple` 入参传法变（§4.2）。
- **错误处理**：不变。`maybeCompact` 已有 try/catch（Slice 2.5 T2），`completeSimple` 失败（含 auth-fail/网络/abort）emit `compaction_error` 不阻塞主流程。AbortError/signal.aborted 静默。

## 6. 测试策略

### 6.1 单元测试（TDD 确定性）
mock `completeSimple`（`vi.mock`），断言传法：
- messages 首条是 `{role:"user", content: SUMMARIZE_PROMPT}`（含强约束关键词 "Do NOT invent"）。
- systemPrompt 是极简角色（非 `SUMMARIZE_PROMPT` 全文）。
- 原 messages 在首条指令之后保持顺序。
- signal 透传（回归 Slice 2.5 T1）。

RED：旧传法（systemPrompt=SUMMARIZE_PROMPT）→ 断言失败。GREEN：改传法后通过。

### 6.2 真实端到端（探索性，非自动化）
- **前置验证**：agentforge 跑真实代码任务（read package.json + edit 某 file + 多 turn），临时 `compactionTokenThreshold=100` 触发 compaction，观察 `generateSummary` 输出。人工判断：真实摘要 or 幻觉。
- **回归验证**：改进后同流程再跑，人工判断摘要质量改善。
- 非确定性，**不进自动化断言**（LLM 输出无法稳定断言）。可选 sanity：摘要非空 + 长度 > N（防退化）。
- 需新 `DEEPSEEK_API_KEY`（旧 key 需轮换，前会话暴露 3 次）。

## 7. 探索性与迭代

4-A 改进依赖 DeepSeek 非确定行为。本 slice 是 **"验证→改进→回归验证→可能轮试"** 循环，非纯 TDD 线性：
1. 前置验证（真实端到端）→ 确认幻觉？
2. 若幻觉→改进 A（user message+强约束）→ 回归验证 → 人工判断效果。
3. A 不奏效→轮试 B（仅加强 systemPrompt）/ C（streamSimple）。
4. 收敛：某 approach 真实端到端摘要质量可接受→定稿。或穷尽候选→记录限制、调低 `compactionTokenThreshold` 默认值/禁用 compaction 作降级。

## 8. 实现位置

- `packages/cli/src/compaction-config.ts`：`SUMMARIZE_PROMPT` 重写 + `createSummaryGenerator` 传法变更。
- `packages/cli/src/compaction-config.test.ts`：单元测试（§6.1）。
- dist rebuild（vitest dev vs tsc dist 陷阱：cli 改也须 `pnpm --filter @agentforge/cli build`）。

## 9. 关联

- memory `agentforge-project-direction.md`：Slice 2.5 T9 段（SUMMARIZE_PROMPT 幻觉诊断）。
- ledger `.superpowers/sdd/progress.md`：Slice 2.5 T9。
- ADR-0001③⑤：instinct=in-process（4-B）；compaction 阶段边界=远期 Audit（非本 slice）。
- handoff `%TEMP%\agentforge-slice4-prep-handoff.md`：候选①改进方案 (a)(b)(c)(d)。

## 10. 成功标准

- 前置验证有明确结论（幻觉 or 误报）。
- 若改进：真实代码对话 compaction 摘要为真实摘要（含 read/edit 的文件路径、decisions），无无关幻觉。
- 单元测试绿，271→272+ 无回归。
- ledger+memory 更新结论。
