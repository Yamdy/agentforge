# AgentForge 定位审查

> 审查时间：2026-04-28
> 详细内容见：[analysis_agentforge_gap.md](../analysis/analysis_agentforge_gap.md)

---

## 核心定位

**AgentForge = Agent 开发框架**

| 框架提供 | 开发者决定 |
|---------|-----------|
| 核心引擎、构建块、扩展点 | 业务逻辑、API 设计 |
| LLM 适配器、工具系统、MCP | 消息通道、认证系统 |
| Server 包、中间件工具 | 部署方式、用户界面 |

---

## 设计原则

1. **扩展现有，不创建平行**
2. **DI 注入，不包裹 Agent**
3. **接口实现，不是新接口**
4. **独立包，不是能力模块**

---

## 当前设计文档

| 文档 | 状态 | 说明 |
|------|------|------|
| `p2-capabilities-design-v2.md` | ✅ 有效 | 扩展现有架构的设计 |
| `p1-http-design.md` | ✅ 有效 | Server 包增强设计 |
| `analysis_agentforge_gap.md` | ✅ 有效 | 差距分析（已修正定位） |

---

*详细定位分析和差距评估见 [analysis_agentforge_gap.md](../analysis/analysis_agentforge_gap.md)*
