import type { WorkflowStep, WorkflowContext, InputMapping, LoopOptions } from '../types.js';
import { WorkflowContextImpl } from '../context.js';

interface StepNode {
  id: string;
  step: WorkflowStep<unknown, unknown>;
  options?: { input?: InputMapping };
  dependencies: string[];
}

export class DefaultExecutor {
  private steps: StepNode[] = [];
  private branch?: {
    condition: (ctx: WorkflowContext) => boolean;
    trueBranch: StepNode;
    falseBranch: StepNode;
  };
  private loop?: {
    condition: (ctx: WorkflowContext, iteration: number) => boolean;
    loopStep: StepNode;
    maxIterations: number;
  };

  addStep(
    id: string,
    step: WorkflowStep<unknown, unknown>,
    options?: { input?: InputMapping }
  ): void {
    this.steps.push({ id, step, options, dependencies: [] });
  }

  setBranch(
    condition: (ctx: WorkflowContext) => boolean,
    trueBranch: { id: string; step: WorkflowStep<unknown, unknown> },
    falseBranch: { id: string; step: WorkflowStep<unknown, unknown> }
  ): void {
    this.branch = {
      condition,
      trueBranch: {
        id: trueBranch.id,
        step: trueBranch.step,
        options: undefined,
        dependencies: [],
      },
      falseBranch: {
        id: falseBranch.id,
        step: falseBranch.step,
        options: undefined,
        dependencies: [],
      },
    };
  }

  setLoop(
    condition: (ctx: WorkflowContext, iteration: number) => boolean,
    loopStep: { id: string; step: WorkflowStep<unknown, unknown> },
    maxIterations: number = 100
  ): void {
    this.loop = {
      condition,
      loopStep: {
        id: loopStep.id,
        step: loopStep.step,
        options: undefined,
        dependencies: [],
      },
      maxIterations: Math.max(1, maxIterations),
    };
  }

  async execute<TInput, TOutput>(input: TInput): Promise<TOutput> {
    const context = new WorkflowContextImpl();
    let currentInput: unknown = input;

    for (const node of this.steps) {
      const stepInput = this.resolveInput(node.options?.input, context, currentInput);
      const result = await node.step.execute(stepInput, context);
      context.setResult(node.id, result);
      currentInput = result;
    }

    if (this.branch) {
      const conditionResult = this.branch.condition(context);
      const selectedNode = conditionResult ? this.branch.trueBranch : this.branch.falseBranch;
      const stepInput = this.resolveInput(selectedNode.options?.input, context, currentInput);
      const result = await selectedNode.step.execute(stepInput, context);
      context.setResult(selectedNode.id, result);
      currentInput = result;
    }

    if (this.loop) {
      let iteration = 0;
      let lastResult = currentInput;

      while (this.loop.condition(context, iteration) && iteration < this.loop.maxIterations) {
        const stepInput = this.resolveInput(this.loop.loopStep.options?.input, context, lastResult);
        const result = await this.loop.loopStep.step.execute(stepInput, context);
        context.setResult(this.loop.loopStep.id, result);
        lastResult = result;
        iteration++;
      }

      currentInput = lastResult;
    }

    return currentInput as TOutput;
  }

  private resolveInput(
    mapping: InputMapping | undefined,
    context: WorkflowContext,
    currentInput: unknown
  ): unknown {
    if (!mapping) {
      return currentInput;
    }

    if (mapping.fromStep) {
      const result = context.getResult(mapping.fromStep);
      if (mapping.path && result && typeof result === 'object') {
        return this.getPathValue(result, mapping.path);
      }
      return result;
    }

    return currentInput;
  }

  private getPathValue(obj: object, path: string): unknown {
    return path.split('.').reduce((current: unknown, key) => {
      if (current && typeof current === 'object' && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }
}
