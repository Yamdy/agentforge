# ECC Agent Architecture Index

> 生成时间：2026-06-21
> 范围：本机 `everything-claude-code / ecc` skills 中与 agent 架构、自治循环、编排、验证、记忆、上下文预算相关的材料

## 目的

这是一份后续研究索引，不是定论。目标是把 ECC 里和 agent 架构有关的材料按主题收拢，方便之后：

- 继续读原文
- 做对比研究

- 找出哪些模式值得借鉴，哪些更适合只保留为参考

## 主题分组

### 1. 核心架构

- [agent-architecture-audit](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-architecture-audit/SKILL.md)
- [agent-harness-construction](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-harness-construction/SKILL.md)
- [agentic-os](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agentic-os/SKILL.md)
- [autonomous-agent-harness](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/autonomous-agent-harness/SKILL.md)
- [agentic-engineering](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agentic-engineering/SKILL.md)
- [ai-first-engineering](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/ai-first-engineering/SKILL.md)

### 2. 自治循环与多 Agent 编排

- [continuous-agent-loop](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/continuous-agent-loop/SKILL.md)
- [autonomous-loops](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/autonomous-loops/SKILL.md)
- [ralphinho-rfc-pipeline](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/ralphinho-rfc-pipeline/SKILL.md)
- [plan-orchestrate](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/plan-orchestrate/SKILL.md)
- [team-builder](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/team-builder/SKILL.md)
- [dmux-workflows](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/dmux-workflows/SKILL.md)
- [claude-devfleet](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/claude-devfleet/SKILL.md)
- [council](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/council/SKILL.md)

### 3. 验证、评测、对抗审查

- [agent-eval](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-eval/SKILL.md)
- [verification-loop](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/verification-loop/SKILL.md)
- [santa-method](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/santa-method/SKILL.md)
- [agent-introspection-debugging](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-introspection-debugging/SKILL.md)
- [skill-comply](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/skill-comply/SKILL.md)
- [skill-stocktake](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/skill-stocktake/SKILL.md)

### 4. 记忆、学习、上下文治理

- [continuous-learning-v2](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/continuous-learning-v2/SKILL.md)
- [ck](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/ck/SKILL.md)
- [context-budget](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/context-budget/SKILL.md)
- [strategic-compact](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/strategic-compact/SKILL.md)
- [token-budget-advisor](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/token-budget-advisor/SKILL.md)

### 5. 安全、审计、安装面裁剪

- [safety-guard](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/safety-guard/SKILL.md)
- [workspace-surface-audit](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/workspace-surface-audit/SKILL.md)
- [automation-audit-ops](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/automation-audit-ops/SKILL.md)
- [agent-sort](file:///C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-sort/SKILL.md)

### 6. 架构辅件

- [architecture-decision-records](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/architecture-decision-records/SKILL.md)
- [prompt-optimizer](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/prompt-optimizer/SKILL.md)

## 先读顺序

1. [agent-architecture-audit](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-architecture-audit/SKILL.md)
2. [agent-harness-construction](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-harness-construction/SKILL.md)
3. [autonomous-agent-harness](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/autonomous-agent-harness/SKILL.md)
4. [autonomous-loops](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/autonomous-loops/SKILL.md)
5. [ralphinho-rfc-pipeline](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/ralphinho-rfc-pipeline/SKILL.md)
6. [santa-method](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/santa-method/SKILL.md)
7. [continuous-learning-v2](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/continuous-learning-v2/SKILL.md)
8. [context-budget](C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/context-budget/SKILL.md)

## 关键观察

- ECC 不是单一“agent 框架”，而是一组围绕 Claude Code 运行时拼出来的操作模型。
- 最重要的分层是：harness、tool discipline、memory、orchestration、verification、ops guardrails。
- 很多 skill 的价值不在实现代码，而在把边界说清楚：什么该自动化，什么必须验证，什么只能作为 library。
- `autonomous-loops` 和 `continuous-agent-loop` 是同一条线的旧版/新版。
- `santa-method` 的双审/对抗验证思路值得深入研究。
- `context-budget`、`strategic-compact`、`token-budget-advisor` 说明上下文治理本身是架构问题。
- `agent-sort`、`workspace-surface-audit`、`automation-audit-ops` 说明“装什么、不装什么”也是架构的一部分。

## 待验证问题

- 应该吸收哪些模式，哪些只保留为参考资料？
- 哪些能力适合写成 skill，哪些适合进 core runtime？
- 记忆层要不要走文件型、事件型，还是混合型？
- 多 agent 编排是否需要 DAG/merge queue，还是保持简单顺序执行？
- 上下文预算和裁剪是否要做成强制门禁？
- 对抗验证应当固定成哪种 review 拓扑？

## 备注

后续如果要继续研究，可以把新发现追加到这里，或者把某个主题单独拆成更细的研究笔记。
