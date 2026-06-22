# AgentForge 架构设计

> 目标：基于 pi 核心（`pi-ai` + `pi-agent-core` 的 Agent/agentLoop）自写 harness 与 coding-agent 外壳，把 ECC compendium 的 agent 方法论作为一等公民设计进 harness 层。
> 本文档取代 `~/.claude/workflows/proteus-*.md` 的从零自建路线。proteus 的 62 个 issue 多数在重造 pi 已有的轮子；agentforge 只重造"方法论要落地的那层"。

---

## 1. 设计原则

1. **不重造 provider 与 loop**。`pi-ai`（30+ provider 适配、流式、模型注册表）和 `pi-agent-core` 的 `Agent`/`agentLoop`（streaming、sequential/parallel 工具执行、steering/follow-up、stop condition、loop 级 hook）是 pi 最大的工程价值且已做对，作为依赖复用。
2. **harness 层自己写**。Session/compaction/skills/hooks/权限/学习/验证/审计是 compendium 方法论落地处，自己写才能把 12 层失败模型、santa、instinct、context-budget 设计成一等公民，而不是外挂。
3. **不围绕 Claude Code**。agentforge 是独立 code agent，不照搬 Claude Code 的概念名（无 `claude -p`、无 `~/.claude/`、无 `/orchestrate`、无 plugin namespace）。compendium 里 Claude Code 耦合的部分被剥离或改造（见 §7）。
4. **方法论 → 模块**。每条 compendium 方法论落到一个 harness 模块，有明确接口和挂载点，不靠 prompt 约定。
5. **vertical slice 推进**。每个 slice 端到端可运行，先验证链路再叠能力。

---

## 2. 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│  方法论层（compendium 精华，剥离 Claude Code）                │
│  12层失败模型 / santa对抗验证 / instinct学习 /                │
│  context-budget / safety-guard / 循环模式谱系 / ADR           │
├─────────────────────────────────────────────────────────────┤
│  自写 harness 层（@agentforge/harness）                      │
│  Session · Compaction · ContextBudget · Skills · Events ·    │
│  Safety · Instinct · Verification · Audit · ADR              │
│  基于 pi 核心 Agent 的 loop hook 挂载                         │
├─────────────────────────────────────────────────────────────┤
│  自写 coding-agent 外壳（@agentforge/cli）                   │
│  CLI · REPL/print/RPC 三模式 · 内置工具 · 配置 · 项目上下文   │
├─────────────────────────────────────────────────────────────┤
│  复用层（依赖，不重写）                                       │
│  pi-agent-core: Agent / agentLoop / types / proxy            │
│  pi-ai: provider 抽象 / 模型注册表 / 流式协议                 │
└─────────────────────────────────────────────────────────────┘
```

复用边界：`Agent` 类与 `agentLoop`/`agentLoopContinue` 函数、`AgentTool`/`AgentMessage`/`AgentLoopConfig` 类型、`pi-ai` 的 `getModel`/`stream`/`registerApiProvider`。**不复用** pi 的 `harness/` 目录（Session/compaction/env/AgentHarness）与 `pi-coding-agent` 包（CLI/TUI/扩展）——这些是自写层。

---

## 3. 项目结构

pnpm monorepo，参考 pi 分层但精简：

```
agentforge/
├── packages/
│   ├── shared/          # 共享类型：Session entry、Event、Config、自定义 AgentMessage
│   ├── harness/         # 自写 harness（依赖 pi-ai + pi-agent-core 核心）
│   ├── cli/             # coding-agent 外壳 + 内置工具（依赖 harness）
│   └── eval/            # 评测/基准（后期，对应 compendium agent-eval）
├── research/            # 只读：compendium + index（方法论参考）
├── ARCHITECTURE.md      # 本文档
├── AGENTS.md            # 项目开发规范
└── ...
```

依赖方向：`shared` ← `harness` ← `cli`。`harness` 是核心自写层，`cli` 是薄外壳。内置工具放 `cli` 内（参考 pi `coding-agent/src/core/tools/`），不单独成包。

---

## 4. 自写 harness 模块设计

每个模块给出：职责 / 核心接口 / compendium 映射 / pi 蓝本。

### 4.1 Session

- **职责**：会话状态持久化。树形（支持分支/fork），JSONL 落盘。支持自定义 entry 类型（装 instinct/ADR/audit 记录）。
- **核心接口**：
  ```ts
  interface SessionStore {
    getLeafId(): string; setLeafId(id: string): void;
    appendEntry(e: SessionEntry): string;   // 返回 entryId
    getEntry(id: string): SessionEntry | undefined;
    getPathToRoot(leafId: string): SessionEntry[];
    moveTo(leafId: string, branchSummary?: string): void;
  }
  type SessionEntry =
    | { type: "message"; /* AgentMessage */ }
    | { type: "compaction"; summary: string; firstKeptEntryId: string }
    | { type: "branch_summary"; ... }
    | { type: "custom"; kind: string; data: unknown };  // instinct/adr/audit
  ```
- **compendium 映射**：`ck`（文件型记忆）的持久化思想。
- **pi 蓝本**：`pi-agent-core/harness/session/`（Session/SessionStorage/JsonlSessionStorage/SessionRepo）。自写以支持自定义 entry 和 agentforge 的 compaction 策略。

### 4.2 Compaction

- **职责**：上下文压缩。token 阈值或阶段边界触发（Slice 1 实现：token 阈值主触发 + `stageMarkers` 标记检测末尾消息 + 可注入 `isAtStageBoundary` 谓词，三者任一命中即压缩；阶段边界策略可注入不硬编码 research/plan/milestone/debug 检测）。切点保 turn 完整，LLM 生成 summary，提取 fileOps（已读/已写/已编辑文件集合）。
- **核心接口**：
  ```ts
  interface Compactor {
    shouldCompact(ctx: SessionContext): boolean;       // 阶段边界 + token 阈值双触发
    compact(ctx: SessionContext, signal): Promise<CompactionResult>;
  }
  ```
  挂载：harness 主动在 `prompt` turn 间调用（`transformContext` 是纯变换无 session 访问不适合持久化 CompactionEntry；`shouldStopAfterTurn` 不在 AgentOptions）。压缩后落盘 CompactionEntry + 替换 agent messages 为 [summary, ...kept]。`--resume` 时 `rebuildMessages` 从 CompactionEntry 重合成 summary 消息注入（取路径最末端 CompactionEntry，firstKeptEntryId 锚点跳过被压缩旧 messages）。
- **compendium 映射**：`strategic-compact`（阶段边界 compaction 决策表）。
- **pi 蓝本**：`pi-agent-core/harness/compaction/`（prepareCompaction/findCutPoint/generateSummary）。

### 4.3 ContextBudget

- **职责**：审计 system prompt / skills / tools / memory / history 的 token 开销，给出优化建议（哪个 skill 该降级 LIBRARY、哪个 tool schema 太大、history 是否该 compaction）。pi 无此模块，完全自写。Slice 1 memory 组件有意省略（instinct/memory 未建），接口预留 `memory?` 字段后续 slice 填充。
- **核心接口**（实现用扁平输入，更可测可组合）：
  ```ts
  interface ContextBudget {
    audit(input: BudgetAuditInput): BudgetReport;   // 各组件 token 估算 + 优化建议
    headroom(total: number, modelContextWindow: number): number;  // 剩余可用 token
  }
  ```
  Slice 1 已挂载 harness：`prompt` 每 turn 完成后（`modelContextWindow` 注入时）调 `audit`，有建议或 headroom 不足则 emit `context_budget` 事件（诊断性，try/catch 不阻塞主流程）。cli 尚未传 `modelContextWindow`，机制就绪未启用。
- **compendium 映射**：`context-budget`（"MCP 是最大杠杆，每 tool schema ~500 tokens"）。
- **pi 蓝本**：无。compendium 独有。

### 4.4 Skills

- **职责**：按需加载方法论 skill（SKILL.md + frontmatter）。DAILY（常驻 system prompt）vs LIBRARY（按需/检索）分类。注入 system prompt 的 `<available_skills>` 块。
- **核心接口**：
  ```ts
  interface SkillRegistry {
    load(dir: string): Skill[];                       // 发现 ~/.agentforge/skills + <cwd>/.agentforge/skills
    classify(skill: Skill, repoEvidence: unknown): "daily" | "library";  // agent-sort 思想
    formatForSystemPrompt(daily: Skill[]): string;
    invoke(name: string, args?: unknown): Promise<void>;        // 显式调用
  }
  ```
- **compendium 映射**：`agent-sort`（DAILY/LIBRARY 证据驱动分类）+ `skill-stocktake`（skill 运维审计）。
- **pi 蓝本**：`pi-agent-core/harness/skills.ts`（formatSkillsForSystemPrompt）。

### 4.5 Events

- **职责**：harness 级事件总线。把 pi 核心 Agent 的 loop 事件（agent_start/turn_*/tool_execution_*/message_*）+ harness 自定义事件（compaction/instinct_observed/audit_finding/adr_recorded）统一分发，供 Audit/Instinct/Verification 等消费者订阅。
- **核心接口**：
  ```ts
  interface EventBus {
    on<T>(type: EventType, handler: (e: T) => void | Promise<void>): Unsubscribe;
    emit(e: HarnessEvent): void;
  }
  ```
  pi 核心 `Agent.subscribe(event)` 是事件源；harness EventBus 在其上叠加自定义事件与异步屏障。
- **compendium 映射**：`agent-harness-construction`（observation 设计）的事件化。
- **pi 蓝本**：`AgentHarness.on/subscribe` + hook 事件类型。

### 4.6 Safety

- **职责**：工具执行权限。allow/deny/ask 规则引擎 + freeze mode（锁定可写目录）+ 破坏性命令拦截（`rm -rf`/`git push --force`/`DROP TABLE`...）。pi 无内置权限，完全自写。
- **核心接口**：
  ```ts
  interface SafetyGuard {
    check(toolCall: ToolCall, args: unknown): "allow" | "deny" | "ask";
    freeze(allowDir: string): void;   // Write/Edit 仅允许 allowDir
  }
  ```
  挂到 `Agent` 的 `beforeToolCall`，返回 `{block: true, reason}` 阻止。
- **compendium 映射**：`safety-guard`（careful/freeze/guard 三模式 + watched patterns）。
- **pi 蓝本**：无（pi 靠扩展）。`examples/extensions/permission-gate.ts` 可参考。

### 4.7 Instinct

- **职责**：从工具使用观察中学习 atomic instinct（一个 trigger → 一个 action），带 confidence（0.3–0.9）+ project-scoped（按 git remote hash 隔离）。用户修正 → instinct；重复工作流 → instinct。pi 无此模块，完全自写。
- **核心接口**：
  ```ts
  interface InstinctStore {
    observe(event: HarnessEvent): void;              // 订阅 Events，积累 observations.jsonl
    extract(): Instinct[];                            // 后台分析（可独立进程/低 tier 模型）
    apply(state: AgentState): AgentState;             // 注入相关 instinct 到 context
    promote(id: string): void;                        // project → global
  }
  ```
- **compendium 映射**：`continuous-learning-v2`（instinct 模型 + confidence + project scope + hook 100% 观察）。
- **pi 蓝本**：无。compendium 独有。

### 4.8 Verification

- **职责**：对抗验证。generator 产出 → 2 个独立 reviewer（无共享上下文，同 rubric）→ verdict gate（both pass 才 ship）→ fix-until-nice 收敛循环（max 3 轮，每轮 fresh reviewer）。基于 pi 核心 Agent spawn 子 agent（或 RPC 模式跑独立 `agentforge` 进程）。
- **核心接口**：
  ```ts
  interface SantaVerifier {
    verify(output: unknown, rubric: Rubric): Promise<{ verdict: "nice" | "naughty"; issues: Issue[] }>;
    // 内部 spawn 2 个独立 reviewer agent，gate，fix loop
  }
  ```
- **compendium 映射**：`santa-method`（双独立审查 + verdict gate + fix-until-nice）+ `verification-loop`（确定性 build/lint/test 阶段）。
- **pi 蓝本**：无。用 pi 核心 `Agent` + subagent spawn 实现。

### 4.9 Audit

- **职责**：12 层失败模型诊断。作为诊断 skill + 事件检测器，检测 wrapper regression / memory contamination / tool discipline failure / hidden repair loops / rendering corruption。出 severity-ranked findings + code-first fix plan。
- **核心接口**：
  ```ts
  interface Auditor {
    scan(state: AgentState, events: HarnessEvent[]): Finding[];
    // 12 层逐层检查，返回 critical/high/medium/low findings
  }
  ```
- **compendium 映射**：`agent-architecture-audit`（12 层 stack + 失败模式 + severity model）。
- **pi 蓝本**：无。compendium 独有。

### 4.10 ADR

- **职责**：捕获架构决策为结构化 ADR（Context/Decision/Alternatives/Consequences），存 `docs/adr/`。轻量文件型。
- **compendium 映射**：`architecture-decision-records`。
- **pi 蓝本**：无。纯文件操作。

---

## 5. coding-agent 外壳（@agentforge/cli）

| 部分 | 职责 | 参考 |
|---|---|---|
| CLI | 子命令路由、flags 解析 | pi `coding-agent/src/cli.ts` + `main.ts` |
| REPL 模式 | 交互式终端（默认，TTY） | pi `modes/interactive/`（可用 pi-tui 或自写轻量） |
| Print 模式 | 一次性 `-p`，输出最终回复或 JSON 事件流 | pi `modes/print-mode.ts` |
| RPC 模式 | JSONL over stdio，供 IDE/外部驱动 | pi `modes/rpc/` |
| 内置工具 | read / bash / edit / write / grep / glob / ls | pi `core/tools/`（精简移植） |
| 配置 | `~/.agentforge/settings.json` + `<cwd>/.agentforge/settings.json` 两级合并 | pi `settings-manager.ts` |
| 项目上下文 | `AGENTS.md`（不叫 CLAUDE.md）注入 system prompt | pi `resource-loader.ts` |
| 模型选择 | 复用 `pi-ai` 的 `getModel`/`ModelRegistry` | pi-ai |

内置工具从 pi `coding-agent/src/core/tools/` 精简移植（read/bash/edit/write 必备，grep/glob/ls 可选）。工具实现遵循 compendium `agent-harness-construction` 的 observation 格式（`status/summary/next_actions/artifacts`）与 error recovery contract。

---

## 6. compendium 方法论 → 模块 落地映射

| compendium skill | 落地模块 | 形态 |
|---|---|---|
| agent-architecture-audit（12层失败模型） | Audit | 模块 + 诊断 skill |
| agent-harness-construction（harness原则） | 贯穿 | 工具/observation 编码规范 |
| continuous-agent-loop / autonomous-loops（循环模式） | cli 工作流 | sequential/continuous-PR/RFC-DAG 模式 |
| ralphinho-rfc-pipeline | cli 工作流（高级） | RFC-DAG：worktree + 分层管线 + merge queue |
| santa-method | Verification | 模块（核心） |
| verification-loop | Verification | 确定性阶段（build/lint/test） |
| agent-eval | eval 包 | 后期 |
| agent-introspection-debugging | skill | 自调试 skill |
| continuous-learning-v2 | Instinct | 模块 |
| ck | Session | 持久化思想 |
| context-budget | ContextBudget | 模块 |
| strategic-compact | Compaction | 阶段边界策略 |
| safety-guard | Safety | 模块 |
| agent-sort | Skills | DAILY/LIBRARY 分类 |
| skill-stocktake / skill-comply | Skills | skill 运维 |
| architecture-decision-records | ADR | 模块 |
| council | skill | 四声决策 skill |
| plan-orchestrate | cli（subagent chain） | 思想保留，命名空间机制抛弃 |

---

## 7. compendium 剥离清单（不围绕 Claude Code）

**保留并移植**（agent-agnostic）：agent-architecture-audit、agent-harness-construction、continuous-agent-loop/autonomous-loops 的模式谱系、ralphinho-rfc-pipeline、verification-loop、santa-method、agent-eval、agent-introspection-debugging、context-budget、strategic-compact、continuous-learning-v2、safety-guard、agent-sort、architecture-decision-records、council。

**剥离或改造**（Claude Code 耦合）：
- `agentic-os`（CLAUDE.md kernel + `claude -p`）→ 改造为 `AGENTS.md` + cli RPC 模式。
- `autonomous-agent-harness`（Claude Code crons/dispatch/computer-use MCP）→ 外部 cron + cli `-p`/RPC。
- `plan-orchestrate`（`/orchestrate` + plugin namespace 探测）→ 抛弃命名空间，保留 plan→subagent chain 思想。
- `team-builder`（`claude agents` 命令）→ agentforge agent 目录发现。
- `dmux-workflows`（tmux + claude code）→ 保留 worktree 隔离思想。
- `claude-devfleet`（MCP）→ subagent 扩展替代。
- `skill-stocktake`/`skill-comply`（`~/.claude/skills` 路径）→ 改为 `~/.agentforge/skills`。
- `token-budget-advisor`（Claude Code 特定）→ 思想融入 ContextBudget。
- `prompt-optimizer`（Claude Code prompt）→ 可选保留为 skill。

---

## 8. 开发路线图（vertical slices）

每个 slice 端到端可运行，先链路后能力。

**Slice 0 — 最小可运行链路**（验证 pi 核心 + 自写 harness 骨架 + CLI）
- 依赖 `pi-ai` + `pi-agent-core` 核心 `Agent`
- 自写 `shared` 类型 + `Session`（内存 + JSONL）+ `Events`（最小总线）
- `cli`：REPL + print 两模式，内置 read + bash 两工具
- 跑通：对话 → 工具调用 → 持久化 → 恢复
- 验证 pi 核心 hook 挂载点（beforeToolCall/afterToolCall/transformContext）可用

**Slice 1 — 上下文治理**：Compaction（阶段边界）+ ContextBudget（审计）+ Skills（DAILY/LIBRARY）

**Slice 2 — 安全**：Safety（allow/deny/ask + freeze）挂 beforeToolCall；补 edit/write/grep/glob 工具

**Slice 3 — 对抗验证**：Verification（santa 双 reviewer + fix loop）+ RPC 模式（供 subagent spawn）

**Slice 4 — 学习**：Instinct（observe + extract + apply + project scope）

**Slice 5 — 诊断与决策**：Audit（12 层）+ ADR + council skill

**Slice 6 — 循环模式**：continuous-PR（SHARED_TASK_NOTES 桥）+ RFC-DAG（worktree + merge queue）

**Slice 7 — 评测**：eval 包（agent-eval head-to-head）

Slice 0 是关键里程碑——它证明"pi 核心 + 自写 harness"链路成立，后续 slice 都是往 harness 叠 compendium 模块。

---

## 9. 关键接口 sketch

harness 如何包装 pi 核心 Agent：

```ts
import { Agent, type AgentState, type AgentTool } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";

class AgentForgeHarness {
  private agent: Agent;
  private session: SessionStore;
  private events: EventBus;
  private safety: SafetyGuard;
  // ...其他模块

  constructor(opts: HarnessOptions) {
    this.session = opts.session;
    this.events = createEventBus();
    this.safety = opts.safety;

    this.agent = new Agent({
      initialState: {
        systemPrompt: opts.systemPrompt,
        model: getModel(opts.provider, opts.model),
        tools: opts.tools,
        messages: this.session.rebuild(),
      },
      convertToLlm: convertToLlmDefault,
      transformContext: async (msgs) => this.compaction.maybeCompact(msgs),
      beforeToolCall: async (ctx) => this.safety.check(ctx.toolCall, ctx.args) === "deny"
        ? { block: true, reason: "safety" } : undefined,
      afterToolCall: async (ctx) => { this.events.emit({ type: "tool_result", ... }); },
    });

    // pi Agent 事件 → harness EventBus
    this.agent.subscribe((e) => this.events.emit(adapt(e)));
    // 消费者挂载
    this.instinct?.subscribe(this.events);
    this.auditor?.subscribe(this.events);
  }

  async prompt(input: string) {
    await this.agent.prompt(input);
    await this.session.appendMessages(this.agent.state.messages);
  }
}
```

工具定义（遵循 compendium observation 格式）：

```ts
const readTool: AgentTool = {
  name: "read",
  label: "Read",
  description: "Read a file",
  parameters: Type.Object({ path: Type.String() }),
  execute: async (id, params, signal, onUpdate) => {
    const content = await fs.readFile(params.path, "utf-8");
    return {
      content: [{ type: "text", text: content }],
      details: { path: params.path, size: content.length },  // 不进 LLM，供 UI/audit
    };
  },
};
```

---

## 10. 与 pi 上游的关系

- **依赖**：`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`（核心 Agent/agentLoop，不含 harness）。lockstep 跟随 pi 版本。
- **不 fork pi 核心**：pi 核心作为 npm 依赖，不复制源码。agentforge 只拥有 harness + cli 层源码。
- **pi harness 作蓝本**：自写 harness 时参考 pi `harness/` 的实现思路（Session/compaction/skills），但不直接复用代码——因为要内建 compendium 方法论。
- **MIT 兼容**：pi MIT，agentforge 可自由依赖与参考。
- **上游风险**：pi 核心 `Agent`/`agentLoop` 的 hook 接口若 breaking，agentforge harness 要同步适配。锁版本 + minor 升级时审查 changelog。

---

## 11. 待定问题

- REPL 终端 UI：用 `pi-tui`（成熟但重）还是自写轻量 ink-style？Slice 0 先用最简 readline，Slice 1+ 决定。
- subagent spawn 形态：RPC 模式（独立进程）还是 in-process Agent 实例？Slice 3 决定。
- instinct 后台分析进程：独立 node 进程还是 in-process 低频任务？Slice 4 决定。
- 是否需要 `@agentforge/ai-extra`（pi-ai 之上的自定义 provider/模型补充）？暂不需要，直接用 pi-ai。
