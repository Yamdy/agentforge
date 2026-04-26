/**
 * MPU-M2 Planning Engine - Plan Executor Implementation
 *
 * Executes plans with dependency resolution, parallel execution of
 * independent steps, checkpoint resume support, and progress tracking.
 *
 * @module
 */

import type { ToolRegistry } from '../core/interfaces.js';
import type {
  PlanExecutor,
  ExecutionPlan,
  PlanStep,
  ExecutionResult,
  StepResult,
  PlanProgress,
} from './types.js';

// ============================================================
// PlanExecutor Implementation
// ============================================================

/**
 * Executes plans with topological dependency resolution.
 *
 * Features:
 * - Sequential execution for dependent steps
 * - Parallel execution for independent steps
 * - Checkpoint resume (skips completed steps)
 * - Failure propagation (dependent steps skipped)
 * - Progress tracking
 */
export class PlanExecutorImpl implements PlanExecutor {
  private totalSteps = 0;
  private completedSteps = 0;
  private failedSteps = 0;
  private currentStep: string | undefined;

  async execute(plan: ExecutionPlan, toolRegistry: ToolRegistry): Promise<ExecutionResult> {
    const startTime = Date.now();
    const stepResults = new Map<string, StepResult>();

    // Initialize progress tracking
    this.totalSteps = plan.steps.length;
    this.completedSteps = 0;
    this.failedSteps = 0;

    // Build step map for quick lookup
    const stepMap = new Map<string, PlanStep>();
    for (const step of plan.steps) {
      stepMap.set(step.id, step);
    }

    // Track failed step IDs to skip dependents
    const failedStepIds = new Set<string>();

    // Pre-populate results for already completed steps (checkpoint resume)
    for (const step of plan.steps) {
      if (step.status === 'completed') {
        stepResults.set(step.id, {
          stepId: step.id,
          status: 'completed',
          output: 'resumed from checkpoint',
          durationMs: 0,
        });
        this.completedSteps++;
      }
    }

    // Execute steps using topological order with parallelism
    const executed = new Set<string>();

    // Mark already completed steps as executed
    for (const step of plan.steps) {
      if (step.status === 'completed') {
        executed.add(step.id);
      }
    }

    // Process steps level by level (topological layers)
    while (executed.size < plan.steps.length) {
      // Find steps whose dependencies are all satisfied
      const readySteps: PlanStep[] = [];

      for (const step of plan.steps) {
        if (executed.has(step.id)) continue;

        const deps = step.dependsOn ?? [];
        const allDepsResolved = deps.every(d => executed.has(d));
        const anyDepFailed = deps.some(d => failedStepIds.has(d));

        if (anyDepFailed) {
          // Skip this step - dependency failed
          executed.add(step.id);
          failedStepIds.add(step.id);
          continue;
        }

        if (allDepsResolved) {
          readySteps.push(step);
        }
      }

      // If no steps are ready, we have a cycle or deadlock
      if (readySteps.length === 0) {
        // Mark remaining as failed
        for (const step of plan.steps) {
          if (!executed.has(step.id)) {
            stepResults.set(step.id, {
              stepId: step.id,
              status: 'failed',
              error: 'Dependency resolution failed - possible cycle',
              durationMs: 0,
            });
            failedStepIds.add(step.id);
            executed.add(step.id);
            this.failedSteps++;
          }
        }
        break;
      }

      // Execute ready steps concurrently
      const promises = readySteps.map(async step => {
        this.currentStep = step.id;
        const result = await this.executeStep(step, toolRegistry);
        stepResults.set(step.id, result);

        if (result.status === 'completed') {
          this.completedSteps++;
        } else {
          this.failedSteps++;
          failedStepIds.add(step.id);
        }

        executed.add(step.id);
        return result;
      });

      await Promise.all(promises);
    }

    this.currentStep = undefined;

    const hasFailure = failedStepIds.size > 0;

    return {
      planId: plan.id,
      status: hasFailure ? 'failed' : 'completed',
      stepResults,
      durationMs: Date.now() - startTime,
    };
  }

  async executeStep(step: PlanStep, toolRegistry: ToolRegistry): Promise<StepResult> {
    const startTime = Date.now();

    try {
      const tool = toolRegistry.get(step.toolName);

      if (!tool) {
        return {
          stepId: step.id,
          status: 'failed',
          error: `Tool not found: ${step.toolName}`,
          durationMs: Date.now() - startTime,
        };
      }

      const output = await toolRegistry.execute(step.toolName, step.args);

      return {
        stepId: step.id,
        status: 'completed',
        output,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        stepId: step.id,
        status: 'failed',
        error: message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  getProgress(): PlanProgress {
    return {
      totalSteps: this.totalSteps,
      completedSteps: this.completedSteps,
      failedSteps: this.failedSteps,
      currentStep: this.currentStep,
    };
  }
}
