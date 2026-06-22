# ADR-0001: 待定问题决策批次(2026-06-22)

- **Status**: Accepted
- **Date**: 2026-06-22
- **Context**: ARCHITECTURE.md §11 + Slice 1 handoff §7 列出的待定问题,经讨论定下落点

本 ADR 一次性记录 6 条关联决策(均关于"形态选择 / 启用时机")。每条独立,未来可被新 ADR supersede。决策基于 ARCHITECTURE.md 规划 + Slice 0/1 实际代码状态(119 测试绿,commit `a8692e5`+`f2dea40` 未 push)。

---

## ADR-0001a: REPL 终端 UI — 自写 readline 逐行,不引 pi-tui

**Context**: ARCH §5/§11 列 REPL UI 为待定(pi-tui 成熟但重 vs 自写轻量)。实际 `cli/src/index.ts:40` 当前是 readline 批处理(收集所有行,EOF 后一次性驱动 `runReplMode`),非逐行交互,看不到流式输出。

**Decision**: Slice 2 顺手把 readline 改逐行驱动(每读一行 → `harness.prompt` → 输出),不引入 pi-tui。pi-tui 推到 Slice 5+。

**Alternatives**: 引入 pi-tui(Slice 1+)——否决:重(ink/React 生态 + pi lockstep),与 ARCH §2/§10"不复用 pi coding-agent 层、自写外壳"原则有张力;当前缺的是逐行+流式而非富 TUI。

**Consequences**: Slice 2 REPL 体验改善(逐行交互);富渲染(spinner/流式 token/多面板)暂缺,`context_budget` 事件等诊断信息暂无 UI 可视化。

**Revisit**: Slice 5 Audit 诊断 UI 需多面板/spinner 时,或自写 readline 渲染力不足时,重新评估引入 pi-tui。

---

## ADR-0001b: subagent spawn — in-process Agent 默认,RPC 作 cli 模式并行建

**Context**: ARCH §4.8/§8 Slice 3 Verification(santa 双 reviewer + fix loop)需 spawn 子 agent;§5 RPC 模式(JSONL over stdio)是 cli 三模式之一。形态待定(RPC 独立进程 vs in-process)。

**Decision**: Slice 3 双轨——in-process 独立 `Agent` 实例作 santa reviewer 默认实现;RPC 模式作 cli 既定能力独立建,顺带支持"spawn 独立 agentforge 进程"作强隔离可选。

**Alternatives**: 直接用 RPC 独立进程做 reviewer——否决:santa 核心是"2 个 reviewer 无共享上下文 + 同 rubric + verdict gate",in-process 两个独立 `new Agent({initialState:{messages:[]}})` 实例已满足无共享上下文,不需进程隔离;进程隔离对应 memory contamination 失败模式,属 Audit §4.9 兜底范畴;RPC 协议(stdio JSONL/子进程生命周期/错误传递)重,先简后繁。

**Consequences**: Slice 3 santa 实现快、可测(同进程 mock streamFn);RPC 模式并行建不阻塞 verifier;强隔离场景暂以 in-process + Audit 兜底。

**Revisit**: 出现 memory contamination 实例,或 reviewer 需跑不同 provider/配置隔离时,切 RPC spawn。

---

## ADR-0001c: instinct 后台分析 — in-process 低频任务,不独立进程

**Context**: ARCH §4.7/§11 Slice 4 Instinct `extract()` 可独立进程或 in-process 低频任务。

**Decision**: in-process 低频任务(setImmediate/空闲钩子)+ 低 tier 模型。

**Alternatives**: 独立 node 进程——否决:`extract` 是低频、可延迟、非主路径的离线分析,in-process 异步即满足(主循环不等它);崩溃隔离 try/catch + 事件兜底;Slice 4 重点应是 instinct 模型(confidence 0.3-0.9 / project scope by git remote hash / trigger→action)而非进程架构;独立进程要管 IPC 传 observations.jsonl + 子进程重启,分散精力。

**Consequences**: Slice 4 实现简化(无 IPC/子进程管理);extract 崩溃不拖垮主进程(异步 + catch);compendium `continuous-learning-v2` 的 hook 100% 观察是 in-process 事件订阅,契合。

**Revisit**: `extract` 变重(跑大模型推理占 CPU)且频繁到影响主进程响应时,切独立进程。

---

## ADR-0001d: budget/compaction cli 启用 — Slice 2 后接通(slice 2.5)

**Context**: `harness/src/harness.ts` 接缝就绪(`compactor`/`compactorDeps`/`modelContextWindow`/`budgetThresholds` 均可选注入,有 TDD 覆盖),但 `cli/src/print-mode.ts:120` 与 `cli/src/repl.ts:123` 构造 harness 时全未传——机制空转,真对话里不生效。

**Decision**: Slice 2 完成后做小接通 slice(2.5):cli 传 `modelContextWindow`(按 provider+model 查 pi-ai ModelRegistry 元数据)+ `compactor`(默认 Compactor + pi-ai streamSimple 做 generateSummary)+ `stageMarkers`(默认 false)。

**Alternatives**: 并入 Slice 2 主体——否决:Slice 2 是 Safety + 4 工具已够重,接通是独立小动作,并入分散。推迟到 Slice 3——否决:长 session 不启用会撞 context window,Slice 1 价值打折。

**Consequences**: 需查 pi-ai ModelRegistry 的 contextWindow 元数据字段名(唯一缺口);Slice 1 机制在真对话生效。

**Revisit**: 接通时若 pi-ai 无 contextWindow 元数据,需硬编码模型表或加 `@agentforge/ai-extra`(见 ADR-0001f)。

---

## ADR-0001e: compaction 阶段边界真实检测 — 分两步

**Context**: Slice 1 用 `stageMarkers` + `isAtStageBoundary` 谓词(默认 false),token 阈值为主触发,偏离 ARCH §4.2"阶段边界触发而非 token 阈值"原文。memory 记"待后续落地真实阶段检测时校准"。

**Decision**: 短期(Slice 2.5 接通 compactor 时)提供显式 stageMarker 机制(agent 通过特定工具调用或 system prompt 约定自报阶段,如 `stage("plan")`),`isAtStageBoundary` 检测该 marker;远期(Slice 5 Audit 后)真实语义阶段推断(research/plan/milestone/debug)复用 Audit §4.9 模式识别。

**Alternatives**: Slice 2 启发式关键词匹配阶段——否决:脆弱(重蹈 proteus 覆辙);compendium `strategic-compact` 的阶段边界决策表需可靠阶段信号。

**Consequences**: 短期有确定性、可测的 marker 机制;真实语义推断推迟到 Audit 就绪后复用,避免重复造模式识别。

**Revisit**: Slice 5 Audit 建成后,评估其模式识别能否支撑阶段推断;若能则落地语义检测并校准 ARCH §4.2 原文。

---

## ADR-0001f: @agentforge/ai-extra — 不建

**Context**: ARCH §11 待定是否需 `@agentforge/ai-extra`(pi-ai 之上的自定义 provider/模型补充)。

**Decision**: 不建。自定义 provider 先用 pi-ai `registerApiProvider` 注册。

**Alternatives**: 预建 ai-extra 包——否决:pi-ai 已内置 30+ provider + DeepSeek 原生 KnownProvider(Slice 0 验证),当前需求全覆盖;预建是过度设计,要跟 pi-ai 版本。

**Consequences**: 减少一个包的维护;自定义 provider 走 `registerApiProvider`。

**Revisit**: pi-ai 不支持的 provider/model 出现,或自定义 provider 多到 `registerApiProvider` 不便管理时,建独立包。

---

## 关联与维护

- 这些决策影响 ARCH §8 路线图 Slice 2-5 的实现形态。
- supersede 本 ADR 任一条时,新建 ADR-000X 并在开头标注 `replaces ADR-0001{x}`。
- memory `agentforge-project-direction.md` 的"待定问题决策"段指向本文件。
- ARCHITECTURE.md §11 的待定问题项可标注"已决策 → 见 ADR-0001{x}"(后续 slice 落地时同步)。
