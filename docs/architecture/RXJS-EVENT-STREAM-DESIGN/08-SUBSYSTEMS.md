# 子系统扩展

> 本文档定义 AgentForge 的子系统扩展模型，包括 SubAgent 委托、MCP 工具、Workflow 编排和 Skill 知识包的统一处理。

---

## 核心问题：嵌套 Observable

Agent Loop 执行 `tool.call` 时，可能是：

- **本地工具**: 同步执行 `tool.execute(args)`
- **Subagent 委托**: 嵌套的 `Observable<AgentEvent>`
- **MCP 工具**: 远程 JSON-RPC 调用

三种模式需要统一为事件流。

---

## 统一模型：嵌套流展平

```typescript
private handleToolCall(event: AgentEvent, state: AgentState, ctx: AgentContext): Observable<AgentEvent> {
  const call = event as Extract<AgentEvent, { type: 'tool.call' }>;

  // 1. Subagent 委托
  if (ctx.subagents?.has(call.toolName)) {
    return concat(
      // Layer 2 事件：subagent 生命周期
      of({
        type: 'subagent.start',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        subagentName: call.toolName,
        input: call.args,
      }),

      // 嵌套流：所有事件冒泡到父级（带上下文标记）
      ctx.subagents.run(call.toolName, call.args.input).pipe(
        map((e) => ({
          ...e,
          // 标记来源，用于追溯
          parentId: call.toolCallId,
          parentSessionId: ctx.sessionId,
        })),
      ),

      // Layer 2 事件：subagent 完成
      of({
        type: 'subagent.complete',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        subagentName: call.toolName,
        output: '...', // 从嵌套流的最后事件获取
      }),
    );
  }

  // 2. MCP 工具
  if (ctx.mcp && isMcpTool(call.toolName)) {
    return concat(
      of({ type: 'tool.execute', ...call }),

      // MCP 调用（可能超时）
      defer(() => ctx.mcp!.callTool(call.toolName, call.args)).pipe(
        timeout(ctx.mcp!.options?.timeout ?? 30000),
        map((result) => ({
          type: 'tool.result',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          result,
          isError: false,
        })),
        catchError((error) => of({
          type: 'tool.error',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          error,
        })),
      ),
    );
  }

  // 3. 本地工具
  return concat(
    of({ type: 'tool.execute', ...call }),

    defer(() => ctx.tools.execute(call.toolName, call.args)).pipe(
      // 流式工具结果（如 bash 长输出）
      mergeMap((result) => {
        if (typeof result === 'string') {
          return of({
            type: 'tool.result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            result,
          });
        }
        // 如果工具返回 Observable，逐块发送
        if (result instanceof Observable) {
          return result.pipe(
            map((chunk) => ({
              type: 'tool.result.delta',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              delta: chunk,
            })),
            // 最后发送完整结果
            last(),
            map((final) => ({
              type: 'tool.result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              result: final,
            })),
          );
        }
        return of({
          type: 'tool.result',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          result: JSON.stringify(result),
        });
      }),
      catchError((error) => of({
        type: 'tool.error',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        error,
      })),
    ),
  );
}
```

---

## Workflow 作为高层抽象

Workflow 不是 Agent Loop 内部机制，而是 Agent 之上的编排层。每个 step 内部调用 `agent.run()`，事件冒泡到顶层。

```typescript
// Workflow 执行时的事件流
const workflow$ = workflow.run({ topic: 'AI' }).pipe(
  // 过滤 workflow 层事件 + 嵌套的 agent 事件
  filter((e) => e.type.startsWith('workflow.') || e.type.startsWith('agent.')),
  tap(tracer.record),
);

// Workflow step 内部
class WorkflowExecutor {
  async executeStep(step: WorkflowStep, input: unknown): Promise<unknown> {
    // 发出 workflow.step.start 事件
    this.emit({ type: 'workflow.step.start', stepId: step.id, input });

    // 调用 Agent（嵌套流）
    const result = await firstValueFrom(
      this.agent.run(step.prompt(input)).pipe(
        filter((e) => e.type === 'agent.complete'),
        map((e) => e.output),
      ),
    );

    // 发出 workflow.step.end 事件
    this.emit({ type: 'workflow.step.end', stepId: step.id, output: result });

    return result;
  }
}
```

---

## Skill 作为知识包

> ⚠️ **重要修正**：Skill 不是"执行子系统"，也不是"Tool 包装"。Skill 是**可复用的知识包**，提供领域特定指令和工作流模板。

### 行业标准定义

经过对 Semantic Kernel、CrewAI、LangChain、PraisonAI 等框架的研究，行业共识为：

| 框架 | Skill 定义 |
|------|-----------|
| **Semantic Kernel** | 改名为 **Plugin** = 函数集合，是 Tool 分组 |
| **CrewAI** | **Prompt 注入** = markdown 指令，修正 Agent 行为 |
| **LangChain** | **动态加载的专家知识**，通过 `load_skill` 工具访问 |
| **PraisonAI/Qwen-Code** | **SKILL.md 知识包**，静态文件 + frontmatter |

**核心共识**：Skill 是**知识载体**，不执行代码，不编排流程。

### 正确的层次定位

```
┌─────────────────────────────────────────────────────────────────┐
│                          AGENT                                  │
│                    (目标驱动的编排器)                            │
│   - 理解目标，规划步骤                                           │
│   - 调用工具执行操作                                             │
│   - 加载技能获取知识                                             │
│   - 委托子代理处理子任务                                         │
└─────────────────────────────────────────────────────────────────┘
                  │                    │                    │
         ┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐
         ▼                 ▼  ▼                 ▼  ▼                 ▼
    ┌─────────┐      ┌──────────┐      ┌─────────────┐
    │  TOOL   │      │  SKILL   │      │  SUBAGENT   │
    │ 原子操作 │      │ 知识包    │      │ 子代理      │
    ├─────────┤      ├──────────┤      ├─────────────┤
    │ 可执行   │      │ 静态文件  │      │ 嵌套 Agent  │
    │ 确定性   │      │ 指导性    │      │ 可递归      │
    │ 无状态   │      │ 按需加载  │      │ 独立上下文  │
    └─────────┘      └──────────┘      └─────────────┘

关键区别：
- Tool 是「手」：执行具体操作
- Skill 是「脑的知识」：指导如何使用手（引用 Tool 在其指令中）
- SubAgent 是「助手」：能独立完成子任务（有 LLM，可执行）
```

### Skill 接口定义

```typescript
// src/skill/types.ts

/** Skill 元数据（来自 SKILL.md frontmatter） */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  version: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  
  /** 允许使用的工具（可选约束） */
  allowedTools: z.array(z.string()).optional(),
  
  /** 触发关键词（用于自动发现） */
  triggers: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  
  /** 兼容性标记 */
  compatibility: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** Skill 完整信息 */
export interface SkillInfo {
  frontmatter: SkillFrontmatter;
  /** SKILL.md 的 Markdown 内容（指令部分） */
  content: string;
  /** 文件路径 */
  location: string;
  /** 最后更新时间 */
  updatedAt: Date;
}
```

### Skill 文件格式（行业标准）

采用 Anthropic 定义的 **SKILL.md** 格式：

```markdown
---
name: git-release
description: Create consistent git releases with changelogs
version: "1.0"
author: agentforge-team
license: MIT
allowed-tools:
  - bash
  - read
  - write
triggers:
  - release
  - changelog
keywords:
  - git
  - version
  - semver
---

# Git Release Skill

## 工作流程

当创建一个新版本发布时：

1. **验证版本号**
   - 使用 `read` 工具检查 package.json 中的版本
   - 确保版本号符合 semver 规范

2. **生成变更日志**
   - 使用 `bash` 工具运行 `git log --oneline v<prev>..HEAD`
   - 按类型分类变更（feat/fix/docs/refactor）

3. **创建标签**
   - 使用 `bash` 工具运行 `git tag -a v<version> -m "..."`
   - 推送标签到远程

4. **更新 CHANGELOG.md**
   - 使用 `write` 工具更新变更日志文件

## 注意事项

- 遵循 Conventional Commits 规范
- 检查是否有未提交的更改
- 确保所有测试通过
```

---

## 事件冒泡规则

| 子系统事件 | 冒泡行为 |
|----------|---------|
| `agent.*` (嵌套) | 直接冒泡，加 `parentSessionId` |
| `subagent.*` | 在嵌套 agent 事件外层包裹 |
| `mcp.*` | 不冒泡，仅在 MCP 客户端内部 |
| `workflow.*` | 直接冒泡，嵌套的 agent 事件加 `workflowId` |
| `skill.*` | 不产生事件流事件；加载结果注入 Agent 上下文 |
| `compaction.*` | 不冒泡，内部操作 |
| `permission.*` | 不冒泡，内部操作（但可通过 HITL 暴露） |

> ⚠️ **注意**：Skill 不是执行子系统，不产生低延迟事件流事件。`load_skill` 工具的返回是同步的知识内容注入。

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 核心类型定义
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束
