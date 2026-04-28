# Architecture Documents

> 架构改进设计文档 - 基于框架对比分析的增量改进方案

---

## 文档列表

| 文档 | 描述 |
|------|------|
| [index.md](./index.md) | 架构文档索引 |
| [LLM-IO-IMPROVEMENTS-DESIGN.md](./LLM-IO-IMPROVEMENTS-DESIGN.md) | LLM I/O 改进详细设计 - Memory/History/Skills/Provider |

---

## 设计原则

1. **增量改进** - 不破坏现有 API，复用已有 InterceptorPlugin 系统
2. **事件驱动** - 所有注入通过拦截事件实现
3. **零新增概念** - 不引入 Middleware，用已有 Plugin 系统
