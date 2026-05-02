/**
 * MPU-M2 Planning Engine - Planner Implementation
 *
 * Generates execution plans from user input by decomposing tasks
 * into atomic steps with dependency tracking.
 *
 * Uses keyword-based heuristics for step decomposition.
 * Supports validation for plan correctness.
 *
 * @module
 */

import type {
  Planner,
  ExecutionPlan,
  PlanStep,
  PlannerContext,
  PlanValidationResult,
  PlanValidationError,
  StepResult,
} from './types.js';

// ============================================================
// Step ID Generator
// ============================================================

let stepCounter = 0;

function generateStepId(): string {
  return `step-${++stepCounter}`;
}

function generatePlanId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// Keyword-to-Tool Mapping
// ============================================================

/**
 * Map keywords in user input to tool names.
 * Returns the first matching tool from availableTools.
 */
const KEYWORD_TOOL_MAP: Record<string, string[]> = {
  read: ['read', 'open', 'load', 'get', 'fetch', 'cat', 'show', 'view', 'display'],
  write: ['write', 'save', 'create', 'output', 'put', 'store'],
  edit: ['edit', 'modify', 'update', 'change', 'patch', 'replace'],
  search: ['search', 'find', 'grep', 'lookup', 'query', 'locate'],
  bash: ['run', 'execute', 'bash', 'command', 'shell', 'terminal', 'exec'],
};

/**
 * Detect which tool a text segment refers to.
 */
function detectTool(text: string, availableTools: string[]): string | undefined {
  const lower = text.toLowerCase();
  for (const [tool, keywords] of Object.entries(KEYWORD_TOOL_MAP)) {
    if (!availableTools.includes(tool)) continue;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return tool;
      }
    }
  }
  return undefined;
}

/**
 * Extract a simple arg hint from text segment.
 */
function extractArgs(text: string): Record<string, unknown> {
  // Try to extract file paths (simple heuristic)
  const pathMatch = text.match(/[\w./\\-]+\.\w+/);
  if (pathMatch) {
    return { path: pathMatch[0] };
  }
  return { input: text.trim() };
}

// ============================================================
// Input Decomposition
// ============================================================

/**
 * Split user input into segments based on conjunctions and punctuation.
 */
function decomposeInput(input: string): string[] {
  // Split on common conjunctions
  const segments = input
    .split(/\band\b|,|;|\bthen\b|\bafter\b|\bfinally\b/i)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return segments.length > 0 ? segments : [input.trim()];
}

// ============================================================
// Planner Implementation
// ============================================================

/**
 * Keyword-based task planner.
 *
 * Decomposes user input into atomic steps by detecting tool keywords
 * and creating dependency chains for sequential operations.
 */
export class PlannerImpl implements Planner {
  // eslint-disable-next-line @typescript-eslint/require-await
  async plan(input: string, context: PlannerContext): Promise<ExecutionPlan> {
    const segments = decomposeInput(input);
    const steps: PlanStep[] = [];
    const usedStepIds = new Set<string>();

    for (const segment of segments) {
      const toolName = detectTool(segment, context.availableTools);
      if (!toolName) continue;

      const stepId = generateStepId();
      usedStepIds.add(stepId);

      const step: PlanStep = {
        id: stepId,
        toolName,
        args: extractArgs(segment),
        status: 'pending',
      };

      // Chain dependencies: each step depends on the previous one
      if (steps.length > 0) {
        const prevStep = steps[steps.length - 1]!;
        step.dependsOn = [prevStep.id];
      }

      steps.push(step);
    }

    // Fallback: if no tools detected, use the first available tool
    if (steps.length === 0 && context.availableTools.length > 0) {
      const firstTool = context.availableTools[0]!;
      steps.push({
        id: generateStepId(),
        toolName: firstTool,
        args: { input: input.trim() },
        status: 'pending',
      });
    }

    return {
      id: generatePlanId(),
      steps,
      createdAt: Date.now(),
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async validate(plan: ExecutionPlan, context?: PlannerContext): Promise<PlanValidationResult> {
    const errors: PlanValidationError[] = [];

    // Check: plan must have at least one step
    if (plan.steps.length === 0) {
      errors.push({
        path: 'plan',
        message: 'Plan must contain at least one step',
      });
    }

    // Check: step count must not exceed maxSteps (if context provided)
    if (context && plan.steps.length > context.maxSteps) {
      errors.push({
        path: 'plan.steps',
        message: `Plan has ${plan.steps.length} steps, exceeding maxSteps limit of ${context.maxSteps}`,
      });
    }

    // Check: step IDs must be unique
    const stepIds = new Set<string>();
    for (const step of plan.steps) {
      if (stepIds.has(step.id)) {
        errors.push({
          path: `step.${step.id}`,
          message: `Duplicate step ID: ${step.id}`,
        });
      }
      stepIds.add(step.id);
    }

    // Check: dependencies must reference existing steps
    for (const step of plan.steps) {
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!stepIds.has(depId)) {
            errors.push({
              path: `step.${step.id}.dependsOn`,
              message: `Step ${step.id} depends on non-existent step: ${depId}`,
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async replan(
    input: string,
    context: PlannerContext,
    _failedStepId: string,
    completedResults: Map<string, StepResult>
  ): Promise<ExecutionPlan> {
    // Keyword-based planner: regenerate the full plan from scratch
    // (no semantic understanding to do scoped replanning)
    const plan = await this.plan(input, context);
    // Mark already-completed steps
    for (const step of plan.steps) {
      if (completedResults.has(step.id)) {
        step.status = 'completed';
      }
    }
    return plan;
  }
}
