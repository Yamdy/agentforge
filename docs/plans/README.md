# Development Plans

> 开发计划文档 - 功能实现计划与实施路线图

---

## 文档列表

| 文档 | 描述 | 状态 |
|------|------|------|
| [p0-design.md](./p0-design.md) | P0 设计方案：Google/Ollama 适配器 + 记忆持久化 | ✅ 已完成（Google/Ollama 适配器已用 AI SDK v6 实现） |
| [p1-http-design.md](./p1-http-design.md) | P1 设计方案：HTTP 适配器实现 | ✅ 已完成（packages/server/ 完整实现） |
| [AUDIT-FIX-PLAN.md](./AUDIT-FIX-PLAN.md) | 设计符合性审计修复计划 | ✅ 已完成 |
| [2026-04-27-studio-phase0.md](./2026-04-27-studio-phase0.md) | Studio Phase 0: SSE Bridge 实施计划 | ✅ 已完成（packages/server/ 含 server/router/handlers/middleware/openapi） |
| [2026-04-27-mcp-integration.md](./2026-04-27-mcp-integration.md) | MCP Client 集成实施计划 | ✅ 已完成（createAgent 已接入，stdio/HTTP 传输双实现） |
| [2026-04-27-mpu-wiring.md](./2026-04-27-mpu-wiring.md) | MPU Dead Slots 接线计划 | ✅ 已完成（circuitBreaker/rateLimiter/inputSanitizer/permissionPolicy/permissionController/sandboxExecutor/planner/pluginPipeline/productionPreset/errorClassifier 均已接线） |
| [2026-04-26-create-agentforge-cli.md](./2026-04-26-create-agentforge-cli.md) | create-agentforge CLI 实施计划 | 📝 待实施 |

---

## 优先级

- **P0**: ~~核心缺失 - LLM Adapter、MCP Client、Git Hooks~~ ✅ 全部完成
- **P1**: 多 Agent 协作 - SubAgent、MsgHub、Pipeline
- **P2**: 生产力增强 - Planning Phase 2（计划注入 State）、Filesystem、Summarization
- **P3**: 可观测性 - OTel、Metrics SDK 导出
