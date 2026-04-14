import { Observable } from 'rxjs';
import type { Agent } from '../agent/index.js';
import type { Message } from '../types.js';

export interface WorkflowStep<TInput = unknown, TOutput = unknown> {
  id: string;
  description?: string;
  execute: (input: TInput, context: WorkflowContext) => Promise<TOutput>;
}

export interface WorkflowContext {
  getResult<T = unknown>(stepId: string): T | undefined;
  setResult(stepId: string, result: unknown): void;
  getState(): Record<string, unknown>;
  setState(state: Record<string, unknown>): void;
}

export interface Workflow<TInput = unknown, TOutput = unknown> {
  id: string;
  step<TI, TO>(
    stepId: string,
    step: WorkflowStep<TI, TO>,
    options?: StepOptions
  ): Workflow<TInput, TO>;
  then<TI, TO>(
    stepId: string,
    step: WorkflowStep<TI, TO>,
    options?: StepOptions
  ): Workflow<TInput, TO>;
  parallel<TI, TO>(
    stepIds: string[],
    steps: WorkflowStep<TI, TO>[],
    options?: ParallelOptions
  ): Workflow<TInput, TO[]>;
  branch<TI, TO>(
    condition: (ctx: WorkflowContext) => boolean,
    branches: {
      true: { id: string; step: WorkflowStep<TI, TO> };
      false: { id: string; step: WorkflowStep<TI, TO> };
    },
    options?: BranchOptions
  ): Workflow<TInput, TO>;
  loop<TI, TO>(
    condition: (ctx: WorkflowContext, iteration: number) => boolean,
    loopStep: { id: string; step: WorkflowStep<TI, TO> },
    options?: LoopOptions
  ): Workflow<TInput, TO>;
  commit(): CommittedWorkflow<TInput, TOutput>;
}

export interface WorkflowSuspendResult {
  /**
   * Whether the workflow is currently suspended waiting for resume
   */
  suspended: true;
  /**
   * Persisted state that can be used to resume the workflow later
   */
  state: Record<string, unknown>;
  /**
   * Message to display to the user explaining what input is needed for resume
   */
  message?: string;
}

export interface CommittedWorkflow<TInput = unknown, TOutput = unknown> {
  id: string;
  run(input: TInput): Promise<TOutput | WorkflowSuspendResult>;
}

export interface StepOptions {
  description?: string;
  input?: InputMapping;
}

export interface InputMapping {
  fromStep?: string;
  path?: string;
}

export interface ParallelOptions {
  description?: string;
}

export interface BranchOptions {
  description?: string;
}

export interface LoopOptions {
  description?: string;
  maxIterations?: number;
}

export interface MsgHubConfig {
  participants: Agent[];
  announcement?: Message | Message[];
  enableAutoBroadcast?: boolean;
  maxBroadcastDepth?: number;
  name?: string;
}

export interface MsgHub {
  participants: Agent[];
  name?: string;
  add(agent: Agent): void;
  delete(agent: Agent): void;
  broadcast(message: Message): void;
  messages$: Observable<Message>;
  [Symbol.asyncDispose](): Promise<void>;
}

export type PipelineFunction = (
  agents: Agent[],
  msg?: Message | Message[]
) => Promise<Message | Message[]>;
