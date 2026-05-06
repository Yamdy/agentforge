/**
 * AgentForge Workflow ← Agent Bridge
 *
 * Utilities to wrap Agent instances as Workflow steps.
 * Follows the Mastra createStepFromAgent pattern:
 *   Workflow is the top-level orchestrator, Agent is the execution unit.
 *
 * The Workflow executor creates an AgentLoop per step from the shared
 * AgentContext, so the 5-layer security pipeline is preserved for every
 * step regardless of which Agent "owns" it.
 */

import type { WorkflowStep, WorkflowConfig } from './types.js';
import { createPromptGenerator } from './executor.js';

// ============================================================
// AgentStepOptions
// ============================================================

export interface AgentStepOptions {
  /** Human-readable step name (defaults to agent name) */
  name?: string;
  /** Template for generating the prompt from step input.
   *  Use {input} as placeholder for the previous step's output. */
  promptTemplate?: string;
  /** Extra instructions prepended to the prompt (e.g. agent role/system prompt) */
  instructions?: string;
  /** Step timeout in milliseconds */
  timeout?: number;
  /** Skip condition */
  skip?: (input: unknown) => boolean;
  /** Retry count on failure */
  retryCount?: number;
}

// ============================================================
// Agent (minimal interface for agent-step.ts)
// ============================================================

/** Minimal Agent interface — only the fields needed to create a step */
export interface AgentLike {
  readonly name: string;
  readonly systemPrompt?: string;
}

// ============================================================
// createStepFromAgent
// ============================================================

/**
 * Wrap an Agent as a Workflow step.
 *
 * The step's prompt generator incorporates the agent's system prompt
 * and any provided template/instructions. When executed by Workflow,
 * a new AgentLoop is created from the shared AgentContext and runs
 * with the generated prompt — preserving all plugins, tools, and
 * the 5-layer security pipeline.
 *
 * @example
 * ```typescript
 * const step = createStepFromAgent(researcherAgent, {
 *   promptTemplate: 'Research: {input}',
 *   instructions: 'Be thorough and cite sources.',
 * });
 * const workflow = createWorkflow({ id: 'wf', name: 'Research', steps: [step] }, ctx);
 * ```
 */
export function createStepFromAgent(
  agent: AgentLike,
  id: string,
  options: AgentStepOptions = {}
): WorkflowStep {
  const parts: string[] = [];

  // Agent system prompt comes first
  if (agent.systemPrompt) {
    parts.push(agent.systemPrompt);
  }

  // Extra instructions
  if (options.instructions) {
    parts.push(options.instructions);
  }

  // The template wraps input
  const template = options.promptTemplate ?? '{input}';

  // Build the prompt: instructions + template
  const prefix = parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
  const fullTemplate = prefix + template;

  const prompt = createPromptGenerator(fullTemplate);

  const step: WorkflowStep = {
    id,
    name: options.name ?? agent.name,
    prompt,
  };

  if (options.timeout !== undefined) step.timeout = options.timeout;
  if (options.skip !== undefined) step.skip = options.skip;
  if (options.retryCount !== undefined) step.retryCount = options.retryCount;

  return step;
}

// ============================================================
// createWorkflowFromAgents
// ============================================================

/**
 * Create a WorkflowConfig from a list of Agent + options pairs.
 *
 * Each agent becomes a sequential step. Output from step N is passed
 * as input to step N+1 via the {input} template placeholder.
 *
 * @example
 * ```typescript
 * const config = createWorkflowFromAgents('research-pipeline', [
 *   { agent: researcher, options: { promptTemplate: 'Research: {input}' } },
 *   { agent: writer, options: { promptTemplate: 'Write about: {input}' } },
 *   { agent: reviewer },
 * ]);
 * const workflow = createWorkflow(config, ctx);
 * ```
 */
export function createWorkflowFromAgents(
  workflowId: string,
  entries: Array<{ agent: AgentLike; id: string; options?: AgentStepOptions }>,
  workflowOptions?: { name?: string; continueOnFailure?: boolean; maxRetries?: number }
): WorkflowConfig {
  const steps = entries.map(({ agent, id, options }) => createStepFromAgent(agent, id, options));

  const config: WorkflowConfig = {
    id: workflowId,
    name: workflowOptions?.name ?? workflowId,
    steps,
  };

  if (workflowOptions?.continueOnFailure !== undefined) {
    config.continueOnFailure = workflowOptions.continueOnFailure;
  }
  if (workflowOptions?.maxRetries !== undefined) {
    config.maxRetries = workflowOptions.maxRetries;
  }

  return config;
}
