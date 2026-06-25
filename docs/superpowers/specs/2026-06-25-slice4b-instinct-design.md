# Slice 4-B: Instinct 模块设计

- **Date**: 2026-06-25
- **Slice**: 4-B（ARCH §8 Slice 4 学习的 instinct 子项）
- **Status**: Design（待 plan）
- **依据**: ARCH §4.7 Instinct / ADR-0001c / compendium `continuous-learning-v2`（`research/ecc-agent-architecture-compendium.md` §21）/ Slice 1 ContextBudget `memory?` 预留缺口
- **前置**: Slice 0-4-C 完成（276 测试绿，commit `43120e7`，pi 分支本地未 push）；全换 MiMo 后 compaction 零幻觉（extract LLM 可靠性有底）

---

## 1. 背景与动机

Instinct 是 compendium `continuous-learning-v2` 的核心：从工具使用观察中学习 **atomic instinct**（一个 trigger → 一个 action），带 confidence（0.3–0.9）+ project-scoped 隔离，跨 session 记住用户模式。ADR-0001c 已定 **in-process 低频任务 + 低 tier 模型**（不独立进程），Slice 4 重点在 instinct 模型本身而非进程架构。

Slice 1 ContextBudget 有意省略 `memory` 组件（`context-budget.ts:45` `BudgetComponents.memory?` 预留，注释"Slice 1 instinct/memory 未建，后续 slice 填充"）。4-B 补此缺口：instinct apply 注入 systemPrompt 的 token 单独计入 budget memory 组件。

`shared/src/index.ts:68` `InstinctObservedEvent` 已在 `HarnessCustomEvent` union 预留，`CustomEntry.kind` 注释含 "instinct"——接缝已就位。

## 2. 范围

**纳入 4-B**：
- observe（订阅 EventBus 记 observations）
- extract（LLM `completeSimple` 后台提炼 instinct + confidence）
- apply（session 启动全量注入 systemPrompt `<learned_instincts>` 段落）
- project scope 三级 fallback 隔离
- memory 组件补 ContextBudget `memory?` 缺口
- `/instincts` repl 查询命令

**defer 后续 slice**：
- promote（project→global 命令/自动提升）
- evolve（instincts→skills/commands/agents 演进）
- export/import instinct 库
- compaction 禁用开关（handoff 列非阻塞待办，独立小项，非 4-B）
- 阈值触发 extract（4-B session end 一次；长 session 中途提炼留优化）
- 检索相关子集 apply（4-B 全量注入；trigger 关键词匹配留优化）
- observations.jsonl 轮转/归档（compendium 有 `observations.archive/`，defer）

## 3. 核心决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | extract = LLM 后台分析（`completeSimple`） | compendium v2 做法；能学复杂模式（用户纠正/错误恢复/重复工作流）；confidence 可校准。provider/model 可注入（默认 MiMo），ADR-0001c"低 tier 模型"= 未来换便宜模型即可。纯规则覆盖窄（v2 弃规则正因此） |
| D2 | 跨 session：observe 全程记 → extract session end → 持久化 → 下次 session apply | 符合 instinct 长期学习价值；extract 不阻塞当前 session（in-process await 在 session end）；dogfood：今天纠正明天自动做 |
| D3 | apply = 全量注入 systemPrompt `<learned_instincts>` 段落 | 与 skills 一致（都拼 systemPrompt）；简单可靠；LLM 自判相关性（trigger 本是自然语言）；膨胀靠 confidence 阈值 + 数量上限控 |
| D4 | project scope 三级 fallback（env > git remote hash > repo path hash > global） | compendium 验证方案；agentforge 无 remote 走 repo path hash（同机器稳定隔离）；env 注入便于测试 |
| D5 | extract 触发 = session end 同步 await（最小闭环） | 跨 session 模式下 session end 时 observations 最全、提炼质量最高；无异步竞态；与 compaction `completeSimple` 一致。阈值触发在跨 session 模式下中途提炼也要下次 session 才 apply，价值有限 |

## 4. 架构总览与模块边界

Instinct 是 harness 第 7 个自写模块（ARCH §4.7），与 compaction/safety/verifier 同级。核心是 **InstinctStore**（`packages/harness/src/instinct.ts`），横跨 harness 与 cli（与 compaction 模式一致：harness 持逻辑 + cli 注入依赖/驱动触发）：

- **InstinctStore**（harness）：纯逻辑 + 持久化 + 可注入 LLM 依赖 `extractRun`（类比 compaction `generateSummary`）。构造时注入 `projectHash`（cli 算好传入，harness 不调 git）+ `extractRun`（`completeSimple` 包装，测试 mock）。
- **harness**：`HarnessOptions.instinct?: InstinctStore`。构造时 **apply**（读 instinct 拼 systemPrompt）+ **observe**（订阅 EventBus 记 observations）。暴露 `extract()` 供 cli session end 调（被动，类似 verifier）。
- **cli**：算 project scope（三级 fallback，git 命令在 cli 层）→ 构造 InstinctStore 注入 harness → session end（print 完成 / repl 退出）`await harness.extract()` → `/instincts` repl 命令。

```
session 启动:
  cli 算 projectHash（env > git remote hash > repo path hash > global）
  → 构造 InstinctStore(projectHash, extractRun)
  → harness 构造: apply = systemPrompt + formatInstincts(loadInstincts(projectHash+global))
                  observe = events.on("*", e => instinctStore.observe(e))
  → maybeAuditBudget: memory 组件 = estimate(instinct 块)；systemPrompt 组件 = estimate(basePrompt)

session 中:
  EventBus emit tool_execution_end / message 事件 → observe() append observations.jsonl

session end:
  cli await harness.extract() → extractRun(observations, EXTRACT_PROMPT) → instinct[]
    → 去重/合并已有（同 id → confidence 累积↑ + evidence 追加）→ 持久化
```

## 5. 数据模型

```ts
interface Observation {
  timestamp: number;
  projectHash: string | null;       // null = global fallback
  kind: "tool_call" | "user_message" | "assistant_message" | "tool_error";
  data: {
    toolName?: string;
    argsSummary?: string;           // args 的短摘要，非全量
    isError?: boolean;
    content?: string;               // message content，截断 ~500 字符
  };
}

interface Instinct {
  id: string;          // kebab-case，从 trigger 派生（同 trigger 同 id，去重合并基础）
  trigger: string;     // 自然语言 "when running tests fails on import"
  action: string;      // 自然语言 "check vitest alias config first"
  confidence: number;  // 0.3-0.9
  domain: string;      // testing / git / code-style / debugging / workflow
  scope: "project" | "global";
  projectHash: string | null;
  evidence: string[];  // 观察摘要列表，限 5 条
  createdAt: number;
  updatedAt: number;
}
```

**id 派生**：`trigger.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)`。同 trigger → 同 id → 去重合并。

## 6. 持久化与 project scope

持久化（与 skills 的 `~/.agentforge/` 约定一致）：
- `~/.agentforge/projects/<hash>/observations.jsonl`（append-only，project-scoped）
- `~/.agentforge/projects/<hash>/instincts/<id>.json`（一文件一 instinct，便于去重/合并/查询）
- `~/.agentforge/instincts/<id>.json`（global）
- `~/.agentforge/projects.json`（hash → name/path/remote 注册表，compendium 一致）

project scope 三级 fallback（cli 层计算）：
1. `AGENTFORGE_PROJECT_DIR` env（测试注入固定 hash，避免依赖 git）
2. `git remote get-url origin` → sha256 前 12 字符（有 remote 的项目，跨机器 portable）
3. `git rev-parse --show-toplevel` → sha256 前 12 字符（agentforge 无 remote 走此，同机器稳定）
4. global（null 兜底）

## 7. 组件设计

### 7.1 observe

- harness 构造时 `events.on("*", handler)`，handler 调 `instinctStore.observe(adaptedEvent)`。
- 适配：只记四类信号（其余事件忽略）：
  - `tool_execution_end` → `tool_call`（toolName/argsSummary/isError，argsSummary = `JSON.stringify(args)` 截断 ~200 字符，observe 阶段不调 LLM）；`isError:true` 额外记一条 `tool_error`
  - pi Agent `message_end` 事件按 role 拆 `user_message` / `assistant_message`（content 截断 ~500 字符控体积）
- observe 失败（写盘 IO 错）try/catch 静默吞，不阻塞主流程。
- observations.jsonl append（`fs.appendFileSync` + 父目录 `mkdirSync recursive`，复用 Slice 0 jsonl 落盘教训）。

### 7.2 extract

- 触发：cli session end 调 `await harness.extract()`。print 完成 / repl 退出两出口。
- 执行：`extractRun(observations, EXTRACT_PROMPT)`。默认实现 = `completeSimple(model, {systemPrompt: EXTRACT_PROMPT, messages: [{role:"user", content: JSON.stringify(observations)}]}, {apiKey})`（与 compaction `createSummaryGenerator` 同形，复用 `env-config.getApiKeyFromEnv` + MiMo 默认）。
- `EXTRACT_PROMPT` 约束 LLM 输出严格 JSON `{instincts: [{trigger, action, confidence, domain, evidence}]}`：强约束措辞 + "Do NOT invent" + 只从给定 observations 提炼（复用 4-A SUMMARIZE_PROMPT 教训）。MiMo 零幻觉已证（4-C），extract 可靠性有底。
- observations 体积：extract 传 session 全量 observations（`JSON.stringify`）。MiMo ctx 1048576 足够日常 session；observations 极大超 ctx 的情况 4-B 不处理（依赖未来轮转/归档，见 §10）。
- **去重/合并**：extract 产出后，每条按 `id` 查已有：
  - 已存在 → `confidence = min(0.9, old.confidence + 0.1)`（重复观察↑）+ `evidence` 追加新证据（限 5 条，去重）+ `updatedAt` 刷新
  - 不存在 → 新建 `confidence = clamp(LLM 值, 0.3, 0.9)` + `scope = "project"`（4-B 不自动 promote）
- extract 失败（LLM 错/JSON 解析错/IO 错）try/catch，stderr 打印 `[instinct] extract failed: <msg>`，session end 继续退出（best-effort，非主路径，不 emit 治理事件）。

### 7.3 apply

- harness 构造时：`const all = instinctStore.loadInstincts(projectHash)`（返回 project + global 全部，未过滤）；apply 内过滤 `confidence >= 0.5` + 按 confidence 降序 + 上限 **20 条**，再 `formatInstinctsForSystemPrompt`。
- `loadInstincts`：读 project + global instinct 全部，未过滤。`/instincts` 命令共用此方法显示全部（展示所有 confidence 供审查，不过滤）。
- `formatInstinctsForSystemPrompt`：生成 `<learned_instincts>` 段落（每条 `- trigger → action (confidence: 0.x)`），空则返回 `""`（不拼，与 skills 空 block 一致）。
- `this._agent` 构造时 `systemPrompt: opts.systemPrompt + instinctBlock`。harness 存 `this._baseSystemPrompt`（opts.systemPrompt）+ `this._instinctBlock` 供 audit 区分。
- 跨 session：session 中途 extract 新增的 instinct 不影响当前 session systemPrompt（已构造），下次 session 构造时才注入——符合 D2。

### 7.4 memory 组件（补 Slice 1 ContextBudget 缺口）

- `maybeAuditBudget` 改造：若 `this._instinctBlock` 非空，`audit` 输入传 `memory: this._instinctBlock`（新增 `BudgetAuditInput.memory?: string`）。
- `context-budget.audit`：`components.memory = memory ? estimateStringTokens(memory) : undefined`；`total` 含 memory。`systemPrompt` 组件只估 `baseSystemPrompt`（harness 传 basePrompt 而非拼接后的，避免双重计算）。
- Slice 1 预留的 `BudgetComponents.memory?` 字段真正填充。`context_budget` 事件可反映 instinct 开销。

### 7.5 `/instincts` repl 命令

- repl 输入以 `/instincts` 开头时，不走 `harness.prompt`，改为调 `harness.instinctStore` 列出：
  - 读 project（当前 projectHash）+ global instinct，按 scope 分组、confidence 降序
  - 输出：`id | scope | confidence | trigger → action`（每条一行）+ evidence 条数
  - 空时打印 "No instincts learned yet for this project."
- 只读查询，不改状态。print/rpc 模式不接（repl 专属，与 readline 逐行一致）。

## 8. 错误处理（best-effort，全链不阻塞主流程）

| 失败点 | 处理 |
|---|---|
| observe 写盘 IO 错 | try/catch 静默吞 |
| extract LLM 调用错 / JSON 解析错 | try/catch，stderr `[instinct] extract failed: <msg>`，session end 继续退出 |
| extract 持久化 IO 错 | 同上静默，已有 instinct 不丢 |
| apply 读 instinct IO 错 | try/catch 返回 `""`（不拼块，harness 正常构造） |
| project scope git 命令失败 | fallback 到下一级（remote 失败 → repo path 失败 → global） |
| memory audit 失败 | 复用 Slice 1 maybeAuditBudget try/catch 静默吞 |

原则：instinct 是"学习增益"非主路径，任何失败降级为"本轮不学/不应用"，不让 agentforge 崩或卡。

## 9. 测试策略（TDD，与 Slice 2.5/3/3.5 一致）

- **单元**（`harness/src/instinct.test.ts`）：observe 适配四类事件 + observations.jsonl 落盘；extract 用 mock `extractRun`（返回固定 instinct JSON）验去重/合并（同 id confidence +0.1 上限 0.9、evidence 追加限 5、新 id 新建 clamp）；loadInstincts confidence>=0.5 过滤 + 上限 20 + 降序；formatInstinctsForSystemPrompt 空块返回 ""；project scope 三级 fallback（mock git）。
- **集成**（`harness.test.ts`）：harness 注入 InstinctStore，验 apply 拼 systemPrompt（构造后 `agent.state.systemPrompt` 含 `<learned_instincts>`）+ observe 订阅 EventBus（emit tool_execution_end 后 observations.jsonl 多一条）+ extract 触发持久化。
- **memory 组件**（`context-budget.test.ts`）：audit 传 memory 字段，components.memory 填值 + total 含 memory + systemPrompt 只估 basePrompt（不双重计算）。
- **cli**：session end 调 extract（print/repl 两出口 mock）+ `/instincts` 命令输出格式 + project scope 计算（mock git）。
- **真对话验证**（T9 等价）：MiMo 跑工具对话 → session end extract → 检查 `~/.agentforge/projects/<hash>/instincts/` 产出 → 重启 session 检查 systemPrompt 含 instinct 块。`AGENTFORGE_PROJECT_DIR` 注入固定 hash 避免污染真实 instinct 库。

## 10. 陷阱与边界

- pi Agent `systemPrompt` 构造时定，session 中途 extract 新增不影响当前 session（跨 session，符合设计，非 bug）。
- extract await 阻塞 repl 退出——用户已交互完，可接受；print 模式 await 在回复输出后，不影响体验。
- observations.jsonl 无上限增长——4-B 不做轮转/归档（defer），靠 content 截断控单体体积；长期使用需归档（记待办）。
- `InstinctObservedEvent`（shared 已预留）4-B **不 emit**——observe 阶段每条 observation emit 太碎；observations 直接落盘。事件类型保留供未来 Audit 消费。
- vitest development condition vs tsc dist：改 harness/shared 后须 `pnpm --filter @agentforge/<pkg> build` rebuild dist（老陷阱）。
- GateGuard hook 拦新文件/编辑，陈述 4 事实放行（import[Grep] / 受影响符号 / 数据文件字段 / 用户指令原文）。
- pi 分支无 remote：commit 留本地不 push，message 结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- MiMo 是默认模型（`xiaomi-token-plan-cn`/`mimo-v2.5-pro`，env `XIAOMI_TOKEN_PLAN_CN_API_KEY`）；extract 的 `extractRun` 默认用 MiMo + `getApiKeyFromEnv`，provider/model 可注入。

## 11. 接口 sketch

```ts
// harness/src/instinct.ts
export interface ExtractRun {
  (observations: Observation[], signal?: AbortSignal): Promise<Instinct[]>;
}

export interface InstinctStore {
  observe(event: HarnessEvent): void;                    // 适配 + append observations.jsonl
  loadInstincts(projectHash: string | null): Instinct[]; // project + global 全部，未过滤（apply 与 /instincts 共用；apply 侧再过滤 confidence+上限）
  extract(signal?: AbortSignal): Promise<void>;          // extractRun + 去重/合并 + 持久化
}

export function createInstinctStore(opts: {
  projectHash: string | null;
  extractRun: ExtractRun;
  dataDir?: string;   // 默认 ~/.agentforge，测试可注入 tmpdir
}): InstinctStore;

export function formatInstinctsForSystemPrompt(instincts: Instinct[]): string;
```

```ts
// harness/src/harness.ts 增量
export interface HarnessOptions {
  // ...既有
  instinct?: InstinctStore;
}
// 构造时：apply 拼 systemPrompt + observe 订阅；存 _baseSystemPrompt/_instinctBlock
// 暴露 extract() / get instinctStore()
// maybeAuditBudget 传 memory: _instinctBlock
```

```ts
// shared/src/index.ts 增量
// InstinctObservedEvent 已存在，4-B 不 emit（保留）
// 无新增类型（Observation/Instinct 是 harness 层类型，不上 shared）
```

```ts
// context-budget.ts 增量
export interface BudgetAuditInput {
  // ...既有
  memory?: string;  // instinct 块字符串
}
// audit: components.memory = memory ? estimateStringTokens(memory) : undefined
```

## 12. 参考引用

- ARCHITECTURE.md §4.7 Instinct / §8 Slice 4
- ADR-0001c（`docs/adr/0001-deferred-decisions.md`）：in-process 低频 + 低 tier 模型
- compendium §21 `continuous-learning-v2`（`research/ecc-agent-architecture-compendium.md:3914`）
- Slice 1 ContextBudget `memory?` 预留（`packages/harness/src/context-budget.ts:45`）
- Slice 4-C 全换 MiMo（commit `43120e7`）：extract LLM 可靠性基础
- Slice 2.5 compaction `createSummaryGenerator`：extractRun 同形参考
- Slice 4-A SUMMARIZE_PROMPT 教训：EXTRACT_PROMPT 强约束复用
