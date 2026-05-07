/**
 * AgentForge Workflow Types
 *
 * Type definitions for the Workflow orchestration engine.
 * Workflow is a high-level abstraction above Agent, providing
 * multi-step orchestration with suspend/resume capabilities.
 *
 */

import { z } from 'zod';
import type { AgentEvent, SerializedError } from '../core/events.js';
import type { AgentContext } from '../core/context.js';

// ============================================================
// Declarative Flow Types
// ============================================================

/** Checkpoint path segment: number = index, string = branch direction */
export type PathSegment = number | 'then' | 'else';

export interface StepEntry {
  type: 'step';
  id: string;
  name?: string | undefined;
  prompt: (input: unknown) => string;
  timeout?: number | undefined;
  skip?: ((input: unknown) => boolean) | undefined;
  retryCount?: number | undefined;
}

export interface BranchEntry {
  type: 'branch';
  id: string;
  condition: (input: unknown) => boolean;
  then: StepFlowEntry[];
  else?: StepFlowEntry[] | undefined;
}

export interface ParallelEntry {
  type: 'parallel';
  id: string;
  branches: StepFlowEntry[][];
  maxConcurrency?: number | undefined;
}

export interface ForEachEntry {
  type: 'foreach';
  id: string;
  items: (input: unknown) => unknown[];
  body: StepFlowEntry[];
  maxConcurrency?: number | undefined;
}

export type StepFlowEntry = StepEntry | BranchEntry | ParallelEntry | ForEachEntry;

const StepEntrySchema = z.object({
  type: z.literal('step'),
  id: z.string(),
  name: z.string().optional(),
  prompt: z.function().args(z.unknown()).returns(z.string()),
  timeout: z.number().positive().optional(),
  skip: z.function().args(z.unknown()).returns(z.boolean()).optional(),
  retryCount: z.number().int().nonnegative().optional(),
});

export const StepFlowEntrySchema: z.ZodType<StepFlowEntry> = z.lazy(() =>
  z.discriminatedUnion('type', [
    StepEntrySchema,
    z.object({
      type: z.literal('branch'),
      id: z.string(),
      condition: z.function().args(z.unknown()).returns(z.boolean()),
      then: z.array(StepFlowEntrySchema),
      else: z.array(StepFlowEntrySchema).optional(),
    }),
    z.object({
      type: z.literal('parallel'),
      id: z.string(),
      branches: z.array(z.array(StepFlowEntrySchema)),
      maxConcurrency: z.number().int().positive().optional(),
    }),
    z.object({
      type: z.literal('foreach'),
      id: z.string(),
      items: z.function().args(z.unknown()).returns(z.array(z.unknown())),
      body: z.array(StepFlowEntrySchema),
      maxConcurrency: z.number().int().positive().optional(),
    }),
  ])
);

// ============================================================
// Workflow Event Types (separate from AgentEvent)
// ============================================================

/**
 * Workflow-specific event types.
 * Workflow events are emitted through the workflow listener callback,
 * NOT through the AgentEventEmitter. They are separate from AgentEvent
 * to keep AgentEventSchema lean (14 types).
 */
export type WorkflowEvent =
  | {
      type: 'workflow.start';
      timestamp: number;
      sessionId: string;
      workflowId: string;
      workflowName: string;
    }
  | {
      type: 'workflow.step.start';
      timestamp: number;
      sessionId: string;
      workflowId: string;
      stepId: string;
      stepName: string;
    }
  | {
      type: 'workflow.step.end';
      timestamp: number;
      sessionId: string;
      workflowId: string;
      stepId: string;
      result: 'success' | 'failure' | 'skipped';
    }
  | {
      type: 'workflow.complete';
      timestamp: number;
      sessionId: string;
      workflowId: string;
      result: unknown;
    }
  | {
      type: 'workflow.error';
      timestamp: number;
      sessionId: string;
      workflowId: string;
      error: SerializedError;
      stepId?: string;
    };

/** Union of AgentEvent and WorkflowEvent — for workflow listener callbacks */
export type WorkflowOrAgentEvent = AgentEvent | WorkflowEvent;

/**
 * Check if an event is a workflow event.
 */
export function isWorkflowEvent(event: WorkflowOrAgentEvent): event is WorkflowEvent {
  return event.type.startsWith('workflow.');
}

/**
 * Extract workflow ID from a workflow event.
 */
export function getWorkflowIdFromEvent(event: WorkflowOrAgentEvent): string | undefined {
  if (isWorkflowEvent(event) && 'workflowId' in event) {
    return (event as WorkflowEvent & { workflowId: string }).workflowId;
  }
  return undefined;
}

// ============================================================
// Workflow Step Schema
// ============================================================

/** @deprecated Use StepEntrySchema */
export const WorkflowStepSchema = StepEntrySchema;

/** @deprecated Use StepEntry */
export type WorkflowStep = StepEntry;

/**
 * Workflow step with resolved agent reference
 */
export interface WorkflowStepWithAgent extends StepEntry {
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
  steps: z.array(StepFlowEntrySchema).min(1),
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

/**
 * Create a step output map entry
 */
export function createStepOutputEntry(stepId: string, output: unknown): [string, unknown] {
  return [stepId, output];
}
