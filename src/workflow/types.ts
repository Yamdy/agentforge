/**
 * AgentForge Workflow Types
 *
 * Type definitions for the Workflow orchestration engine.
 * Workflow is a high-level abstraction above Agent, providing
 * multi-step orchestration with suspend/resume capabilities.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import { z } from 'zod';
import type { AgentEvent } from '../core/events.js';
import type { AgentContext } from '../core/context.js';

// ============================================================
// Workflow Step Schema
// ============================================================

/**
 * Workflow step configuration schema
 */
export const WorkflowStepSchema = z.object({
  /** Unique step identifier */
  id: z.string(),
  /** Human-readable step name */
  name: z.string().optional(),
  /** Prompt generator function - transforms input to agent prompt */
  prompt: z.function().args(z.unknown()).returns(z.string()),
  /** Step timeout in milliseconds */
  timeout: z.number().positive().optional(),
  /** Skip condition - if true, step is skipped */
  skip: z.function().args(z.unknown()).returns(z.boolean()).optional(),
  /** Retry count on failure */
  retryCount: z.number().int().nonnegative().optional(),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/**
 * Workflow step with resolved agent reference
 */
export interface WorkflowStepWithAgent extends WorkflowStep {
  /** Optional agent context for this step (inherits from workflow if not specified) */
  agentContext?: AgentContext;
}

// ============================================================
// Workflow Configuration Schema
// ============================================================

/**
 * Workflow configuration schema
 */
export const WorkflowConfigSchema = z.object({
  /** Unique workflow identifier */
  id: z.string(),
  /** Human-readable workflow name */
  name: z.string(),
  /** Workflow steps to execute */
  steps: z.array(WorkflowStepSchema).min(1),
  /** Default timeout for all steps (can be overridden per step) */
  defaultTimeout: z.number().positive().optional(),
  /** Continue on step failure */
  continueOnFailure: z.boolean().optional(),
  /** Maximum retries for recoverable errors */
  maxRetries: z.number().int().nonnegative().optional(),
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

// ============================================================
// Workflow Execution State
// ============================================================

/**
 * Workflow execution state
 */
export const WorkflowExecutionStateSchema = z.enum([
  'pending',
  'running',
  'suspended',
  'completed',
  'failed',
  'cancelled',
]);

export type WorkflowExecutionState = z.infer<typeof WorkflowExecutionStateSchema>;

/**
 * Current workflow execution context
 */
export interface WorkflowExecutionContext {
  /** Workflow instance ID */
  workflowId: string;
  /** Current execution state */
  state: WorkflowExecutionState;
  /** Current step index (0-based) */
  currentStepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** Accumulated output from completed steps */
  stepOutputs: Map<string, unknown>;
  /** Final workflow result */
  result?: unknown;
  /** Error if workflow failed */
  error?: Error;
  /** Suspension reason */
  suspensionReason?: string;
  /** Step to resume from (if suspended) */
  resumeFromStep?: number;
}

// ============================================================
// Workflow Result
// ============================================================

/**
 * Workflow execution result
 */
export interface WorkflowResult {
  /** Whether workflow completed successfully */
  success: boolean;
  /** Final workflow output */
  output?: unknown;
  /** Error if workflow failed */
  error?: {
    name: string;
    message: string;
    stack?: string;
    stepId?: string;
  };
  /** Number of steps completed */
  stepsCompleted: number;
  /** Total steps in workflow */
  totalSteps: number;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Step outputs by step ID */
  stepOutputs: Record<string, unknown>;
}

// ============================================================
// Workflow Step Result
// ============================================================

/**
 * Result of executing a single workflow step
 */
export interface WorkflowStepResult {
  /** Step ID */
  stepId: string;
  /** Whether step succeeded */
  success: boolean;
  /** Step output */
  output?: unknown;
  /** Error if step failed */
  error?: {
    name: string;
    message: string;
    stack?: string | undefined;
  };
  /** Whether step was skipped */
  skipped: boolean;
  /** Execution duration in milliseconds */
  durationMs: number;
}

// ============================================================
// Pipeline Types
// ============================================================

/**
 * Pipeline execution mode
 */
export const PipelineModeSchema = z.enum(['sequential', 'parallel']);

export type PipelineMode = z.infer<typeof PipelineModeSchema>;

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  /** Pipeline execution mode */
  mode: PipelineMode;
  /** Steps to execute */
  steps: WorkflowStep[];
  /** Maximum concurrent steps for parallel mode */
  maxConcurrency?: number;
  /** Continue on step failure */
  continueOnFailure?: boolean;
}

// ============================================================
// Workflow Events Helper
// ============================================================

/**
 * Helper to check if an event is a workflow event
 */
export function isWorkflowEvent(
  event: AgentEvent
): event is Extract<AgentEvent, { type: `workflow.${string}` }> {
  return event.type.startsWith('workflow.');
}

/**
 * Extract workflow ID from event
 */
export function getWorkflowIdFromEvent(event: AgentEvent): string | undefined {
  if (isWorkflowEvent(event) && 'workflowId' in event) {
    return event.workflowId;
  }
  return undefined;
}

/**
 * Create a step output map entry
 */
export function createStepOutputEntry(
  stepId: string,
  output: unknown
): [string, unknown] {
  return [stepId, output];
}
