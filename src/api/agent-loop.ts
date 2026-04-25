/**
 * AgentForge L3 API - AgentLoop Public Wrapper
 *
 * Exposes AgentLoop.run() returning Observable<AgentEvent> for full control.
 * L3 users can apply custom operators, control flow, and handle events directly.
 *
 * Design principles:
 * - Expose full Observable<AgentEvent> stream control
 * - NO hidden Observable details
 * - Allow user-defined operator pipelines
 * - NO `as any` - all types properly inferred
 *
 * @example
 * ```typescript
 * import { AgentLoop } from 'agentforge/api';
 * import { filter, tap, timeout } from 'rxjs/operators';
 *
 * const agent = new AgentLoop(ctx, config);
 *
 * agent.run$('Hello, world!').pipe(
 *   timeout(60000),
 *   filter(e => e.type.startsWith('tool.')),
 *   tap(console.log),
 * ).subscribe({
 *   next: (event) => console.log(event),
 *   error: (err) => console.error(err),
 *   complete: () => console.log('Done'),
 * });
 * ```
 *
 * @module
 */

import { Observable, Subject } from 'rxjs';
import { takeUntil, finalize } from 'rxjs/operators';
import {
  createAgentLoop,
  type AgentLoopConfig,
  type AgentLoop as AgentLoopInternal,
} from '../loop/agent-loop.js';
import type { AgentEvent } from '../core/events.js';
import type { AgentContext } from '../core/context.js';

// ============================================================
// Types
// ============================================================

/**
 * Agent Loop Configuration (public interface)
 *
 * Configuration for the agent loop behavior.
 */
export interface AgentLoopOptions {
  /** Model configuration */
  model: {
    provider: string;
    model: string;
  };
  /** Maximum steps before termination (default: 10) */
  maxSteps?: number;
  /** Maximum LLM repair attempts for invalid output (default: 3) */
  maxLLMRepairAttempts?: number;
  /** Enable parallel tool execution (default: false) */
  parallelToolCalls?: boolean;
  /** Enable streaming LLM responses (default: false) */
  streaming?: boolean;
  /** Checkpoint configuration */
  checkpoint?: {
    enabled: boolean;
    interval: 'step' | 'tool_result' | 'llm_response';
  };
}

/**
 * Agent Loop State
 *
 * Represents the current state of the agent loop.
 */
export type AgentLoopState = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

/**
 * Agent Control Interface
 *
 * Methods to control agent execution.
 */
export interface AgentControl {
  /** Cancel execution and complete the stream */
  cancel(reason?: string): void;
  /** Get current state */
  getState(): AgentLoopState;
  /** Observable that emits when destroyed */
  onDestroy(): Observable<void>;
}

/**
 * Agent Loop Instance
 *
 * Combines run() with control interface.
 */
export interface AgentLoopInstance extends AgentControl {
  /** Run agent and return event stream */
  run$(input: string): Observable<AgentEvent>;
}

// ============================================================
// AgentLoop Class
// ============================================================

/**
 * AgentLoop - L3 Programmatic API
 *
 * Provides full control over agent execution via Observable streams.
 * L3 users can apply custom RxJS operators to process events.
 *
 * This is the core building block for:
 * - Framework developers building higher-level APIs
 * - Power users needing fine-grained control
 * - Integrations with custom observability pipelines
 *
 * @example Basic usage
 * ```typescript
 * const loop = new AgentLoop(ctx, { model: { provider: 'openai', model: 'gpt-4o' } });
 *
 * loop.run$('Hello').subscribe(event => {
 *   console.log(event.type, event);
 * });
 * ```
 *
 * @example With operators
 * ```typescript
 * import { filter, timeout, retry, tap, takeUntil } from 'rxjs/operators';
 *
 * loop.run$('Hello').pipe(
 *   timeout(60000),
 *   retry(3),
 *   filter(e => e.type.startsWith('tool.')),
 *   tap(e => metrics.record(e)),
 * ).subscribe();
 * ```
 */
export class AgentLoop implements AgentLoopInstance {
  private readonly internalLoop: AgentLoopInternal;
  private readonly destroy$ = new Subject<void>();
  private readonly cancel$ = new Subject<void>();
  private state: AgentLoopState = 'idle';

  /**
   * Create a new AgentLoop instance
   *
   * @param _ctx - Agent context with dependencies (LLM, tools, etc.)
   * @param options - Loop configuration options
   */
  constructor(
    _ctx: AgentContext,
    options: AgentLoopOptions
  ) {
    const config: AgentLoopConfig = {
      model: options.model,
      maxSteps: options.maxSteps ?? 10,
      maxLLMRepairAttempts: options.maxLLMRepairAttempts ?? 3,
      parallelToolCalls: options.parallelToolCalls ?? false,
      ...(options.streaming !== undefined ? { streaming: options.streaming } : {}),
      ...(options.checkpoint !== undefined ? { checkpoint: options.checkpoint } : {}),
    };

    this.internalLoop = createAgentLoop(_ctx, config);
  }

  /**
   * Run the agent and return an Observable event stream
   *
   * Returns the full Observable<AgentEvent> stream for user control.
   * Users can apply any RxJS operators to process events.
   *
   * Key events:
   * - `agent.start` - Agent started
   * - `agent.step` - Step counter updated
   * - `llm.request` - LLM request initiated
   * - `llm.response` - LLM response received
   * - `llm.stream.text` - Streaming text chunk (if streaming enabled)
   * - `tool.call` - Tool call initiated
   * - `tool.execute` - Tool execution started
   * - `tool.result` - Tool execution result
   * - `agent.complete` - Agent completed with output
   * - `agent.error` - Error occurred
   * - `done` - Stream terminated (terminal event)
   *
   * @param input - User input message
   * @returns Observable<AgentEvent> - Event stream
   *
   * @example
   * ```typescript
   * loop.run$('Hello').pipe(
   *   filter(e => e.type === 'llm.stream.text'),
   *   map(e => (e as LLMSreamTextEvent).delta),
   * ).subscribe({
   *   next: (text) => process.stdout.write(text),
   *   complete: () => console.log('Done'),
   * });
   * ```
   */
  run$(input: string): Observable<AgentEvent> {
    this.state = 'running';

    return this.internalLoop.run(input).pipe(
      takeUntil(this.cancel$),
      takeUntil(this.destroy$),
      finalize(() => {
        this.state = 'idle';
      })
    );
  }

  /**
   * Cancel current execution
   *
   * Completes the event stream with a cancel signal.
   * The agent will emit a `done` event with reason 'cancelled'.
   *
   * @param reason - Optional cancellation reason
   */
  cancel(reason?: string): void {
    this.state = 'cancelled';
    this.cancel$.next();

    // Log cancellation reason if provided
    if (reason) {
      // eslint-disable-next-line no-console
      console.log(`[AgentLoop] Cancelled: ${reason}`);
    }
  }

  /**
   * Get current state
   *
   * @returns Current agent loop state
   */
  getState(): AgentLoopState {
    return this.state;
  }

  /**
   * Observable that emits when the loop is destroyed
   *
   * Useful for cleanup in operator pipelines.
   *
   * @returns Observable<void> - Emits on destroy
   */
  onDestroy(): Observable<void> {
    return this.destroy$.asObservable();
  }

  /**
   * Destroy the loop and release resources
   *
   * Completes all internal subjects and cleans up.
   * After destroy, the loop cannot be reused.
   */
  destroy(): void {
    this.cancel();
    this.destroy$.next();
    this.destroy$.complete();
    this.cancel$.complete();
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create an AgentLoop instance
 *
 * Convenience factory function for creating AgentLoop.
 *
 * @param ctx - Agent context with dependencies
 * @param options - Loop configuration options
 * @returns AgentLoop instance
 *
 * @example
 * ```typescript
 * import { createAgentLoop } from 'agentforge/api';
 *
 * const loop = createAgentLoop(ctx, {
 *   model: { provider: 'openai', model: 'gpt-4o' },
 *   maxSteps: 10,
 * });
 *
 * loop.run$('Hello').subscribe(console.log);
 * ```
 */
export function createAgentLoopInstance(
  ctx: AgentContext,
  options: AgentLoopOptions
): AgentLoopInstance {
  return new AgentLoop(ctx, options);
}
