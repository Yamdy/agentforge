# Development Plans

> 开发计划文档 - 功能实现计划与实施路线图
> 最后更新: 2026-05-02

---

## 活跃计划

| 文档 | 描述 | 状态 |
|------|------|------|
| [2026-04-26-create-agentforge-cli.md](./2026-04-26-create-agentforge-cli.md) | create-agentforge CLI 实施计划 | 📝 待实施 |
| [deepagents-features-design.md](./deepagents-features-design.md) | DeepAgents 特性设计参考 | 📝 设计参考 |
| [mastra-dx-features-design.md](./mastra-dx-features-design.md) | Mastra DX 特性设计参考 | 📝 设计参考 |
| [p2-capabilities-design-v2.md](./p2-capabilities-design-v2.md) | P2 能力设计 v2 | 📝 设计参考 |
| [positioning-review.md](./positioning-review.md) | 定位评审 | 📝 战略文档 |
| [final-implementation-plan.md](./final-implementation-plan.md) | 最终实施计划 | 📝 待评估 |

## 已完成并归档

以下计划已执行完毕，移至 `docs/archive/implemented/`：

| 文档 | 说明 |
|------|------|
| `p0-design.md` | P0 设计方案：Google/Ollama 适配器 + 记忆持久化 |
| `p1-http-design.md` | P1 设计方案：HTTP 适配器实现 |
| `AUDIT-FIX-PLAN.md` | 设计符合性审计修复计划 |
| `2026-04-27-studio-phase0.md` | Studio Phase 0: SSE Bridge |
| `2026-04-27-mcp-integration.md` | MCP Client 集成 |
| `2026-04-27-mpu-wiring.md` | MPU Dead Slots 接线 |

---

## 优先级

- **P0**: ~~核心缺失 - LLM Adapter、MCP Client、Git Hooks~~ ✅ 全部完成
- **P1**: 多 Agent 协作 - SubAgent、MsgHub、Pipeline
- **P2**: 生产力增强 - Planning Phase 2（计划注入 State）、Filesystem、Summarization
- **P3**: 可观测性 - OTel、Metrics SDK 导出
