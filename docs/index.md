---
layout: home
hero:
  name: AgentForge
  text: The Harness Engine for Production AI Agents
  tagline: 审计、沙箱、熔断、配额 — 不是新的 Agent 框架，是包裹你现有 Agent 的安全层。事件驱动 + Zod 类型安全。
  image:
    src: /logo.svg
    alt: AgentForge
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: API 参考
      link: /api/
    - theme: alt
      text: GitHub
      link: https://github.com/Yamdy/agentforge

features:
  - icon: 🎯
    title: Agent Harness 架构
    details: 模型是认知决策核心，框架是工程管控基座。所有 Agent 行为必须经过 Harness 管控，不可绕过。

  - icon: 🔄
    title: 事件驱动架构
    details: 基于 AgentEventEmitter 的命令式事件驱动，while(true) 循环 + Hook 切面，可观测、可中断、可恢复。

  - icon: 🛡️
    title: Zod 类型安全
    details: 所有事件和状态均使用 Zod schema 定义，编译时类型检查 + 运行时校验双保险。

  - icon: 🔌
    title: Hook 系统
    details: RequestHook/ToolHook/LifecycleHook 三层切面，异常隔离不穿透主循环。

  - icon: 📦
    title: 轻量依赖注入
    details: 无 IoC 容器，通过闭包注入依赖，简洁可控，符合函数式编程思想。

  - icon: 🔄
    title: 状态机管理
    details: 6 状态生命周期 (pending/running/paused/completed/error/cancelled)，状态转换可追溯。

  - icon: 🔧
    title: MCP 协议支持
    details: 内置 Model Context Protocol 客户端，支持 stdio/HTTP/SSE 传输层。

  - icon: 🤖
    title: 子 Agent 支持
    details: 支持嵌套 Agent 执行，子 Agent 错误隔离，事件流可追溯。

  - icon: 🔒
    title: Harness 安全防护
    details: 沙箱隔离、安全守卫、熔断器、配额控制、审计链 — 5 层防护让 Agent 行为可控、可追溯。

  - icon: 📊
    title: 生产就绪
    details: 内置配额控制、日志插件、指标收集，开箱即用的生产级功能。

  - icon: ⚡
    title: 零配置 Demo
    details: 运行 `npx agentforge demo` 在 30 秒内看到所有 Harness 防护的实际效果。无需 API Key。
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #bd34fe 30%, #47cf73);
  --vp-home-hero-image-background-image: linear-gradient(-45deg, #bd34fe 50%, #47cf73 50%);
  --vp-home-hero-image-filter: blur(44px);
}
</style>
