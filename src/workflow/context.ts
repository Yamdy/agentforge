import type { WorkflowContext } from './types.js';

export class WorkflowContextImpl implements WorkflowContext {
  private results: Map<string, unknown> = new Map();
  private state: Record<string, unknown> = {};

   getResult<T = unknown>(stepId: string): T | undefined {
    return this.results.get(stepId) as T | undefined;
  }

  setResult(stepId: string, result: unknown): void {
    this.results.set(stepId, result);
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  setState(state: Record<string, unknown>): void {
    this.state = { ...state };
  }
}
