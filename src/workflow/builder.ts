/**
 * AgentForge Declarative Workflow Builder
 *
 * Compiles chain API calls into a validated WorkflowConfig.
 *
 * @module
 */

import type { StepEntry, StepFlowEntry, WorkflowConfig } from './types.js';
import { WorkflowConfigSchema } from './types.js';

export interface WorkflowBuilderOptions {
  name?: string | undefined;
  continueOnFailure?: boolean | undefined;
  maxRetries?: number | undefined;
}

/** Sub-builder — same API as top-level builder, no .commit() */
export interface SubflowBuilder {
  then(step: StepEntry): this;
  branch(
    condition: (input: unknown) => boolean,
    thenFlow: (builder: SubflowBuilder) => void,
    elseFlow?: (builder: SubflowBuilder) => void
  ): this;
  parallel(branches: ((builder: SubflowBuilder) => void)[], maxConcurrency?: number): this;
  foreach(
    items: (input: unknown) => unknown[],
    body: (builder: SubflowBuilder) => void,
    maxConcurrency?: number
  ): this;
}

export interface WorkflowBuilder {
  then(step: StepEntry): this;
  branch(
    condition: (input: unknown) => boolean,
    thenFlow: (builder: SubflowBuilder) => void,
    elseFlow?: (builder: SubflowBuilder) => void
  ): this;
  parallel(branches: ((builder: SubflowBuilder) => void)[], maxConcurrency?: number): this;
  foreach(
    items: (input: unknown) => unknown[],
    body: (builder: SubflowBuilder) => void,
    maxConcurrency?: number
  ): this;
  commit(): WorkflowConfig;
}

/** Internal implementation — accumulates StepFlowEntry[] */
class BuilderCore {
  protected _entries: StepFlowEntry[] = [];

  then(step: StepEntry): this {
    this._entries.push(step);
    return this;
  }

  branch(
    condition: (input: unknown) => boolean,
    thenFlow: (builder: SubflowBuilder) => void,
    elseFlow?: (builder: SubflowBuilder) => void | undefined
  ): this {
    const thenBuilder = new SubflowBuilderImpl();
    thenFlow(thenBuilder);
    let elseEntries: StepFlowEntry[] | undefined;
    if (elseFlow) {
      const elseBuilder = new SubflowBuilderImpl();
      elseFlow(elseBuilder);
      elseEntries = elseBuilder._entries;
    }
    this._entries.push({
      type: 'branch',
      id: `branch_${this._entries.length}`,
      condition,
      then: thenBuilder._entries,
      else: elseEntries,
    });
    return this;
  }

  parallel(branches: ((builder: SubflowBuilder) => void)[], maxConcurrency?: number): this {
    const branchEntries = branches.map(b => {
      const bBuilder = new SubflowBuilderImpl();
      b(bBuilder);
      return bBuilder._entries;
    });
    this._entries.push({
      type: 'parallel',
      id: `parallel_${this._entries.length}`,
      branches: branchEntries,
      ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
    });
    return this;
  }

  foreach(
    items: (input: unknown) => unknown[],
    body: (builder: SubflowBuilder) => void,
    maxConcurrency?: number
  ): this {
    const bodyBuilder = new SubflowBuilderImpl();
    body(bodyBuilder);
    this._entries.push({
      type: 'foreach',
      id: `foreach_${this._entries.length}`,
      items,
      body: bodyBuilder._entries,
      ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
    });
    return this;
  }
}

/** Sub-builder impl — no .commit() */
class SubflowBuilderImpl extends BuilderCore implements SubflowBuilder {}

/** Top-level builder impl — adds .commit() */
class WorkflowBuilderImpl extends BuilderCore implements WorkflowBuilder {
  private _id: string;
  private _options: WorkflowBuilderOptions;

  constructor(id: string, options: WorkflowBuilderOptions = {}) {
    super();
    this._id = id;
    this._options = options;
  }

  commit(): WorkflowConfig {
    const config = {
      id: this._id,
      name: this._options.name ?? this._id,
      steps: [...this._entries],
      ...(this._options.continueOnFailure !== undefined
        ? { continueOnFailure: this._options.continueOnFailure }
        : {}),
      ...(this._options.maxRetries !== undefined ? { maxRetries: this._options.maxRetries } : {}),
    };
    return WorkflowConfigSchema.parse(config);
  }
}

export function workflow(id: string, options?: WorkflowBuilderOptions): WorkflowBuilder {
  return new WorkflowBuilderImpl(id, options) as unknown as WorkflowBuilder;
}

/** Create a sub-flow builder for use in branch/parallel/foreach callbacks */
export function subflow(): SubflowBuilder {
  return new SubflowBuilderImpl() as unknown as SubflowBuilder;
}
