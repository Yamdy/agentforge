# Skill Discovery Enhancement

## Problem
Agent 开发者无法配置自定义技能目录，且 AgentForge 不兼容 Claude Code/Agents 生态的 `~/.agents/skills/` 通用目录，导致无法复用已有技能生态，也难以对接公司内部文件系统托管的技能市场。

## Evidence
- Assumption — 需要通过用户研究验证痛点
- 对标依据：OpenCode 已实现 `skills.paths` 配置和多目录兼容
- 预判场景：公司内部技能市场需要统一托管技能文件

## Users
- **Primary**: Agent 开发者 — 需要复用通用技能、配置项目特定技能路径、对接内部技能市场
- **Not for**: 终端用户（不直接操作技能配置）

## Hypothesis
我们相信 **实现配置路径灵活性 + ~/.agents 兼容** 将 **满足 agent 开发者共享技能和对接内部技能市场的需求**。
我们将知道这是对的当 **开发者能够通过配置指定额外技能目录，且自动发现 ~/.agents/skills/ 下的技能**。

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| 配置路径生效 | 100% | 测试用例验证 `skills.paths` 配置的目录被扫描 |
| 兼容目录发现 | 100% | 测试用例验证 `~/.agents/skills/` 目录被扫描 |
| 向后兼容 | 100% | 现有 `.agentforge/skills/` 行为不变 |

## Scope
**MVP** — 配置路径灵活性 (`skills.paths`) + 生态目录兼容 (`~/.agents/skills/`)

**Out of scope**
- npm 包自动发现 (`agentforge-plugin-*`) — 暂无需求
- 热重载 — 暂无需求
- HTTP 远程发现 (`skills.urls`) — 暂无需求，文件系统共享已足够
- 技能市场 UI — 非框架职责
- 技能版本管理 — 暂无需求

## Delivery Milestones
| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | 配置路径支持 | 开发者可通过 `skills.paths` 配置额外技能目录 | complete | 已实现于 `config-loader.ts:116` |
| 2 | 生态目录兼容 | 自动扫描 `~/.agents/skills/` 和 `~/.claude/skills/` | complete | 已实现于 `resolveSkillDirectories` |
| 3 | 文档更新 | 更新 CLAUDE.md 和相关文档说明新配置项 | complete | CLAUDE.md: Skill Discovery section |

## Open Questions
- 无

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 与 OpenCode 配置格式不一致 | Low | Low | 保持语义一致，格式可略有差异 |
| 目录权限问题 | Low | Medium | 扫描时优雅处理无权限目录 |

---
*Status: COMPLETE — all milestones delivered.*
