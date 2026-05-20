---
layout: home
hero:
  name: AgentForge
  text: TypeScript Agent 框架
  tagline: 10 阶段 Pipeline + 多智能体编排 + 16 内置工具，从原型到生产一站完成
  actions:
    - theme: brand
      text: 快速开始
      link: /getting-started
    - theme: alt
      text: 特性树
      link: /feature-tree
    - theme: alt
      text: API 参考
      link: /api-reference
features:
  - title: Pipeline 驱动
    details: 10 阶段处理器管线，每个阶段同时是扩展点、观测 Span 和 Hook 拦截点。三段编排（preLoop/loop/postLoop）+ 4 种控制流
  - title: 多智能体编排
    details: Sequential / Parallel / Router 三种编排模式，声明式管道混搭。A2A 协议原生支持 Agent 互联
  - title: 16 内置工具
    details: File、Web、System、Utility、Memory 五大类工具，MCP 协议连接外部工具，子 Agent 可作为工具调用
  - title: 多 Provider
    details: 统一接口支持 OpenAI、Anthropic、Google、DeepSeek 及任意 OpenAI 兼容端点。Gateway Chain + CompatRule + Fallback 降级
  - title: 15+ 生产插件
    details: Memory、Compression、Permission、Skill、MCP、Eviction、Validation 等。HarnessAPI 5 子接口，1 行注册
  - title: 任务队列
    details: 长时间运行任务的并发控制、优先级排序、自动检查点恢复。TaskManager 支持异步子 Agent
  - title: 会话持久化
    details: Suspend/Resume + Checkpoint 恢复 + File/SQLite 双存储。11 种事件类型，支持 HITL 工作流
  - title: 可观测性
    details: EventBus 发布订阅 + Hook 拦截 + Span 链路追踪。OTel 桥接、TraceCollector、Studio UI 仪表盘
---
