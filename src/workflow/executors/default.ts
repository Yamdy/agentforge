import type { WorkflowStep, WorkflowContext, InputMapping } from '../types.js';
import { WorkflowContextImpl } from '../context.js';

interface StepNode {
  type: 'step';
  id: string;
  step: WorkflowStep<unknown, unknown>;
  options?: { input?: InputMapping };
}

interface ParallelNode {
  type: 'parallel';
  steps: StepNode[];
}

interface BranchNode {
  type: 'branch';
  condition: (ctx: WorkflowContext) => boolean;
  trueBranch: StepNode;
  falseBranch: StepNode;
}

interface LoopNode {
  type: 'loop';
  condition: (ctx: WorkflowContext, iteration: number) => boolean;
  loopStep: StepNode;
  maxIterations: number;
}

type ExecutionNode = StepNode | ParallelNode | BranchNode | LoopNode;

export class DefaultExecutor {
  private nodes: ExecutionNode[] = [];

  addStep(
    id: string,
    step: WorkflowStep<unknown, unknown>,
    options?: { input?: InputMapping }
  ): void {
    this.nodes.push({ type: 'step', id, step, options });
  }

  addParallelGroup(steps: StepNode[]): void {
    this.nodes.push({ type: 'parallel', steps });
  }

  setBranch(
    condition: (ctx: WorkflowContext) => boolean,
    trueBranch: { id: string; step: WorkflowStep<unknown, unknown> },
    falseBranch: { id: string; step: WorkflowStep<unknown, unknown> }
  ): void {
    this.nodes.push({
      type: 'branch',
      condition,
      trueBranch: { type: 'step', id: trueBranch.id, step: trueBranch.step },
      falseBranch: { type: 'step', id: falseBranch.id, step: falseBranch.step },
    });
  }

  setLoop(
    condition: (ctx: WorkflowContext, iteration: number) => boolean,
    loopStep: { id: string; step: WorkflowStep<unknown, unknown> },
    maxIterations: number = 100
  ): void {
    this.nodes.push({
      type: 'loop',
      condition,
      loopStep: { type: 'step', id: loopStep.id, step: loopStep.step },
      maxIterations: Math.max(1, maxIterations),
    });
  }

  async execute<TInput, TOutput>(input: TInput): Promise<TOutput | WorkflowSuspendResult> {
    const context = new WorkflowContextImpl();
    let currentInput: unknown = input;

    for (const node of this.nodes) {
      switch (node.type) {
        case 'step': {
          const stepInput = this.resolveInput(node.options?.input, context, currentInput);
          const result = await node.step.execute(stepInput, context);
          
          // Check if the step requested suspension
          if (typeof result === 'object' && result !== null && 'suspended' in result && result.suspended) {
            return result as WorkflowSuspendResult;
          }
          
          context.setResult(node.id, result);
          currentInput = result;
          break;
        }

        case 'parallel': {
          const results = await Promise.all(
            node.steps.map(async (stepNode) => {
              const stepInput = this.resolveInput(stepNode.options?.input, context, currentInput);
              const result = await stepNode.step.execute(stepInput, context);
              
              // If any parallel step suspends, we still return the suspend result
              if (typeof result === 'object' && result !== null && 'suspended' in result && result.suspended) {
                return result as WorkflowSuspendResult;
              }
              
              context.setResult(stepNode.id, result);
              return { id: stepNode.id, result };
            })
          );

          const parallelResults: Record<string, unknown> = {};
          for (const { id, result } of results) {
            parallelResults[id] = result;
          }
          currentInput = parallelResults;
          break;
        }

        case 'branch': {
          const conditionResult = node.condition(context);
          const selectedNode = conditionResult ? node.trueBranch : node.falseBranch;
          const stepInput = this.resolveInput(selectedNode.options?.input, context, currentInput);
          const result = await selectedNode.step.execute(stepInput, context);
          
          // Check if the step requested suspension
          if (typeof result === 'object' && result !== null && 'suspended' in result && result.suspended) {
            return result as WorkflowSuspendResult;
          }
          
          context.setResult(selectedNode.id, result);
          currentInput = result;
          break;
        }

        case 'loop': {
          let iteration = 0;
          let lastResult = currentInput;

          while (node.condition(context, iteration) && iteration < node.maxIterations) {
            const stepInput = this.resolveInput(node.loopStep.options?.input, context, lastResult);
            const result = await node.loopStep.execute(stepInput, context);
            
            // Check if the step requested suspension
            if (typeof result === 'object' && result !== null && 'suspended' in result && result.suspended) {
              return result as WorkflowSuspendResult;
            }
            
            context.setResult(node.loopStep.id, result);
            lastResult = result;
            iteration++;
          }

          currentInput = lastResult;
          break;
        }
      }
    }

    return currentInput as TOutput;
  }

        case 'parallel': {
          const results = await Promise.all(
            node.steps.map(async (stepNode) => {
              const stepInput = this.resolveInput(stepNode.options?.input, context, currentInput);
              const result = await stepNode.step.execute(stepInput, context);
              context.setResult(stepNode.id, result);
              return { id: stepNode.id, result };
            })
          );

          const parallelResults: Record<string, unknown> = {};
          for (const { id, result } of results) {
            parallelResults[id] = result;
          }
          currentInput = parallelResults;
          break;
        }

        case 'branch': {
          const conditionResult = node.condition(context);
          const selectedNode = conditionResult ? node.trueBranch : node.falseBranch;
          const stepInput = this.resolveInput(selectedNode.options?.input, context, currentInput);
          const result = await selectedNode.step.execute(stepInput, context);
          context.setResult(selectedNode.id, result);
          currentInput = result;
          break;
        }

        case 'loop': {
          let iteration = 0;
          let lastResult = currentInput;

          while (node.condition(context, iteration) && iteration < node.maxIterations) {
            const stepInput = this.resolveInput(node.loopStep.options?.input, context, lastResult);
            const result = await node.loopStep.step.execute(stepInput, context);
            context.setResult(node.loopStep.id, result);
            lastResult = result;
            iteration++;
          }

          currentInput = lastResult;
          break;
        }
      }
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
