import { z } from 'zod';
import type { TaskStatus } from '../types.js';

export const HookEvents = {
  TOOL_EXECUTE_BEFORE: 'tool.execute.before',
  TOOL_EXECUTE_AFTER: 'tool.execute.after',
  MESSAGE_TRANSFORM: 'message.transform',
  SYSTEM_PROMPT: 'system.prompt',
  AGENT_STEP: 'agent.step',
  AGENT_ERROR: 'agent.error',
  STATE_CHANGE: 'state.change',
  AGENT_START: 'agent.start',
  AGENT_COMPLETE: 'agent.complete',
} as const;

export type HookEvent = typeof HookEvents[keyof typeof HookEvents];

export interface ToolExecuteBeforeInput {
  tool: string;
  args: Record<string, unknown>;
}
export interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>;
}

export interface ToolExecuteAfterInput {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}
export interface ToolExecuteAfterOutput {
  result: string;
}

export interface MessageTransformInput {}
export interface MessageTransformOutput {
  messages: any[];
}

export interface SystemPromptInput {}
export interface SystemPromptOutput {
  prompt: string[];
}

export interface AgentStepInput {
  step: number;
  maxSteps: number;
}
export interface AgentStepOutput {}

export interface AgentErrorInput {
  error: string;
}
export interface AgentErrorOutput {}

export interface StateChangeInput {
  from: TaskStatus;
  to: TaskStatus;
}
export interface StateChangeOutput {}

export interface AgentStartInput {
  userInput: string;
}
export interface AgentStartOutput {}

export interface AgentCompleteInput {
  userInput: string;
  response: string;
}
export interface AgentCompleteOutput {}

export interface Hooks {
  'tool.execute.before'?: (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>;
  'tool.execute.after'?: (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => Promise<void>;
  'message.transform'?: (input: MessageTransformInput, output: MessageTransformOutput) => Promise<void>;
  'system.prompt'?: (input: SystemPromptInput, output: SystemPromptOutput) => Promise<void>;
  'agent.step'?: (input: AgentStepInput, output: AgentStepOutput) => Promise<void>;
  'agent.error'?: (input: AgentErrorInput, output: AgentErrorOutput) => Promise<void>;
  'state.change'?: (input: StateChangeInput, output: StateChangeOutput) => Promise<void>;
  'agent.start'?: (input: AgentStartInput, output: AgentStartOutput) => Promise<void>;
  'agent.complete'?: (input: AgentCompleteInput, output: AgentCompleteOutput) => Promise<void>;
}

export const PluginSchema = z.object({
  name: z.string().min(1, 'Plugin name is required'),
  version: z.string().optional(),
  hooks: z.record(z.string(), z.function()).optional(),
});
export type Plugin = z.infer<typeof PluginSchema>;
