import type { SessionManager, Session, Tool, Message, ToolCall, Skill } from "@agentforge/core";
import type { LLMProvider } from "@agentforge/llm";
import type { Middleware } from "@agentforge/middleware";
import type { SkillManager } from "@agentforge/core";

// Re-export types for convenience
export type {
  SessionManager,
  Session,
  Tool,
  Message,
  ToolCall,
  Skill,
  LLMProvider,
  Middleware,
  SkillManager,
};

// 基础Agent配置
export interface BaseAgentConfig {
  // LLM服务实例
  llm: LLMProvider;
  // 会话管理器
  sessionManager: SessionManager;
  // 静态系统提示词
  systemPrompt?: string;
  // 动态系统提示词生成函数
  systemPromptGenerator?: (session: Session, context: RunContext) => string | Promise<string>;
  // 工具列表
  tools?: Tool[];
  // 技能列表
  skills?: Skill[];
  // 技能管理器（可选，自定义实现）
  skillManager?: SkillManager;
  // 中间件列表
  middleware?: Middleware[];
  // 最大工具调用轮次，默认5
  maxToolCallRounds?: number;
  // 会话元数据
  metadata?: Record<string, any>;
  // MCP服务器配置（可选）
  mcp?: MCPServerConfig[];
}

// MCP服务器配置
export interface MCPServerConfig {
  name: string;
  serverUrl: string;
  transport: "sse" | "http" | "stdio";
  apiKey?: string;
  authToken?: string;
  options?: Record<string, any>;
  includeTools?: string[];
  excludeTools?: string[];
}

// 运行上下文
export interface RunContext {
  sessionId: string;
  requestId: string;
  startTime: number;
  metadata: Record<string, any>;
}

// 发送消息选项
export interface SendMessageOptions {
  // 临时系统提示词，只对本次请求生效
  systemPrompt?: string;
  // 额外的工具列表，只对本次请求生效
  tools?: Tool[];
  // 是否禁用工具调用
  disableTools?: boolean;
  // 元数据
  metadata?: Record<string, any>;
}

// 生命周期钩子定义
export interface AgentHooks {
  // 执行流程开始前触发，接收用户输入和会话
  beforeRun?: (input: Message | string, session: Session, context: RunContext) => Message | string | Promise<Message | string>;
  // 执行流程结束后触发，接收最终响应
  afterRun?: (response: string, session: Session, context: RunContext) => string | Promise<string>;
  // LLM调用前触发，接收消息列表和工具列表
  beforeLLMCall?: (messages: Message[], tools: Tool[], context: RunContext) => Message[] | Promise<Message[]>;
  // LLM调用后触发，接收LLM响应
  afterLLMCall?: (response: { content?: string; toolCalls?: ToolCall[] }, context: RunContext) => void | Promise<void>;
  // 工具调用前触发，接收工具调用参数
  beforeToolCall?: (toolCall: ToolCall, context: RunContext) => ToolCall | Promise<ToolCall>;
  // 工具调用后触发，接收工具执行结果
  afterToolCall?: (result: any, toolCall: ToolCall, context: RunContext) => any | Promise<any>;
  // 错误发生时触发
  onError?: (error: Error, context: RunContext) => void | Promise<void>;
  // 响应返回给用户前触发，接收最终响应内容
  beforeResponse?: (response: string, context: RunContext) => string | Promise<string>;
}
