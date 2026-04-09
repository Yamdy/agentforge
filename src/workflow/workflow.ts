import type {
  Workflow,
  CommittedWorkflow,
  WorkflowStep,
  WorkflowContext,
  StepOptions,
  InputMapping,
  ParallelOptions,
  BranchOptions,
  LoopOptions,
} from './types.js';
import { DefaultExecutor } from './executors/index.js';

class WorkflowBuilder<TInput = unknown, TOutput = unknown> implements Workflow<TInput, TOutput> {
  readonly id: string;
  private executor: DefaultExecutor = new DefaultExecutor();
  private lastStepId: string | null = null;

  constructor(id: string) {
    this.id = id;
  }

  step<TI, TO>(
    stepId: string,
    step: WorkflowStep<TI, TO>,
    options?: StepOptions
  ): WorkflowBuilder<TInput, TO> {
    this.executor.addStep(stepId, step as WorkflowStep<unknown, unknown>, options);
    this.lastStepId = stepId;
    return this as unknown as WorkflowBuilder<TInput, TO>;
  }

  then<TI, TO>(
    stepId: string,
    step: WorkflowStep<TI, TO>,
    options?: StepOptions
  ): WorkflowBuilder<TInput, TO> {
    const mappedOptions: StepOptions = {
      ...options,
      input: options?.input || (this.lastStepId ? { fromStep: this.lastStepId } : undefined),
    };
    return this.step(stepId, step, mappedOptions);
  }

  parallel<TI, TO>(
    stepIds: string[],
    steps: WorkflowStep<TI, TO>[],
    options?: ParallelOptions
  ): WorkflowBuilder<TInput, TO[]> {
    for (let i = 0; i < stepIds.length; i++) {
      this.executor.addStep(stepIds[i], steps[i] as WorkflowStep<unknown, unknown>);
    }
    this.lastStepId = null;
    return this as unknown as WorkflowBuilder<TInput, TO[]>;
  }

  branch<TI, TO>(
    condition: (ctx: WorkflowContext) => boolean,
    branches: {
      true: { id: string; step: WorkflowStep<TI, TO> };
      false: { id: string; step: WorkflowStep<TI, TO> };
    },
    options?: BranchOptions
  ): WorkflowBuilder<TInput, TO> {
    this.executor.setBranch(
      condition,
      {
        id: branches.true.id,
        step: branches.true.step as WorkflowStep<unknown, unknown>,
      },
      {
        id: branches.false.id,
        step: branches.false.step as WorkflowStep<unknown, unknown>,
      }
    );
    return this as unknown as WorkflowBuilder<TInput, TO>;
  }

  loop<TI, TO>(
    condition: (ctx: WorkflowContext, iteration: number) => boolean,
    loopStep: { id: string; step: WorkflowStep<TI, TO> },
    options?: LoopOptions
  ): WorkflowBuilder<TInput, TO> {
    this.executor.setLoop(
      condition,
      {
        id: loopStep.id,
        step: loopStep.step as WorkflowStep<unknown, unknown>,
      },
      options?.maxIterations
    );
    return this as unknown as WorkflowBuilder<TInput, TO>;
  }

  commit(): CommittedWorkflow<TInput, TOutput> {
    const executor = this.executor;
    const workflowId = this.id;

    return {
      id: workflowId,
      async run(input: TInput): Promise<TOutput> {
        return executor.execute(input);
      },
    };
  }
}

export function createWorkflow<TInput = unknown>(config: { id: string }): Workflow<TInput, TInput> {
  return new WorkflowBuilder<TInput, TInput>(config.id);
}
