# Slice 4-A: SUMMARIZE_PROMPT 质量改进 — 设计

- **Date**: 2026-06-24
- **Status**: Draft（待实现；已吸收 red-team Oracle 审查修订）
- **Slice**: 4-A（Slice 4 第一个子项目；4-B instinct 待 4-A 完成后单独 brainstorm）
- **Base**: `bb52636`（Slice 2.5 final-fix）+ `4cb0535`（遗留 Minor 清理）
- **Branch**: pi（无 remote，本地 commit 不 push）

## 1. 背景与动机

Slice 2.5 T9 真对话验证暴露：DeepSeek 对现 `SUMMARIZE_PROMPT`（`packages/cli/src/compaction-config.ts:12-16`，措辞 "files read/written/edited / key decisions / unfinished tasks"——代码 agent 假设）+ 非代码/短对话产生不相关幻觉（BeamMP/garden）而非真实摘要。

T9 四步诊断结论：`completeSimple` + messages + systemPrompt 传法全正确（PONG/blue-Whiskers 诊断证实 messages 真到达 DeepSeek，**systemPrompt IS effective**），根因 = `SUMMARIZE_PROMPT` 措辞 + DeepSeek 行为。**不是 compaction 接通 bug，也不是 channel（systemPrompt）问题**。

**caveat**：T9 用 computing essay（非代码）测。`SUMMARIZE_PROMPT` 措辞本为代码 agent 设计——真实代码对话（read/edit/多 turn）可能并不幻觉。故 4-A 首要任务是确认问题真实性，再决定是否改进。

**Scope 假设**（red-team Finding 3）：agentforge 是 code agent，目标场景为代码对话（read/edit/多 turn）。非代码/短对话（如 T9 的 computing essay）**out of scope**——T9 暴露的非代码幻觉不阻塞 4-A（4-A 聚焦 code 场景）。但作 prompt 健壮性，§6.2 保留非代码固定输入回归 guard 防止改动引入新幻觉。

## 2. 范围

### 2.1 含
- 前置验证：真实端到端确认 `SUMMARIZE_PROMPT` 对真实代码对话是否幻觉。
- 改进（若验证确认幻觉）：**措辞重写优先**（单变量），channel swap 作轮试。
- 回归验证：改进后真实端到端确认摘要质量改善 + known-broken case 回归 guard。
- 探索性轮试：A（措辞）不奏效→B（channel swap）/ C（streamSimple）。

### 2.2 不含（非目标）
- 分段摘要/大历史 deepseek 输入上限（遗留2，推后实际观察）。
- instinct 模块（4-B 独立 spec→plan→实现周期）。
- compaction 阶段边界真实检测（ADR-0001⑤，远期复用 Audit）。
- streamSimple 全链路改造（仅作 C 方案轮试候选）。
- **DeepSeek 模型适配性评估**（red-team Finding 4）：换模型可能根本解决幻觉，但 memory "C/E 不做" 已排除换模型，且该决策早于 T9 证据未重审。记为已知限制（§10），本 slice 不重审。

## 3. 条件分支

前置验证结果决定后续（red-team Finding 1：二元框架修正——"对代码不幻觉"是更窄声明，仅 code scope 内可接受）：

| 验证结果 | 后续动作 |
|---|---|
| 真实代码对话**不幻觉** | code scope 内 prompt 可接受。4-A 关闭。记录"T9 是非代码场景失败，code scope 内 prompt 可用"结论。不改 prompt。ledger+memory 更新。注：非代码输入 out of scope（§1），不阻塞。 |
| **也幻觉** | 进改进 task（§4，A 措辞优先）。 |

## 4. 改进方案（措辞重写优先，channel swap 作轮试）

**red-team Finding 2 🔴 核心修订**：T9 证 systemPrompt IS effective（PONG），根因是**措辞**不是 channel。故改进分两个独立变量，**先单独改措辞**（最小改动、单变量验证），只有措辞单独失败才动 channel。原 spec 把"措辞改写 + channel swap"捆绑为 approach A 是过度设计——拆开。

### 4.1 Approach A（首选）：SUMMARIZE_PROMPT 措辞重写，保持 systemPrompt channel

改动 `packages/cli/src/compaction-config.ts` 的 `SUMMARIZE_PROMPT` 常量文本，加强约束，明确禁止幻觉行为，保留代码 agent 要素：

```
Summarize the preceding conversation for context retention.
Output ONLY a factual summary. Do NOT continue the conversation.
Do NOT invent or add information not present in the conversation.

Preserve: key decisions and their rationale; files read/written/edited
(with paths); important errors encountered and resolutions; unfinished tasks.
Omit verbatim tool-call arguments and large file contents.
```

- **传法不变**：仍 `{ systemPrompt: SUMMARIZE_PROMPT, messages: messages as unknown as Message[] }`。仅 prompt 文本变。
- 理由：T9 证 systemPrompt channel effective，根因措辞。最小改动，单变量（措辞）验证效果。

### 4.2 Approach B（轮试）：channel swap — 摘要指令移到 user message

仅当 A（措辞重写）单独失败才试。摘要指令从 systemPrompt 移到 messages 首条 user message，systemPrompt 留极简角色定义：
- `{ systemPrompt: "You are a summarization assistant.", messages: [summaryInstructionUserMsg, ...messages] }`
- `summaryInstructionUserMsg = { role: "user", content: SUMMARIZE_PROMPT }`

**风险点**：连续两条 user（指令 + 原对话首条 user）——DeepSeek 可能困惑。
**数据契约风险**（red-team Failure mode）：fallback (ii) 把对话扁平化为单 user content 会丢失 role 结构，破坏 `as unknown as Message[]` + AgentMessage→Message 契约（memory T3 note 依赖）——需测试覆盖该 fallback 形态，或避免使用。

### 4.3 Approach C（轮试）：streamSimple

仅当 A+B 都失败才试 `completeSimple`→`streamSimple`。需先验 pi-ai `streamSimple`/`completeSimple` 对 systemPrompt 处理差异（handoff 候选 c）。摘要不需流式，杠杆不确定。

## 5. 数据流与错误处理

- **数据流**：不变。compaction 触发→`compactorDeps.generateSummary(messages, signal)`→`createSummaryGenerator` 内 `completeSimple`。Approach A 仅 prompt 文本变；B/C 才动传法。
- **错误处理**：不变。`maybeCompact` 已有 try/catch（Slice 2.5 T2，`harness.test.ts:307-373` 验证），`completeSimple` 失败（含 auth-fail/网络/abort）emit `compaction_error` 不阻塞主流程。AbortError/signal.aborted 静默。

## 6. 测试策略

### 6.1 单元测试（TDD 确定性）
mock `completeSimple`（`vi.mock`），断言：
- Approach A：`completeSimple` 收到的 `systemPrompt` 是新强约束 prompt（含 "Do NOT invent"），`messages` 保持原序未插指令 user message，signal 透传。
- RED：旧 prompt（无 "Do NOT invent"）→ 断言失败。GREEN：新 prompt 后通过。

### 6.2 真实端到端（探索性，非自动化）+ known-broken case 回归 guard
- **前置验证**：agentforge 跑真实代码任务（read package.json + edit 某 file + 多 turn），临时 `compactionTokenThreshold=100` 触发 compaction，观察 `generateSummary` 输出。人工判断：真实摘要 or 幻觉。
- **回归验证**：改进后同流程再跑，人工判断摘要质量改善。
- 非确定性 LLM 输出**不进自动化断言**。
- **known-broken case 回归 guard**（red-team Finding 5 ⚪）：T9 的固定非代码输入（computing essay 或等效短对话）作回归 fixture，**自动化断言摘要 on-topic**——含输入某关键词 / 不含已知幻觉词（BeamMP/garden）。虽非代码 out of scope，但防 prompt 改动引入新幻觉回归。此 guard 确定性（固定输入 + 关键词断言）。
- 需新 `DEEPSEEK_API_KEY`（旧 key 需轮换，前会话暴露 3 次）。

## 7. 探索性与迭代

4-A 改进依赖 DeepSeek 非确定行为。本 slice 是 **"验证→改进→回归验证→可能轮试"** 循环，非纯 TDD 线性：
1. 前置验证（真实端到端）→ 确认幻觉？
2. 若幻觉→改进 A（措辞重写，保持 systemPrompt）→ 回归验证（含 known-broken guard）→ 人工判断效果。
3. A 不奏效→轮试 B（channel swap user message）→ 回归。
4. B 不奏效→轮试 C（streamSimple）→ 回归。
5. 收敛：某 approach 真实端到端摘要质量可接受→定稿。或穷尽候选→记录限制（含 §2.2 模型适配未评估）+ 降级（调低 `compactionTokenThreshold` 默认值/禁用 compaction）。

**red-team Escalation 提示**：若真实代码也幻觉，A→B→C 迭代消耗大量 API + 人工判断，而一次对照替代模型可能即解决——此时应重审 §2.2 "换模型" 决策（虽本 slice 不做，但触发重审条件明确）。

## 8. 实现位置

- `packages/cli/src/compaction-config.ts`：`SUMMARIZE_PROMPT` 措辞重写（Approach A）；B/C 才动 `createSummaryGenerator` 传法。
- `packages/cli/src/compaction-config.test.ts`：单元测试（§6.1）+ known-broken case 回归 guard（§6.2）。
- dist rebuild（vitest dev vs tsc dist 陷阱：cli 改也须 `pnpm --filter @agentforge/cli build`）。

## 9. 关联

- memory `agentforge-project-direction.md`：Slice 2.5 T9 段（SUMMARIZE_PROMPT 幻觉诊断）。
- ledger `.superpowers/sdd/progress.md`：Slice 2.5 T9。
- ADR-0001③⑤：instinct=in-process（4-B）；compaction 阶段边界=远期 Audit（非本 slice）。
- handoff `%TEMP%\agentforge-slice4-prep-handoff.md`：候选①改进方案 (a)(b)(c)(d)。
- red-team Oracle 审查 findings（本 spec 已吸收 Finding 1/2/3/4/5 + Failure mode + Escalation）。

## 10. 成功标准与已知限制

**成功标准**：
- 前置验证有明确结论（code 场景幻觉 or 误报）。
- 若改进：真实代码对话 compaction 摘要为真实摘要（含 read/edit 的文件路径、decisions），无无关幻觉。
- known-broken case 回归 guard 绿（固定非代码输入摘要 on-topic）。
- 单元测试绿，271→272+ 无回归。
- ledger+memory 更新结论。

**已知限制**：
- DeepSeek 模型适配性未评估（§2.2）——换模型可能根本解决，本 slice 不重审。
- 非代码/短对话 out of scope（§1）——仅 known-broken guard 防回归，不保证非代码场景摘要质量。
