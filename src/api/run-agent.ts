/**
 * AgentForge L3 API - Run Agent (Imperative Version)
 *
 * @deprecated Use createAgent().run() or createAgentLoop().run() directly.
 * This file is kept for backward compatibility.
 *
 * @module
 */

import type { AgentContext } from '../core/context.js';
import { createAgentLoop } from '../loop/agent-loop.js';

export interface RunAgentOptions {
  model?: { provider: string; model: string };
  maxSteps?: number;
  systemPrompt?: string;
}

export interface RunAgentResult {
  run$: (input: string) => Promise<string>;
  on: (type: string, fn: (e: any) => void) => () => void;
  cancel: () => void;
  getState: () => string;
  destroy: () => void;
}

export function runAgent(
  ctx: AgentContext,
  _input: string,
  options?: RunAgentOptions
): RunAgentResult {
  const loop = createAgentLoop(ctx, {
    model: options?.model ?? { provider: 'openai', model: 'gpt-4o' },
    maxSteps: options?.maxSteps ?? 10,
  });

  return {
    run$: (input: string) => loop.run(input),
    on: loop.on.bind(loop) as any,
    cancel: loop.cancel.bind(loop),
    getState: () => loop.getState() ? 'running' : 'idle',
    destroy: loop.destroy.bind(loop),
  };
}

export function runAgentWithControl(
  ctx: AgentContext,
  input: string,
  options?: RunAgentOptions
): RunAgentResult {
  return runAgent(ctx, input, options);
}

export function runAgentToCompletion(ctx: AgentContext, input: string): Promise<string> {
  return runAgent(ctx, input).run$(input);
}

export function runAgentForTools(
  ctx: AgentContext,
  input: string,
  options?: RunAgentOptions
): RunAgentResult {
  return runAgent(ctx, input, options);
}

export function runAgentForText(
  ctx: AgentContext,
  input: string,
  options?: RunAgentOptions
): RunAgentResult {
  return runAgent(ctx, input, options);
}
