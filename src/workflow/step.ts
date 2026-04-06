import type { WorkflowStep, WorkflowContext } from './types.js';
import type { Agent } from '../agent/index.js';

export function createStep<TInput, TOutput>(
  id: string,
  execute: (input: TInput, context: WorkflowContext) => Promise<TOutput>,
  options?: { description?: string }
): WorkflowStep<TInput, TOutput> {
  return {
    id,
    description: options?.description,
    execute,
  };
}

export function createAgentStep(
  id: string,
  agent: Agent,
  options?: { description?: string }
): WorkflowStep<string, string> {
  return {
    id,
    description: options?.description,
    execute: async (input: string) => agent.run(input),
  };
}
