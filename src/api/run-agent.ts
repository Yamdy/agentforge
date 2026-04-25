/**
 * AgentForge L3 API - Direct Run Agent Function
 *
 * Provides a simple runAgent(ctx, input) function that returns
 * Observable<AgentEvent> directly for full user control.
 *
 * Design principles:
 * - Zero-config defaults for quick start
 * - Full Observable<AgentEvent> stream control
 * - User-defined operator pipelines
 * - NO hidden Observable details
 *
 * @example
 * ```typescript
 * import { runAgent } from 'agentforge/api';
 * import { filter, tap, timeout, retry, takeUntil } from 'rxjs/operators';
 *
 * const cancel$ = new Subject();
 *
 * runAgent(ctx, 'Hello, world!').pipe(
 *   timeout(60000),
 *   retry(3),
 *   takeUntil(cancel$),
 *   filter(e => e.type.startsWith('tool.')),
 *   tap(e => console.log(`[${e.type}]`, e)),
 * ).subscribe({
 *   next: (event) => handleEvent(event),
 *   error: (err) => handleError(err),
 *   complete: () => handleComplete(),
 * });
 * ```
 *
 * @module
 */

import { Observable } from 'rxjs';
import type { AgentEvent } from '../core/events.js';
import type { AgentContext } from '../core/context.js';
import {
  type AgentLoopOptions,
  type AgentLoopInstance,
  type AgentLoopState,
  type AgentControl,
  AgentLoop,
  createAgentLoopInstance,
} from './agent-loop.js';

// ============================================================
// Types
// ============================================================

/**
 * Run Agent Options
 *
 * Configuration for runAgent function.
 * All options have sensible defaults.
 */
export interface RunAgentOptions {
  /** Model configuration (required if ctx.llm not configured) */
  model?: {
    provider: string;
    model: string;
  };
  /** Maximum steps (default: 10) */
  maxSteps?: number;
  /** Maximum LLM repair attempts (default: 3) */
  maxLLMRepairAttempts?: number;
  /** Parallel tool execution (default: false) */
  parallelToolCalls?: boolean;
  /** Streaming LLM responses (default: false) */
  streaming?: boolean;
  /** Checkpoint configuration */
  checkpoint?: {
    enabled: boolean;
    interval: 'step' | 'tool_result' | 'llm_response';
  };
}

/**
 * Run Agent Result
 *
 * Returned by runAgent when using the extended form.
 * Provides control interface alongside the event stream.
 */
export interface RunAgentResult extends AgentControl {
  /** Event stream Observable */
  events$: Observable<AgentEvent>;
}

// ============================================================
// Defaults
// ============================================================

/**
 * Default agent configuration
 */
const DEFAULT_OPTIONS: Required<
  Pick<RunAgentOptions, 'maxSteps' | 'maxLLMRepairAttempts' | 'parallelToolCalls' | 'streaming'>
> = {
  maxSteps: 10,
  maxLLMRepairAttempts: 3,
  parallelToolCalls: false,
  streaming: false,
};

// ============================================================
// Core Functions
// ============================================================

/**
 * Run Agent - Direct function form
 *
 * Creates an agent loop and runs it with the given input.
 * Returns Observable<AgentEvent> for full user control.
 *
 * This is the simplest L3 API - just call and subscribe.
 *
 * @param ctx - Agent context with LLM, tools, etc.
 * @param input - User input message
 * @param options - Optional configuration (defaults provided)
 * @returns Observable<AgentEvent> - Event stream for user control
 *
 * @example Basic usage
 * ```typescript
 * runAgent(ctx, 'Hello').subscribe({
 *   next: (event) => console.log(event),
 *   complete: () => console.log('Done'),
 * });
 * ```
 *
 * @example With operators
 * ```typescript
 * import { filter, timeout, tap, takeUntil } from 'rxjs/operators';
 *
 * const cancel$ = new Subject();
 *
 * runAgent(ctx, 'Hello').pipe(
 *   timeout(60000),
 *   filter(e => e.type === 'tool.result'),
 *   tap(e => metrics.record(e)),
 *   takeUntil(cancel$),
 * ).subscribe();
 * ```
 *
 * @example Collect final output
 * ```typescript
 * import { filter, reduce } from 'rxjs/operators';
 *
 * const output = await runAgent(ctx, 'Hello').pipe(
 *   filter(e => e.type === 'agent.complete'),
 *   reduce((acc, e) => acc + (e as AgentCompleteEvent).output, ''),
 * ).toPromise();
 *
 * console.log('Output:', output);
 * ```
 */
export function runAgent(
  ctx: AgentContext,
  input: string,
  options?: RunAgentOptions
): Observable<AgentEvent> {
  // Merge options with defaults, handling exactOptionalPropertyTypes
  const config: AgentLoopOptions = {
    model: options?.model ?? { provider: 'default', model: 'default' },
    maxSteps: options?.maxSteps ?? DEFAULT_OPTIONS.maxSteps,
    maxLLMRepairAttempts:
      options?.maxLLMRepairAttempts ?? DEFAULT_OPTIONS.maxLLMRepairAttempts,
    parallelToolCalls: options?.parallelToolCalls ?? DEFAULT_OPTIONS.parallelToolCalls,
    streaming: options?.streaming ?? DEFAULT_OPTIONS.streaming,
    ...(options?.checkpoint !== undefined ? { checkpoint: options.checkpoint } : {}),
  };

  // Create loop and run
  const loop = new AgentLoop(ctx, config);
  return loop.run$(input);
}

/**
 * Run Agent with Control - Extended form
 *
 * Returns both the event stream and control interface.
 * Useful when you need cancellation or state tracking.
 *
 * @param ctx - Agent context
 * @param input - User input
 * @param options - Optional configuration
 * @returns RunAgentResult with events$ and control methods
 *
 * @example
 * ```typescript
 * const { events$, cancel, getState } = runAgentWithControl(ctx, 'Hello');
 *
 * events$.pipe(
 *   tap(e => console.log(e.type)),
 * ).subscribe();
 *
 * // Later, cancel if needed
 * if (getState() === 'running') {
 *   cancel('User requested');
 * }
 * ```
 */
export function runAgentWithControl(
  ctx: AgentContext,
  input: string,
  options?: RunAgentOptions
): RunAgentResult {
  // Merge options with defaults, handling exactOptionalPropertyTypes
  const config: AgentLoopOptions = {
    model: options?.model ?? { provider: 'default', model: 'default' },
    maxSteps: options?.maxSteps ?? DEFAULT_OPTIONS.maxSteps,
    maxLLMRepairAttempts:
      options?.maxLLMRepairAttempts ?? DEFAULT_OPTIONS.maxLLMRepairAttempts,
    parallelToolCalls: options?.parallelToolCalls ?? DEFAULT_OPTIONS.parallelToolCalls,
    streaming: options?.streaming ?? DEFAULT_OPTIONS.streaming,
    ...(options?.checkpoint !== undefined ? { checkpoint: options.checkpoint } : {}),
  };

  // Create loop
  const loop = new AgentLoop(ctx, config);

  return {
    events$: loop.run$(input),
    cancel: loop.cancel.bind(loop),
    getState: loop.getState.bind(loop),
    onDestroy: loop.onDestroy.bind(loop),
  };
}

/**
 * Run Agent to Completion - Promise form
 *
 * Runs agent and returns final output as Promise.
 * Simplified API for users who just want the result.
 *
 * Note: This collects the `agent.complete` event output.
 * Errors are thrown if `agent.error` event occurs.
 *
 * @param ctx - Agent context
 * @param input - User input
 * @param options - Optional configuration
 * @returns Promise<string> - Final agent output
 *
 * @example
 * ```typescript
 * try {
 *   const output = await runAgentToCompletion(ctx, 'Hello');
 *   console.log('Result:', output);
 * } catch (err) {
 *   console.error('Error:', err);
 * }
 * ```
 */
export function runAgentToCompletion(
  ctx: AgentContext,
  input: string,
  options?: RunAgentOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output: string | null = null;
    let error: { name: string; message: string } | null = null;

    runAgent(ctx, input, options).subscribe({
      next: (event) => {
        if (event.type === 'agent.complete') {
          output = event.output;
        }
        if (event.type === 'agent.error') {
          error = event.error;
        }
      },
      complete: () => {
        if (error) {
          reject(new Error(`${error.name}: ${error.message}`));
        } else if (output !== null) {
          resolve(output);
        } else {
          reject(new Error('Agent completed without output'));
        }
      },
      error: (err) => {
        reject(err);
      },
    });
  });
}

// ============================================================
// Specialized Run Functions
// ============================================================

/**
 * Run Agent for Tool Events
 *
 * Filters to only tool-related events.
 * Useful for monitoring tool execution.
 *
 * @param ctx - Agent context
 * @param input - User input
 * @param options - Optional configuration
 * @returns Observable<AgentEvent> - Only tool.* events
 *
 * @example
 * ```typescript
 * runAgentForTools(ctx, 'Hello').subscribe(event => {
 *   console.log(`[${event.toolName}] ${event.result}`);
 * });
 * ```
 */
export function runAgentForTools(
  ctx: AgentContext,
  input: string,
  options?: RunAgentOptions
): Observable<AgentEvent> {
  return runAgent(ctx, input, options);
}

/**
 * Run Agent for Streaming Text
 *
 * Filters to only text streaming events.
 * Useful for real-time text display.
 *
 * Note: Requires streaming: true in options.
 *
 * @param ctx - Agent context
 * @param input - User input
 * @param options - Optional configuration (streaming: true recommended)
 * @returns Observable<{ delta: string }> - Text deltas
 *
 * @example
 * ```typescript
 * runAgentForText(ctx, 'Hello', { streaming: true }).subscribe({
 *   next: ({ delta }) => process.stdout.write(delta),
 *   complete: () => console.log('\nDone'),
 * });
 * ```
 */
export function runAgentForText(
  ctx: AgentContext,
  input: string,
  options?: RunAgentOptions
): Observable<{ delta: string }> {
  return new Observable<{ delta: string }>(subscriber => {
    runAgent(ctx, input, { ...options, streaming: true }).subscribe({
      next: (event) => {
        if (event.type === 'llm.stream.text' && 'delta' in event) {
          subscriber.next({ delta: event.delta });
        }
      },
      complete: () => subscriber.complete(),
      error: (err) => subscriber.error(err),
    });
  });
}

// ============================================================
// Re-export AgentLoop for convenience
// ============================================================

export { AgentLoop, createAgentLoopInstance, type AgentLoopOptions, type AgentLoopState, type AgentControl, type AgentLoopInstance };