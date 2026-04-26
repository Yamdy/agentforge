# Prompt 构建

> ⚠️ **P0 核心模块**：PromptBuilder 和 Zod → FunctionDefinition 是 Agent Loop 的前置依赖，缺失将导致 LLM 调用无法正常工作。

---

## 1. 架构定位

```
┌─────────────────────────────────────────────────────────────────┐
│                     LLM 调用前置流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ToolRegistry          PromptBuilder            LLMAdapter       │
│       │                      │                       │           │
│       │  ┌───────────────────┼───────────────────────┤           │
│       │  │                   │                       │           │
│       ▼  ▼                   ▼                       ▼           │
│  ┌──────────┐         ┌──────────────┐        ┌────────────┐    │
│  │ Tool[]   │ ──────→ │ buildPrompt()│ ────→  │ chat()     │    │
│  │ (Zod)    │         │              │        │ stream()   │    │
│  └──────────┘         └──────────────┘        └────────────┘    │
│       │                      │                       │           │
│       │         ┌────────────┴────────────┐          │           │
│       │         │                         │          │           │
│       ▼         ▼                         ▼          │           │
│  ┌────────────────────┐      ┌─────────────────────┐ │           │
│  │ zodToFunctionDef() │      │ Messages[]          │ │           │
│  │ Zod → JSON Schema  │      │ System + History    │ │           │
│  └────────────────────┘      └─────────────────────┘ │           │
│                                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Zod → FunctionDefinition 转换层

### 2.1 为什么需要转换？

| 开发者视角 | LLM 视角 |
|-----------|---------|
| Zod Schema（TypeScript 类型推断） | JSON Schema（OpenAI Function Calling） |
| `z.string().min(1)` | `{"type": "string", "minLength": 1}` |
| `z.object({ name: z.string() })` | `{"type": "object", "properties": {"name": {"type": "string"}}}` |
| 运行时校验 + 类型推断 | 纯 JSON 描述 |

### 2.2 转换器实现

```typescript
// src/core/zod-to-function.ts
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * OpenAI Function Definition 格式
 */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * 工具定义（开发者输入）
 */
export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (args: z.infer<TSchema>, ctx?: ToolContext) => Promise<string>;
}

/**
 * Zod → FunctionDefinition 转换
 */
export function zodToFunctionDef<TSchema extends z.ZodType>(
  tool: ToolDefinition<TSchema>
): FunctionDefinition {
  const jsonSchema = zodToJsonSchema(tool.parameters, {
    $refStrategy: 'none',
    removeAdditionalStrategy: 'strict',
  });

  const { type, properties, required, additionalProperties } = jsonSchema as {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };

  if (type !== 'object' || !properties) {
    throw new Error(`Tool "${tool.name}" parameters must be an object schema, got: ${type}`);
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties,
      required,
    },
  };
}

/**
 * 批量转换工具定义
 */
export function toolsToFunctionDefs(
  tools: ToolDefinition[]
): FunctionDefinition[] {
  return tools.map(zodToFunctionDef);
}
```

### 2.3 参数校验闭环

```typescript
// src/core/tool-validator.ts

/**
 * 工具参数校验结果
 */
export interface ToolValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    path: (string | number)[];
  };
}

/**
 * 校验 LLM 返回的工具参数
 */
export function validateToolArgs<TSchema extends z.ZodType>(
  schema: TSchema,
  args: unknown
): ToolValidationResult<z.infer<TSchema>> {
  const result = schema.safeParse(args);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const firstError = result.error.errors[0];
  
  return {
    success: false,
    error: {
      message: firstError.message,
      path: firstError.path,
    },
  };
}

/**
 * 从 ToolRegistry 获取 Schema 并校验
 */
export function validateToolCall(
  toolName: string,
  args: unknown,
  registry: ToolRegistry
): ToolValidationResult {
  const tool = registry.get(toolName);
  if (!tool) {
    return {
      success: false,
      error: { message: `Tool "${toolName}" not found`, path: [] },
    };
  }
  
  return validateToolArgs(tool.parameters, args);
}
```

---

## 3. PromptBuilder 模块

### 3.1 设计原则

| 原则 | 说明 |
|------|------|
| **模板化** | System Prompt 支持变量插值 |
| **可扩展** | 支持注入额外指令（如权限警告、格式约束） |
| **Context-Aware** | 根据工具列表自动生成工具使用说明 |
| **Token 预算** | 支持截断历史消息以控制 Token 数量 |

### 3.2 PromptBuilder 接口

```typescript
// src/core/prompt-builder.ts

/**
 * Prompt 构建选项
 */
export interface PromptBuildOptions {
  systemTemplate?: string;
  templateVars?: Record<string, unknown>;
  extraInstructions?: string[];
  maxTokens?: number;
  includeTools?: boolean;
  toolInstructionsTemplate?: string;
}

/**
 * 构建结果
 */
export interface BuiltPrompt {
  messages: Message[];
  tools?: FunctionDefinition[];
  tokenEstimate: number;
}

/**
 * PromptBuilder 接口
 */
export interface PromptBuilder {
  build(
    history: Message[],
    input: string,
    tools: ToolDefinition[],
    options?: PromptBuildOptions
  ): BuiltPrompt;
}
```

### 3.3 默认实现

```typescript
// src/core/prompt-builder-impl.ts

export class DefaultPromptBuilder implements PromptBuilder {
  private static readonly DEFAULT_SYSTEM_TEMPLATE = `You are a helpful AI assistant.

{{#if tools}}
You have access to the following tools:
{{#each tools}}
- {{this.name}}: {{this.description}}
{{/each}}

Use tools when needed to accomplish tasks.
{{/if}}`;

  private static readonly TOOL_INSTRUCTIONS_TEMPLATE = `
## Tool Usage Guidelines

1. **Choose the right tool**: Select tools that best match the task requirements.
2. **Validate inputs**: Ensure all required parameters are provided with correct types.
3. **Handle errors gracefully**: If a tool returns an error, analyze and retry if appropriate.
4. **Chain tools efficiently**: Break complex tasks into sequential tool calls when needed.
`;

  build(
    history: Message[],
    input: string,
    tools: ToolDefinition[],
    options?: PromptBuildOptions
  ): BuiltPrompt {
    const messages: Message[] = [];
    let tokenEstimate = 0;
    
    // 1. 构建系统提示
    const systemPrompt = this.buildSystemPrompt(tools, options);
    messages.push({ role: 'system', content: systemPrompt });
    tokenEstimate += this.estimateTokens(systemPrompt);
    
    // 2. 添加历史消息（考虑 Token 预算）
    const truncatedHistory = options?.maxTokens
      ? this.truncateHistory(history, options.maxTokens - tokenEstimate)
      : history;
    
    messages.push(...truncatedHistory);
    tokenEstimate += truncatedHistory.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0
    );
    
    // 3. 添加用户输入
    messages.push({ role: 'user', content: input });
    tokenEstimate += this.estimateTokens(input);
    
    // 4. 转换工具定义
    const functionDefs = options?.includeTools !== false
      ? toolsToFunctionDefs(tools)
      : undefined;
    
    return { messages, tools: functionDefs, tokenEstimate };
  }
  
  private buildSystemPrompt(
    tools: ToolDefinition[],
    options?: PromptBuildOptions
  ): string {
    const template = options?.systemTemplate 
      ?? DefaultPromptBuilder.DEFAULT_SYSTEM_TEMPLATE;
    
    const templateData = {
      ...options?.templateVars,
      tools: tools.length > 0 ? tools : undefined,
    };
    
    let result = this.renderTemplate(template, templateData);
    
    if (tools.length > 0 && options?.toolInstructionsTemplate !== false) {
      result += DefaultPromptBuilder.TOOL_INSTRUCTIONS_TEMPLATE;
    }
    
    if (options?.extraInstructions?.length) {
      result += '\n\n' + options.extraInstructions.join('\n\n');
    }
    
    return result;
  }
  
  private renderTemplate(template: string, data: Record<string, unknown>): string {
    let result = template;
    
    // 处理 {{#if ...}}...{{/if}}
    const ifPattern = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    result = result.replace(ifPattern, (_, key, content) => {
      return data[key] ? content : '';
    });
    
    // 处理 {{#each ...}}...{{/each}}
    const eachPattern = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    result = result.replace(eachPattern, (_, key, content) => {
      const items = data[key] as unknown[];
      if (!Array.isArray(items)) return '';
      return items.map((item) => {
        let itemContent = content;
        itemContent = itemContent.replace(
          /\{\{this\.(\w+)\}\}/g,
          (_, prop) => String((item as Record<string, unknown>)[prop] ?? '')
        );
        return itemContent;
      }).join('');
    });
    
    // 处理 {{variable}}
    result = result.replace(
      /\{\{(\w+(?:\.\w+)*)\}\}/g,
      (_, path) => String(this.getNestedValue(data, path) ?? '')
    );
    
    return result;
  }
  
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((curr, key) => {
      return curr && typeof curr === 'object' ? (curr as Record<string, unknown>)[key] : undefined;
    }, obj as unknown);
  }
  
  private truncateHistory(history: Message[], maxTokens: number): Message[] {
    const result: Message[] = [];
    let currentTokens = 0;
    
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const msgTokens = this.estimateTokens(msg.content);
      
      if (currentTokens + msgTokens > maxTokens) break;
      
      result.unshift(msg);
      currentTokens += msgTokens;
    }
    
    return result;
  }
  
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
```

---

## 4. 工具定义最佳实践

### 4.1 推荐模式：Zod + 描述

```typescript
// ✅ 推荐：详细的 Zod Schema + 描述
const SearchTool: ToolDefinition = {
  name: 'search',
  description: 'Search for information on the web. Use this when you need to find current information or answers to questions.',
  parameters: z.object({
    query: z.string().min(1).describe('The search query. Be specific and include relevant keywords.'),
    limit: z.number().int().min(1).max(10).default(5).describe('Maximum number of results to return'),
    language: z.enum(['en', 'zh', 'ja']).optional().describe('Preferred language for results'),
  }),
  execute: async (args) => {
    const { query, limit, language } = args;
    // ... 执行搜索
    return JSON.stringify(results);
  },
};
```

### 4.2 避免的模式

```typescript
// ❌ 避免：使用 any 或无描述
const BadTool = {
  name: 'search',
  description: 'Search', // 描述太简略
  parameters: z.any(), // 失去类型安全
  execute: async (args: any) => { // any 类型
    // ...
  },
};
```

---

## 5. Skill 分类与动态注入

> **问题**：Skill 加载后作为 `tool.result` 返回，LLM 在下轮推理中看到的是 `tool` 角色消息，而非 `system` 角色的权威指令。复杂 Skill 指令在 tool 消息中效果不稳定。

### 5.1 Skill 分类机制

```typescript
// src/skill/types.ts

/**
 * Skill 类别决定注入策略
 */
export const SkillCategorySchema = z.enum([
  'constitutional',  // 宪法级：安全、权限、核心约束
  'safety',          // 安全相关：内容审核、操作限制
  'workflow',        // 工作流：多步骤任务指导
  'domain',          // 领域知识：专业知识、术语定义
  'helper',          // 辅助工具：简化操作、快捷方式
]);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

/**
 * Skill 元信息扩展
 */
export const SkillInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  category: SkillCategorySchema,
  priority: z.number().int().min(1).max(10).default(5),
  version: z.string(),
  path: z.string(),
  
  injection: z.object({
    toSystemPrompt: z.boolean().default(false),
    position: z.enum(['start', 'end', 'after-system']).default('end'),
    includeInToolResult: z.boolean().default(true),
  }).optional(),
});
```

### 5.2 分级注入策略

```
┌─────────────────────────────────────────────────────────────────┐
│                      Skill 注入策略                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  constitutional / safety 类别                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • 注入到 SYSTEM prompt（最高权威）                        │    │
│  │ • PromptBuilder 在构建时自动包含                          │    │
│  │ • 通过 context.updated 触发重建                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  workflow / domain / helper 类别                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • 保留在 tool 消息（上下文驱动）                           │    │
│  │ • load_skill 返回 Skill 内容                             │    │
│  │ • LLM 在下一轮推理中看到                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 PromptBuilder 动态注入

```typescript
// src/core/prompt-builder.ts 扩展

export class DefaultPromptBuilder implements PromptBuilder {
  private loadedSkills: Map<string, SkillInfo> = new Map();
  
  registerSkill(skill: SkillInfo): void {
    this.loadedSkills.set(skill.name, skill);
  }
  
  unregisterSkill(skillName: string): void {
    this.loadedSkills.delete(skillName);
  }
  
  private buildSystemPrompt(
    tools: ToolDefinition[],
    options?: PromptBuildOptions,
  ): string {
    let result = '';
    
    // 基础系统提示模板
    const template = options?.systemTemplate 
      ?? DefaultPromptBuilder.DEFAULT_SYSTEM_TEMPLATE;
    result = this.renderTemplate(template, { tools, ...options?.templateVars });
    
    // 🔴 P2: 注入 constitutional/safety 类 Skill
    const constitutionalSkills = Array.from(this.loadedSkills.values())
      .filter((s) => s.category === 'constitutional' || s.category === 'safety')
      .sort((a, b) => b.priority - a.priority);
    
    if (constitutionalSkills.length > 0) {
      result += '\n\n---\n## Core Constraints (Loaded Skills)\n\n';
      
      for (const skill of constitutionalSkills) {
        const skillContent = this.loadSkillContent(skill);
        result += `### ${skill.name}\n\n${skillContent}\n\n`;
      }
    }
    
    // 工具使用说明
    if (tools.length > 0) {
      result += DefaultPromptBuilder.TOOL_INSTRUCTIONS_TEMPLATE;
    }
    
    // 额外指令
    if (options?.extraInstructions?.length) {
      result += '\n\n' + options.extraInstructions.join('\n\n');
    }
    
    return result;
  }
  
  private loadSkillContent(skill: SkillInfo): string {
    // 实际实现需要读取 Skill 文件内容
    return `[Skill: ${skill.name}] - ${skill.description}`;
  }
}
```

### 5.4 context.updated 事件流程

```
load_skill 工具执行
        │
        ├─ skill = SkillManager.load(name)
        │
        ├─ skill.category 判断
        │      │
        │      ├─ constitutional/safety
        │      │      │
        │      │      ├─ PromptBuilder.registerSkill(skill)
        │      │      │
        │      │      └─ emit context.updated { source: 'skill_loaded', changes: {...} }
        │      │
        │      └─ workflow/domain/helper
        │             │
        │             └─ 返回 tool.result（当前行为，无需改动）
        │
        └─ Agent 接收 context.updated
               │
               └─ 下次 LLM 调用时，PromptBuilder.buildSystemPrompt() 
                  自动包含已注册的 constitutional/safety Skill
```

---

## 6. 设计约束

| 约束 | 描述 |
|------|------|
| **Zod 是唯一的参数定义方式** | 不支持 JSON Schema 直接定义，强制类型安全 |
| **参数校验在执行前** | `execute` 接收的参数已通过 Zod 校验 |
| **FunctionDefinition 预转换** | 注册时转换，避免每次 LLM 调用都转换 |
| **PromptBuilder 可替换** | 通过 DI 注入，支持自定义实现 |
| **Token 预算可选** | 不强制截断，但提供能力 |
| **loadedSkills Agent 级隔离** | Skill 注册表不可跨 Agent 共享 |
| **constitutional/safety 强制注入** | 这两类 Skill 必须注入 system prompt |

---

## 相关文档

- [02-ZOD-CONTRACT.md](./02-ZOD-CONTRACT.md) - Zod 数据契约
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - Agent Loop 集成
- [08-SUBSYSTEMS.md](./08-SUBSYSTEMS.md) - Skill 系统详细设计