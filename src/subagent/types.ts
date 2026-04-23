import { z } from 'zod';
import type { Agent } from '../agent/index.js';
import type { LegacyTool as Tool, Message } from '../types.js';

export const SubAgentModeSchema = z.enum(['primary', 'subagent']);
export type SubAgentMode = z.infer<typeof SubAgentModeSchema>;

export const SubAgentConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  mode: SubAgentModeSchema,
});
export type SubAgentConfig = z.infer<typeof SubAgentConfigSchema>;

export interface SubAgentRegistration extends SubAgentConfig {
  agent: Agent;
  tools?: Tool[];
}

export interface DelegationStartContext {
  subAgentName: string;
  prompt: string;
  parentMessages: Message[];
  iteration: number;
}

export interface DelegationStartResult {
  proceed?: boolean;
  rejectionReason?: string;
  modifiedPrompt?: string;
}

export interface DelegationCompleteContext {
  subAgentName: string;
  result: string;
  success: boolean;
  error?: Error;
  duration: number;
}

export interface MessageFilterContext {
  messages: Message[];
  subAgentName: string;
  prompt: string;
}

export interface DelegationConfig {
  onDelegationStart?: (
    ctx: DelegationStartContext
  ) => DelegationStartResult | Promise<DelegationStartResult>;
  onDelegationComplete?: (ctx: DelegationCompleteContext) => void | Promise<void>;
  messageFilter?: (ctx: MessageFilterContext) => Message[] | Promise<Message[]>;
}

export const schemas = {
  SubAgentMode: SubAgentModeSchema,
  SubAgentConfig: SubAgentConfigSchema,
} as const;
