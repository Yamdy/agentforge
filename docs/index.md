---
layout: home
hero:
  name: AgentForge
  text: TypeScript Agent 框架
  tagline: Pipeline 驱动，安全自修改，三层认知记忆，从原型到生产一站完成
  actions:
    - theme: brand
      text: 快速开始
      link: /getting-started
    - theme: alt
      text: API 参考
      link: /api-reference
features:
  - icon: ⚙️
    title: Pipeline 驱动的智能体引擎
    details: 10 阶段处理器管线，每个阶段同时是业务扩展点、可观测性 Span 和 Hook 拦截点。支持 preLoop / loop / postLoop 三段编排，abort / retry / suspend / error 四种控制流，运行时可变性支持 frozen / configurable / hot-reload 三档。
  - icon: 🛡️
    title: 安全自修改体系
    details: Constitution 宪法引擎（L0-L4 风险分级 + 保护路径）→ Verification Gate 四门验证 → Mutation Budget 变异配额 → DegenerationWatchdog 健康看门狗。Agent 可安全修改自身行为，三层防线确保不失控。
  - icon: 🧠
    title: 三层认知记忆
    details: Episodic 情景记忆（事件流）+ Semantic 语义记忆（知识图谱）+ Working 工作记忆（当前上下文），模拟人类认知三层架构。InMemory + SQLite 双存储，向量嵌入可扩展。
  - icon: 🤖
    title: 多智能体编排
    details: Sequential 顺序链式、Parallel 并行聚合、Router 动态路由——三种编排模式自由混搭，声明式管道构建复杂工作流。原生 A2A 协议支持 Agent 间互联与协作。
  - icon: 🔧
    title: 16 内置工具 + MCP 协议
    details: File、Web、System、Utility、Memory 五大类内置工具开箱即用。通过 MCP 协议连接外部工具生态，子 Agent 可直接作为工具调用，能力无限扩展。
  - icon: 🔌
    title: 18+ 生产级插件
    details: Memory 记忆、Compression 压缩、Permission 权限、Skill 技能发现、MCP 工具桥接、Eviction 驱逐、Validation 校验、PII 检测、Moderation 审核、CircuitBreaker 熔断等。HarnessAPI 5 子接口，1 行代码注册插件。
  - icon: 🏗️
    title: 生产韧性模式
    details: CircuitBreaker 熔断器（closed/open/half_open）、Runner 结构化并发、Latch 倒计时门闩、SnapshotService 文件审计回滚。生产环境级联故障防护。
  - icon: 💾
    title: 会话持久化与恢复
    details: Suspend / Resume 暂停恢复 + Checkpoint 检查点 + File / SQLite 双存储后端。11 种事件类型完整回放，树形分支支持，专为 HITL 人机协作工作流设计。
  - icon: 📡
    title: 全链路可观测性
    details: EventBus 发布订阅 + Hook 9 拦截点 + Span 树形链路追踪。OpenTelemetry 桥接、OTLP 安全导出、W3C Trace Context 传播、Studio UI 仪表盘，生产环境透明运行。
---
