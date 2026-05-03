/**
 * PlanNotebook - Agent-managed planning via tool registration and request hooks.
 *
 * Wraps the existing Planner interface, registering create_plan/finish_task/revise_plan
 * tools that the LLM can call to manage execution plans autonomously.
 * Injects plan context hints into LLM requests via RequestHook.
 *
 * @module
 */

import { z } from 'zod';
import type { ToolRegistry, ToolDefinition } from '../core/interfaces.js';
import type { RequestHook } from '../core/hooks.js';
import type { AgentState } from '../core/state.js';
import type { Message } from '../core/events.js';
import { extractText } from '../core/content-utils.js';
import type { Planner, PlannerContext, ExecutionPlan, PlanStep, StepResult } from './types.js';

// ============================================================
// Constants
// ============================================================

const HINT_PRIORITY = 25; // Between MEMORY_CONTEXT (20) and SKILL_INSTRUCTIONS (30)

// ============================================================
// PlanNotebook
// ============================================================

/**
 * Agent-managed planning notebook.
 *
 * Registers tools that allow the LLM to:
 * - Create execution plans (create_plan)
 * - Mark steps as complete and advance to next step (finish_task)
 * - Revise plans when stuck (revise_plan)
 *
 * Also injects the current plan step as a hint into LLM requests
 * via a {@link RequestHook} (planHintHook).
 */
export class PlanNotebook {
  /** The underlying plan generator */
  private readonly planner: Planner;
  /** Planning context (available tools, constraints) */
  private readonly context: PlannerContext;
  /** Current execution plan (null until first create_plan) */
  private plan: ExecutionPlan | null = null;
  /** Task description from create_plan */
  private taskDescription: string = '';
  /** Step execution results indexed by step ID */
  private readonly stepResults = new Map<string, StepResult>();
  /** Current step hint text injected into LLM requests */
  private currentHint: string = '';

  // ============================================================
  // RequestHook (public, for external hook registration)
  // ============================================================

  /**
   * RequestHook that injects the current plan step hint into
   * the system message before each LLM call.
   *
   * Priority: 25 (between MEMORY_CONTEXT and SKILL_INSTRUCTIONS).
   */
  readonly planHintHook: RequestHook = {
    name: 'plan-notebook-hint',
    priority: HINT_PRIORITY,
    apply: (messages: Message[], _state: AgentState): Message[] => {
      return this.applyHint(messages);
    },
  };

  // ============================================================
  // Constructor
  // ============================================================

  /**
   * @param planner - Plan generation/validation/replan interface
   * @param context - Available tools and max steps constraint
   */
  constructor(planner: Planner, context: PlannerContext) {
    this.planner = planner;
    this.context = context;
  }

  // ============================================================
  // registerTools
  // ============================================================

  /**
   * Register create_plan, finish_task, and revise_plan tools on the
   * given tool registry so the LLM can manage plans autonomously.
   */
  registerTools(registry: ToolRegistry): void {
    registry.register(this.createCreatePlanTool());
    registry.register(this.createFinishTaskTool());
    registry.register(this.createRevisePlanTool());
  }

  // ============================================================
  // Tool Definitions
  // ============================================================

  private createCreatePlanTool(): ToolDefinition {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      name: 'create_plan',
      description:
        'Create a step-by-step execution plan to accomplish a task. ' +
        'Call this first before executing any work.',
      parameters: z.object({
        task: z.string().min(1),
      }),
      execute: async (args: unknown): Promise<string> => {
        const parsed = z.object({ task: z.string().min(1) }).safeParse(args);
        if (!parsed.success) return `Error: Invalid arguments. ${parsed.error.message}`;
        return self.handleCreatePlan(parsed.data.task);
      },
    };
  }

  private createFinishTaskTool(): ToolDefinition {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      name: 'finish_task',
      description:
        'Mark a plan step as completed and store its outcome. ' +
        'Automatically advances to the next step.',
      parameters: z.object({
        stepId: z.string(),
        outcome: z.string(),
      }),
      execute: async (args: unknown): Promise<string> => {
        const parsed = z.object({ stepId: z.string(), outcome: z.string() }).safeParse(args);
        if (!parsed.success) return `Error: Invalid arguments. ${parsed.error.message}`;
        return self.handleFinishTask(parsed.data.stepId, parsed.data.outcome);
      },
    };
  }

  private createRevisePlanTool(): ToolDefinition {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      name: 'revise_plan',
      description:
        'Revise the current plan when stuck or when circumstances change. ' +
        'Resets incomplete steps and generates a new plan from the remaining work.',
      parameters: z.object({
        reason: z.string(),
        newInstructions: z.string(),
      }),
      execute: async (args: unknown): Promise<string> => {
        const parsed = z
          .object({ reason: z.string(), newInstructions: z.string() })
          .safeParse(args);
        if (!parsed.success) return `Error: Invalid arguments. ${parsed.error.message}`;
        return self.handleRevisePlan(parsed.data.newInstructions, parsed.data.reason);
      },
    };
  }

  // ============================================================
  // Tool Handlers
  // ============================================================

  private async handleCreatePlan(task: string): Promise<string> {
    const plan = await this.planner.plan(task, this.context);

    // Replace any existing plan state
    this.plan = plan;
    this.taskDescription = task;
    this.stepResults.clear();

    // Activate the first pending step
    this.activateNextStep();

    const lines = [`Plan created for "${this.taskDescription}": ${plan.steps.length} steps`];
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]!;
      const desc = step.description ?? `Execute ${step.toolName}`;
      lines.push(`- [${i + 1}] ${desc}`);
    }

    return lines.join('\n');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async handleFinishTask(stepId: string, outcome: string): Promise<string> {
    if (!this.plan) {
      return 'Error: No active plan. Call create_plan first.';
    }

    const step = this.plan.steps.find(s => s.id === stepId);
    if (!step) {
      return `Error: Step '${stepId}' not found in plan.`;
    }

    // Mark step as completed
    step.status = 'completed';

    // Store result
    const now = Date.now();
    const prev = this.stepResults.get(stepId);
    this.stepResults.set(stepId, {
      stepId,
      status: 'completed',
      output: outcome,
      durationMs: prev ? now - prev.durationMs : 0,
    });

    // Activate next step
    const nextStep = this.activateNextStep();
    const completedCount = this.completedCount();

    if (!nextStep) {
      return `Plan complete. All ${this.plan.steps.length} steps finished.`;
    }

    const desc = nextStep.description ?? `Execute ${nextStep.toolName}`;
    return `Step ${completedCount} done. Next: ${desc}`;
  }

  private async handleRevisePlan(newInstructions: string, reason: string): Promise<string> {
    if (!this.plan) {
      return 'Error: No active plan to revise. Call create_plan first.';
    }

    const oldStepCount = this.plan.steps.length;

    // Collect completed step results
    const completedResults = new Map<string, StepResult>();
    for (const step of this.plan.steps) {
      if (step.status === 'completed') {
        const result = this.stepResults.get(step.id);
        if (result) {
          completedResults.set(step.id, result);
        }
      }
    }

    // Get current (in-progress) step as failed
    const currentStep = this.getCurrentStep();
    const failedStepId = currentStep?.id ?? this.plan.steps[0]?.id ?? '';

    // Generate revised plan
    const newPlan = await this.planner.replan(
      newInstructions,
      this.context,
      failedStepId,
      completedResults
    );

    this.plan = newPlan;

    // Reset all steps to pending (completed ones were already collected)
    for (const step of this.plan.steps) {
      step.status = 'pending';
    }

    // Activate first pending step
    this.activateNextStep();

    return `Plan revised: ${this.plan.steps.length} steps (was ${oldStepCount}). Reason: ${reason}`;
  }

  // ============================================================
  // Step Management Helpers
  // ============================================================

  /**
   * Get the first step with status 'running', or null if none.
   */
  private getCurrentStep(): PlanStep | null {
    if (!this.plan) return null;
    return this.plan.steps.find(s => s.status === 'running') ?? null;
  }

  /**
   * Find the next pending step, set it to 'running', and update the hint.
   * Returns the activated step, or null if no pending steps remain.
   */
  private activateNextStep(): PlanStep | null {
    if (!this.plan) return null;

    const next = this.plan.steps.find(s => s.status === 'pending');
    if (!next) {
      this.currentHint = '';
      return null;
    }

    next.status = 'running';

    const stepIndex = this.plan.steps.indexOf(next) + 1;
    const desc = next.description ?? `Execute ${next.toolName}`;
    this.currentHint = `\n<plan-hint>Current step: step ${stepIndex}: ${desc}</plan-hint>`;

    return next;
  }

  /**
   * Count completed steps in the current plan.
   */
  private completedCount(): number {
    if (!this.plan) return 0;
    return this.plan.steps.filter(s => s.status === 'completed').length;
  }

  // ============================================================
  // RequestHook Logic
  // ============================================================

  /**
   * Apply the plan hint to the message list.
   *
   * If a currentHint exists, appends it to the system message
   * (or creates a new system message if none exists).
   */
  private applyHint(messages: Message[]): Message[] {
    if (!this.currentHint) return messages;

    const systemIndex = messages.findIndex(m => m.role === 'system');

    if (systemIndex >= 0) {
      // Append to existing system message
      const updated = [...messages];
      const msg = updated[systemIndex]!;
      updated[systemIndex] = {
        ...msg,
        content: extractText(msg.content) + this.currentHint,
      };
      return updated;
    }

    // Create a new system message
    return [
      {
        role: 'system',
        content: this.currentHint,
      },
      ...messages,
    ];
  }
}
