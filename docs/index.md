---
layout: home
hero:
  name: AgentForge
  text: 生产级 Agent 框架
  tagline: 基于 RxJS 事件流 + Zod 类型安全的 Agent 框架
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
      link: https://github.com/your-org/agentforge

features:
  - icon: 🔄
    title: RxJS 事件流
    details: 基于 Observable 的异步事件流架构，支持背压控制和取消机制，天然处理复杂的异步场景。

  - icon: 🛡️
    title: Zod 类型安全
    details: 所有事件和状态均使用 Zod schema 定义，编译时类型检查 + 运行时校验双保险。

  - icon: 🔌
    title: 插件系统
    details: 拦截器插件可修改事件，观察者插件可监控事件，横向扩展能力强大。

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

  - icon: 📊
    title: 生产就绪
    details: 内置配额控制、日志插件、指标收集，开箱即用的生产级功能。
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #bd34fe 30%, #47cf73);
  --vp-home-hero-image-background-image: linear-gradient(-45deg, #bd34fe 50%, #47cf73 50%);
  --vp-home-hero-image-filter: blur(44px);
}
</style>
