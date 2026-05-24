import type { PipelineContext, ProcessorControl, ProcessorContext as IProcessorContext, StageName, PipelineCheckpoint } from '@primo-ai/sdk';
import { AbortControlFlow, SuspendControlFlow, ErrorControlFlow } from './control-flow.js';

/** @internal */
export interface StreamHandle {
  fullStream?: AsyncIterable<unknown>;
  usagePromise?: Promise<import('@primo-ai/sdk').TokenUsage | null>;
  reasoningPromise?: Promise<string | undefined>;
}

/**
 * Deep clone a value, handling frozen objects and circular references.
 */
function deepClone<T>(obj: T, seen: WeakMap<object, object> = new WeakMap()): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj as object)) return seen.get(obj as object) as T;

  // Handle Date
  if (obj instanceof Date) return new Date(obj) as T;

  // Handle Array
  if (Array.isArray(obj)) {
    const clone: unknown[] = [];
    seen.set(obj as object, clone);
    for (let i = 0; i < obj.length; i++) {
      clone[i] = deepClone(obj[i], seen);
    }
    return clone as T;
  }

  // Handle plain objects
  if (Object.getPrototypeOf(obj) === Object.prototype || Object.getPrototypeOf(obj) === null) {
    const clone: Record<string, unknown> = {};
    seen.set(obj as object, clone);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      clone[key] = deepClone((obj as Record<string, unknown>)[key], seen);
    }
    return clone as T;
  }

  // For other objects (like Spans, etc.), return as-is (they should be immutable or not modified)
  return obj;
}

/**
 * Implementation of ProcessorContext.
 * Provides state access and control flow API for processors.
 */
export class ProcessorContextImpl implements IProcessorContext {
  private _state: PipelineContext;

  /** @internal Stream handle — not part of public API */
  _streamHandle?: StreamHandle;

  /** @internal Per-stage span — moved from IterationRegion */
  private _span?: import('@primo-ai/sdk').Span;

  constructor(state: PipelineContext) {
    // Deep clone to ensure the state is mutable even if the input was frozen
    this._state = deepClone(state) as PipelineContext;
  }

  get state(): PipelineContext {
    return this._state;
  }

  get control(): ProcessorControl {
    return {
      abort: (reason: string, retryFrom?: StageName): never => {
        throw new AbortControlFlow(reason, retryFrom);
      },
      suspend: (suspensionId: string, checkpoint?: Partial<PipelineCheckpoint>): never => {
        throw new SuspendControlFlow(suspensionId, checkpoint);
      },
      error: (error: Error, stage: StageName, recoverable: boolean = false): never => {
        throw new ErrorControlFlow(error, stage, recoverable);
      },
    };
  }

  /** @internal */
  get span(): import('@primo-ai/sdk').Span | undefined {
    return this._span;
  }

  /** @internal */
  set span(s: import('@primo-ai/sdk').Span | undefined) {
    this._span = s;
  }
}

/**
 * Create a ProcessorContext from a PipelineContext.
 */
export function createProcessorContext(state: PipelineContext): IProcessorContext {
  return new ProcessorContextImpl(state);
}
