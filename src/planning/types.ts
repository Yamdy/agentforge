/**
 * MPU-M2 Planning Engine Types
 *
 * Type definitions for the task planning system.
 * Defines interfaces for Planner, PlanExecutor, and related data structures.
 *
 * @module
 */

import type { ToolRegistry } from '../core/interfaces.js';

// ============================================================
// Plan Types
// ============================================================

/**
 * Plan step status
 */
export type PlanStepStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Plan step - single atomic operation in an execution plan
 */
export interface PlanStep {
  /** Unique step ID */
  id: string;
  /** Tool to execute */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Step IDs this step depends on */
  dependsOn?: string[];
  /** Current status */
  status: PlanStepStatus;
}

/**
 * Execution plan - ordered collection of steps
 */
export interface ExecutionPlan {
  /** Unique plan ID */
  id: string;
  /** Ordered steps */
  steps: PlanStep[];
  /** Creation timestamp */
  createdAt: number;
}

// ============================================================
// Planner Types
// ============================================================

/**
 * Planner context - available tools and constraints
 */
export interface PlannerContext {
  /** Available tool names */
  availableTools: string[];
  /** Maximum allowed steps */
  maxSteps: number;
}

/**
 * Validation result for plans
 */
export interface PlanValidationResult {
  /** Whether the plan is valid */
  valid: boolean;
  /** Validation errors */
  errors: PlanValidationError[];
}

/**
 * Plan validation error
 */
export interface PlanValidationError {
  /** Error path (e.g., step ID) */
  path: string;
  /** Error message */
  message: string;
}

/**
 * Planner interface - generates and validates execution plans
 */
export interface Planner {
  /** Generate an execution plan from user input */
  plan(input: string, context: PlannerContext): Promise<ExecutionPlan>;
  /** Validate an execution plan (optional context for maxSteps check) */
  validate(plan: ExecutionPlan, context?: PlannerContext): Promise<PlanValidationResult>;
}

// ============================================================
// PlanExecutor Types
// ============================================================

/**
 * Step execution result
 */
export interface StepResult {
  /** Step ID */
  stepId: string;
  /** Execution status */
  status: 'completed' | 'failed';
  /** Tool output (if successful) */
  output?: string;
  /** Error message (if failed) */
  error?: string;
  /** Execution duration in ms */
  durationMs: number;
}

/**
 * Plan execution result
 */
export interface ExecutionResult {
  /** Plan ID */
  planId: string;
  /** Overall status */
  status: 'completed' | 'failed';
  /** Results per step */
  stepResults: Map<string, StepResult>;
  /** Total execution duration in ms */
  durationMs: number;
}

/**
 * Plan execution progress
 */
export interface PlanProgress {
  /** Total number of steps */
  totalSteps: number;
  /** Completed steps */
  completedSteps: number;
  /** Failed steps */
  failedSteps: number;
  /** Currently executing step ID */
  currentStep?: string | undefined;
}

/**
 * PlanExecutor interface - executes plans with dependency resolution
 */
export interface PlanExecutor {
  /** Execute a complete plan */
  execute(plan: ExecutionPlan, toolRegistry: ToolRegistry): Promise<ExecutionResult>;
  /** Execute a single step */
  executeStep(step: PlanStep, toolRegistry: ToolRegistry): Promise<StepResult>;
  /** Get current execution progress */
  getProgress(): PlanProgress;
}
