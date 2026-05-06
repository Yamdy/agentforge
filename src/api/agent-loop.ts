/**
 * AgentForge L3 API - AgentLoop Public Wrapper
 *
 * Imperative API: run() returns Promise<string>, events via on() callback.
 *
 * @deprecated Use createAgentLoop() directly from 'agentforge/loop'.
 * This file is kept for backward compatibility.
 *
 * @module
 */

import { createAgentLoop, type AgentLoopConfig, type AgentLoop } from '../loop/agent-loop.js';
import type { AgentContext } from '../core/context.js';
import type { AgentEvent } from '../core/events.js';

export type { AgentLoopConfig };

export interface AgentLoopOptions {
  model: { provider: string; model: string };
  maxSteps?: number;
  maxLLMRepairAttempts?: number;
  parallelToolCalls?: boolean;
  streaming?: boolean;
  tokenBudget?: number;
  fallbackModel?: { provider: string; model: string };
  checkpoint?: { enabled: boolean; interval: 'step' | 'tool_result' | 'llm_response' };
  history?: import('../core/events.js').Message[];
  systemPrompt?: string;
}

export type LoopStatus = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

export interface AgentLoopInstance {
  on<T extends AgentEvent['type']>(
    type: T,
    fn: (e: Extract<AgentEvent, { type: T }>) => void
  ): () => void;
  onAny(fn: (e: AgentEvent) => void): () => void;
  cancel(reason?: string): void;
  getState(): LoopStatus;
  onDestroy(): { unsubscribe: () => void };
  pause(): void;
  resume(): void;
  destroy(): void;
}

/**
 * Create an AgentLoop instance for the L3 API.
 */
export function AgentLoop(ctx: AgentContext, options: AgentLoopOptions): AgentLoopInstance {
  const loopConfig: AgentLoopConfig = {
    model: options.model,
    maxSteps: options.maxSteps ?? 10,
  };
  if (options.maxLLMRepairAttempts !== undefined)
    loopConfig.maxLLMRepairAttempts = options.maxLLMRepairAttempts;
  if (options.parallelToolCalls !== undefined)
    loopConfig.parallelToolCalls = options.parallelToolCalls;
  if (options.streaming !== undefined) loopConfig.streaming = options.streaming;
  if (options.tokenBudget !== undefined) loopConfig.tokenBudget = options.tokenBudget;
  if (options.fallbackModel !== undefined) loopConfig.fallbackModel = options.fallbackModel;
  if (options.history !== undefined) loopConfig.history = options.history;
  if (options.systemPrompt !== undefined) loopConfig.systemPrompt = options.systemPrompt;

  const loop: AgentLoop = createAgentLoop(ctx, loopConfig);

  let currentState: LoopStatus = 'idle';

  return {
    on: loop.on.bind(loop),
    onAny: loop.onAny.bind(loop),
    cancel: () => {
      currentState = 'cancelled';
      loop.cancel();
    },
    getState: () => currentState,
    onDestroy: () => ({ unsubscribe: () => {} }),
    pause: loop.pause.bind(loop),
    resume: loop.resume.bind(loop),
    destroy: loop.destroy.bind(loop),
  };
}

export type { AgentLoop as AgentLoopClass };
