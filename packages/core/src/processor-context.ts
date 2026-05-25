import type { PipelineContext, ProcessorControl, ProcessorContext as IProcessorContext, StageName, PipelineCheckpoint, ContextModificationRecord, BuiltinProcessorName } from '@primo-ai/sdk';
import { AbortControlFlow, SuspendControlFlow, ErrorControlFlow } from './control-flow.js';

/** @internal */
export interface StreamHandle {
  fullStream?: AsyncIterable<unknown>;
  usagePromise?: Promise<import('@primo-ai/sdk').TokenUsage | null>;
  reasoningPromise?: Promise<string | undefined>;
}

/** Built-in processor names for namespace validation exemption. */
const BUILTIN_PROCESSORS: ReadonlySet<string> = new Set<string>([
  'processInput', 'buildContext', 'prepareStep', 'gateLLM',
  'invokeLLM', 'processStepOutput', 'gateTool',
  'executeTools', 'compressContext', 'evaluateIteration', 'processOutput',
]);

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
 * Provides state access, control flow API, and modification tracking for processors.
 */
export class ProcessorContextImpl implements IProcessorContext {
  private _state: PipelineContext;

  /** @internal Stream handle — not part of public API */
  _streamHandle?: StreamHandle;

  /** @internal Per-stage span — moved from IterationRegion */
  private _span?: import('@primo-ai/sdk').Span;

  /** @internal Processor name for modification tracking and namespace validation. */
  _processorName?: string;

  /** @internal Callback to emit events when modifications are recorded. */
  _onModification?: (modifications: ContextModificationRecord[]) => void;

  constructor(state: PipelineContext) {
    // Deep clone to ensure the state is mutable even if the input was frozen
    this._state = deepClone(state) as PipelineContext;
    // Ensure __modifications array exists
    if (!this._state.__modifications) {
      this._state.__modifications = [];
    }
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

  /**
   * Set namespaced state with modification tracking.
   * Enforces dot-separated namespace prefix for third-party plugins.
   * Built-in processors are exempt from the namespace prefix requirement.
   */
  setState(namespace: string, value: unknown): void {
    // Namespace validation: plugins must use dot-separated prefix matching their processor name
    if (this._processorName && !BUILTIN_PROCESSORS.has(this._processorName)) {
      if (!namespace.includes('.')) {
        throw new Error(
          `Namespace validation error: plugin "${this._processorName}" must use dot-separated namespace prefix (e.g., "pluginName.key"), got "${namespace}"`,
        );
      }
      const prefix = namespace.split('.')[0];
      if (prefix !== this._processorName) {
        throw new Error(
          `Namespace validation error: plugin "${this._processorName}" must use its own name as prefix, got "${prefix}" (expected "${this._processorName}.<key>")`,
        );
      }
    }

    // Record modification
    const previousValue = this._state.session.custom[namespace];
    const mod: ContextModificationRecord = {
      processor: this._processorName ?? 'unknown',
      field: namespace,
      timestamp: Date.now(),
      previousValue: Object.prototype.hasOwnProperty.call(this._state.session.custom, namespace) ? previousValue : undefined,
    };

    this._state.session.custom[namespace] = value;
    this._state.__modifications!.push(mod);

    // Notify listener (e.g., PipelineRunner to emit event)
    this._onModification?.([mod]);
  }

  /**
   * Get namespaced state from session.custom.
   */
  getState<T = unknown>(namespace: string): T | undefined {
    return this._state.session.custom[namespace] as T | undefined;
  }

  /**
   * Return all modification records accumulated so far.
   */
  getModifications(): ContextModificationRecord[] {
    return [...(this._state.__modifications ?? [])];
  }

  /**
   * Return all dot-separated namespace prefixes used in session.custom.
   */
  getNamespaces(): string[] {
    const prefixes = new Set<string>();
    for (const key of Object.keys(this._state.session.custom)) {
      const dotIndex = key.indexOf('.');
      if (dotIndex > 0) {
        prefixes.add(key.substring(0, dotIndex));
      }
    }
    return [...prefixes];
  }
}

/**
 * Create a ProcessorContext from a PipelineContext.
 */
export function createProcessorContext(state: PipelineContext): IProcessorContext {
  return new ProcessorContextImpl(state);
}
