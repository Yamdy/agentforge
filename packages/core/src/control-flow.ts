import type { StageName, PipelineCheckpoint } from '@primo-ai/sdk';

/**
 * Control flow error thrown when a processor calls ctx.control.abort().
 * PipelineRunner catches this and converts it to an AbortSignal.
 */
export class AbortControlFlow extends Error {
  constructor(
    public readonly reason: string,
    public readonly retryFrom?: StageName,
  ) {
    super(`Abort: ${reason}`);
    this.name = 'AbortControlFlow';
  }
}

/**
 * Control flow error thrown when a processor calls ctx.control.suspend().
 * PipelineRunner catches this and converts it to a SuspensionSignal.
 */
export class SuspendControlFlow extends Error {
  constructor(
    public readonly suspensionId: string,
    public readonly checkpoint?: Partial<PipelineCheckpoint>,
  ) {
    super(`Suspend: ${suspensionId}`);
    this.name = 'SuspendControlFlow';
  }
}

/**
 * Control flow error thrown when a processor calls ctx.control.error().
 * PipelineRunner catches this and converts it to an ErrorResult.
 */
export class ErrorControlFlow extends Error {
  constructor(
    public readonly originalError: Error,
    public readonly stage: StageName,
    public readonly recoverable: boolean = false,
  ) {
    super(`Error at ${stage}: ${originalError.message}`);
    this.name = 'ErrorControlFlow';
  }
}

/**
 * Check if an error is an AbortControlFlow.
 */
export function isAbortControlFlow(error: unknown): error is AbortControlFlow {
  return error instanceof AbortControlFlow;
}

/**
 * Check if an error is a SuspendControlFlow.
 */
export function isSuspendControlFlow(error: unknown): error is SuspendControlFlow {
  return error instanceof SuspendControlFlow;
}

/**
 * Check if an error is an ErrorControlFlow.
 */
export function isErrorControlFlow(error: unknown): error is ErrorControlFlow {
  return error instanceof ErrorControlFlow;
}
