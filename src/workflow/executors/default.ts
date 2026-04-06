import type { WorkflowStep, WorkflowContext, InputMapping } from '../types.js';
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
