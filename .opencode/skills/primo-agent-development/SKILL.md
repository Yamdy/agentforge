---
name: primo-agent-development
description: Primo-Agent 项目开发指导 skill。在新增或修改 primo-agent 项目功能时使用，强调要参考同级目录下的 agentscope、deepsagent、mastra 项目，明确项目定位是 agent 开发框架，基于 opencode 项目实现，运行时也参考 opencode。请务必在 primo-agent 项目开发时使用此 skill。
---

# Primo-Agent 项目开发指导

## 项目定位

- **项目名称**：primo-agent
- **定位**：agent 开发框架
- **基础**：基于 opencode 项目（D:\code\opencode）开发
- **参考项目**：请参考同级目录下的以下项目进行设计和实现：
  - D:\code\agentscope
  - D:\code\deepsagent
  - D:\code\mastra

## 开发原则

1. **特性优先参考 opencode 实现**：在开发新功能时，首先查看 opencode 项目是否有类似功能的实现方式
2. **参考其他 agent 框架**：研究 agentscope、deepsagent、mastra 的设计理念和实现方式
3. **遵循项目既有规范**：严格遵守 primo-agent 项目 AGENTS.md 中定义的开发规范
4. **保持与 opencode 的兼容性**：运行时行为和接口设计要考虑与 opencode 的兼容性

## 关键文件参考

- AGENTS.md：项目开发铁律和规范
- package.json：项目依赖和脚本
- 现有代码结构：遵循既有的代码组织方式

## 开发流程

1. 分析需求并参考 opencode 和其他 agent 框架的实现
2. 遵循 AGENTS.md 中的开发规范
3. 实现功能并确保与项目现有代码风格一致
4. 进行测试验证
