---
layout: home
hero:
  name: AgentForge
  text: TypeScript Agent 框架
  tagline: 10 阶段 Pipeline 驱动，多智能体编排，16 内置工具，从原型到生产一站完成
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
    details: 10 阶段处理器管线，每个阶段同时是业务扩展点、可观测性 Span 和 Hook 拦截点。支持 preLoop / loop / postLoop 三段编排，abort / retry / suspend / error 四种控制流，开发者可精确掌控 Agent 的完整生命周期。
  - icon: 🤖
    title: 多智能体编排
    details: Sequential 顺序链式、Parallel 并行聚合、Router 动态路由——三种编排模式自由混搭，声明式管道构建复杂工作流。原生 A2A 协议支持 Agent 间互联与协作。
  - icon: 🔧
    title: 16 内置工具 + MCP 协议
    details: File、Web、System、Utility、Memory 五大类内置工具开箱即用。通过 MCP 协议连接外部工具生态，子 Agent 可直接作为工具调用，能力无限扩展。
  - icon: 🧠
    title: 多 Provider 统一接入
    details: 一套接口适配 OpenAI、Anthropic、Google、DeepSeek 及任意 OpenAI 兼容端点。Gateway Chain 优先匹配 + CompatRule 双模式兼容 + Fallback 多模型降级链，生产级容错。
  - icon: 🛡️
    title: 15+ 生产级插件
    details: Memory 记忆、Compression 压缩、Permission 权限、Skill 技能发现、MCP 工具桥接、Eviction 大内容驱逐、Validation 输出校验等。HarnessAPI 5 子接口，1 行代码注册插件。
  - icon: 📋
    title: 任务队列与并发控制
    details: 长时间运行任务支持优先级排队、可命名并发槽、自动检查点恢复。TaskManager 异步子 Agent 启动/查询/取消，FallbackModel 降级保障。
  - icon: 💾
    title: 会话持久化与恢复
    details: Suspend / Resume 暂停恢复 + Checkpoint 检查点 + File / SQLite 双存储后端。11 种事件类型完整回放，树形分支支持，专为 HITL 人机协作工作流设计。
  - icon: 📡
    title: 全链路可观测性
    details: EventBus 发布订阅 + Hook 9 拦截点 + Span 树形链路追踪。OpenTelemetry 桥接、OTLP 安全导出、W3C Trace Context 传播、Studio UI 仪表盘，生产环境透明运行。
---
