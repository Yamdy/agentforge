/**
 * AgentForge Agent Loop Implementation
 *
 * Core expand-based agent loop using RxJS + Zod.
 * This is the heart of the framework - handles event routing, LLM calls,
 * tool execution, and state management.
 *
 * Design principles:
 * - Observable<AgentEvent> stream with expand recursion
 * - State passed through StepContext, never mutated
 * - Errors as events (agent.error + done), never RxJS throws
 * - Terminal events (done, agent.error, cancel) return EMPTY
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN.md
 */

import { Observable, of, EMPTY, Subject } from 'rxjs';
import { expand, map, takeUntil, mergeMap, catchError, finalize, take } from 'rxjs/operators';
import {
  type AgentEvent,
  type AgentState,
  type AgentContext,
  type Message,
  isTerminalEvent,
  serializeError,
} from '../core/index.js';

import {
  handleAgentStart,
  handleLLMRequest,
  handleLLMResponse,
  handleLLMOutputInvalid,
  handleToolCall,
  handleToolResult,
  handleBatchComplete,
  handleHITLAsk,
} from './handlers/index.js';

// ============================================================
// Types
// ============================================================

/**
 * Step Context - passed through expand recursion
 *
 * Contains current event and state snapshot.
 * State is immutable - handlers return new state objects.
 */
export interface StepContext {
  event: AgentEvent;
  state: AgentState;
  /** Repair attempt counter (for LLM output invalidation) */
  repairAttempt?: number;
}

/**
 * Checkpoint configuration options
 */
export interface CheckpointConfig {
  /** Enable automatic checkpointing */
  enabled: boolean;
  /** When to save checkpoints */
  interval: 'step' | 'tool_result' | 'llm_response';
}

/**
 * Agent Loop Configuration
 */
export interface AgentLoopConfig {
  /** Model configuration for the agent */
  model: {
    provider: string;
    model: string;
  };
  /** Maximum steps before termination */
  maxSteps: number;
  /** Maximum LLM repair attempts for invalid output */
  maxLLMRepairAttempts: number;
  /** Enable parallel tool execution */
  parallelToolCalls: boolean;
  /** Enable streaming LLM responses */
  streaming?: boolean;
  /** Checkpoint configuration */
  checkpoint?: CheckpointConfig;
  /** Conversation history for multi-turn context */
  history?: Message[];
}

/**
 * Agent Loop Return Type
 */
export interface AgentLoop {
  /** Run the agent with input, returns event stream */
  run(input: string): Observable<AgentEvent>;
  /** Destroy signal for cleanup */
  destroy$: Observable<void>;
  /** Get the current agent state (null if not yet started) */
  getCurrentState(): AgentState | null;
}

/**
 * Handler Dependencies - passed to all extracted handler functions.
 *
 * Replaces closure-captured variables (ctx, config, sessionId) that
 * handlers previously accessed from the createAgentLoop scope.
 */
export interface HandlerDeps {
  ctx: AgentContext;
  config: AgentLoopConfig;
  sessionId: string;
  destroy$: Observable<void>;
}

// ============================================================
// Factory
// ============================================================

/**
 * Create Agent Loop
 *
 * Core factory function that creates an agent loop instance.
 * Uses expand recursion to process events until termination.
 *
 * @param ctx - Agent context with dependencies
 * @param config - Loop configuration
 * @returns Agent loop instance with run() method
 */
export function createAgentLoop(ctx: AgentContext, config: AgentLoopConfig): AgentLoop {
  const sessionId = ctx.sessionId;
  const destroy$ = new Subject<void>();
  let isRunning = false;
  let latestState: AgentState | null = null;

  // Build handler dependencies (replaces closure-captured variables)
  const deps: HandlerDeps = { ctx, config, sessionId, destroy$: destroy$.asObservable() };

  // ============================================================
  // Core Step Function - Routes all events
  // ============================================================

  /**
   * step() - Recursive step function for expand
   *
   * Routes events to appropriate handlers.
   * Terminal events return EMPTY to end the stream.
   */
  function step(sctx: StepContext): Observable<StepContext> {
    const { event, state } = sctx;

    // Track latest state for external access (e.g., pause/resume)
    latestState = state;

    // MPU M5: Audit terminal events before stream ends (fire-and-forget)
    if (event.type === 'agent.error') {
      ctx.auditLogger?.append({
        sessionId,
        agentName: state.agentName,
        eventType: 'agent.error',
        action: 'agent.error',
        resource: state.agentName,
        result: 'error',
        details: { error: event.error },
      });

      // MPU M4: Error classification + circuit breaker recording (fire-and-forget)
      if (ctx.errorClassifier && event.error) {
        try {
          const severity = ctx.errorClassifier.classify(event.error);
          if (severity === 'moderate' || severity === 'severe') {
            ctx.circuitBreaker?.recordFailure(severity);
          }
        } catch {
          // Error classifier failure must never crash the loop
        }
      }
    }

    // Terminal events end the stream
    if (isTerminalEvent(event)) {
      return EMPTY;
    }

    // Pause check: block the loop while paused
    //
    // Design spec: "Use NEVER to block, not bufferToggle (avoids memory leak)"
    // Current implementation: onResume() Observable is functionally equivalent to
    // NEVER + external resume signal — it blocks the stream without buffering events
    // and requires an explicit resume() call to continue.
    // When paused, expand recursion is suspended until resume signal fires,
    // then step(sctx) re-processes the current event with the updated state.
    if (ctx.pauseController.isPaused()) {
      return ctx.pauseController.onResume().pipe(
        take(1),
        mergeMap(() => step(sctx))
      );
    }

    switch (event.type) {
      case 'agent.start':
        return handleAgentStart(deps, state, event);

      case 'llm.request':
        // MPU M5: Audit LLM request (fire-and-forget)
        ctx.auditLogger?.append({
          sessionId,
          agentName: state.agentName,
          eventType: 'llm.request',
          action: 'llm.request',
          resource: state.model.model,
          result: 'success',
          details: { messages: state.messages.length, model: state.model },
        });
        return handleLLMRequest(deps, state);

      case 'llm.response':
        // MPU M5: Audit LLM response (fire-and-forget)
        ctx.auditLogger?.append({
          sessionId,
          agentName: state.agentName,
          eventType: 'llm.response',
          action: 'llm.response',
          resource: state.model.model,
          result: 'success',
          details: { finishReason: event.finishReason, usage: event.usage },
        });
        // MPU M7: Record cost (fire-and-forget)
        if (ctx.services.costTracker && event.usage) {
          ctx.services.costTracker
            .record(sessionId, state.model.model, event.usage)
            .catch(() => {});
        }
        return handleLLMResponse(deps, state, event, sctx.repairAttempt);

      case 'llm.output.invalid':
        return handleLLMOutputInvalid(deps, state, event, sctx.repairAttempt ?? 0);

      case 'tool.call':
        return handleToolCall(deps, state, event);

      case 'tool.result':
        // MPU M5: Audit tool result (fire-and-forget)
        ctx.auditLogger?.append({
          sessionId,
          agentName: state.agentName,
          eventType: 'tool.result',
          action: 'tool.result',
          resource: event.toolName,
          result: event.isError ? 'error' : 'success',
          details: { toolCallId: event.toolCallId },
        });
        // MPU M10: Result validation (warn only, never blocks)
        if (ctx.services.resultValidator && !event.isError) {
          try {
            const validation = ctx.services.resultValidator.validate(event.toolName, event.result);
            if (!validation.valid) {
              console.warn(
                `Tool result validation failed for ${event.toolName}:`,
                validation.errors
              );
            }
          } catch {
            // Validation failure must never crash the loop
          }
        }
        // MPU M4: Error classification on tool error (fire-and-forget)
        if (ctx.errorClassifier && ctx.circuitBreaker && event.isError) {
          try {
            const severity = ctx.errorClassifier.classify({
              name: 'ToolExecutionError',
              message: String(event.result),
              stack: undefined,
            });
            ctx.circuitBreaker.recordFailure(severity);
          } catch {
            // Error classifier must never crash the loop
          }
        }
        return handleToolResult(deps, state, event);

      case 'tool.batch.complete':
        return handleBatchComplete(deps, state, event);

      case 'tool.execute':
        // MPU M5: Audit tool execution (fire-and-forget)
        ctx.auditLogger?.append({
          sessionId,
          agentName: state.agentName,
          eventType: 'tool.execute',
          action: 'tool.execute',
          resource: event.toolName,
          result: 'success',
          details: { toolCallId: event.toolCallId },
        });
        // Passive event — no further processing needed
        return EMPTY;

      case 'hitl.ask':
        // HITL ask event - subscribe to ctx.hitl.ask() Observable
        // This is the NEVER-blocking pattern: Observable doesn't emit until answer arrives
        return handleHITLAsk(deps, state, event);

      case 'hitl.answer':
        // HITL answer event - pure observability, no action needed
        // The hitl.ask handler already processes the answer and emits tool.result
        return EMPTY;

      // ===== Layer 2: Subsystem Lifecycle (transparent pass-through) =====
      case 'mcp.connecting':
      case 'mcp.connected':
      case 'mcp.disconnected':
      case 'mcp.tools_changed':
      case 'mcp.error':
      case 'workflow.start':
      case 'workflow.step.start':
      case 'workflow.step.end':
      case 'workflow.suspend':
      case 'workflow.resume':
      case 'workflow.complete':
      case 'workflow.error':
      case 'compaction.start':
      case 'compaction.complete':
      case 'permission.prompt':
      case 'permission.decision':
      case 'subagent.start':
      case 'subagent.step':
      case 'subagent.complete':
      case 'subagent.error':
        // Subagent events - handled in handleSubagentDelegation(), transparent pass-through here
        return of(sctx);

      default:
        // All other events are passive/observational:
        // - llm.stream.* (emitted directly by callLLMStreaming)
        // - tool.error, tool.batch, tool.batch.start, tool.result.delta
        // - checkpoint (emitted by emitCheckpoint)
        // - state.change, context.updated
        // - llm.error, mcp.*, workflow.*, compaction.*, permission.*
        // Returning EMPTY prevents infinite expand recursion — these events are
        // already emitted to the subscriber by their respective handler functions.
        return EMPTY;
    }
  }

  // ============================================================
  // Run Entry Point
  // ============================================================

  function run(input: string): Observable<AgentEvent> {
    if (isRunning) {
      // Errors-as-events: emit agent.error + done instead of throwing via RxJS error channel
      const errorEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: {
          name: 'AgentAlreadyRunningError',
          message: 'Agent is already running',
        },
      };

      const doneEvent: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'error',
      };

      return of(errorEvent, doneEvent);
    }
    isRunning = true;

    const startEvent: AgentEvent = {
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId,
      input,
      agentName: ctx.agentName,
      model: config.model,
    };

    // Build messages array with history
    const messages: Message[] = [];
    if (config.history && config.history.length > 0) {
      messages.push(...config.history);
    }
    messages.push({ role: 'user', content: input });

    const initialState: AgentState = {
      sessionId,
      agentName: ctx.agentName,
      model: config.model,
      messages,
      step: 0,
      maxSteps: config.maxSteps,
      pendingToolCalls: [],
      output: '',
      tokens: { prompt: 0, completion: 0 },
    };

    return of({ event: startEvent, state: initialState } as StepContext).pipe(
      expand(step),
      map(sctx => sctx.event),
      takeUntil(destroy$),
      takeUntil(
        ctx.abortSignal
          ? new Observable<void>(subscriber => {
              if (ctx.abortSignal?.aborted) {
                subscriber.next();
                subscriber.complete();
                return;
              }
              const handler = (): void => {
                subscriber.next();
                subscriber.complete();
              };
              ctx.abortSignal?.addEventListener('abort', handler);
              return () => {
                ctx.abortSignal?.removeEventListener('abort', handler);
              };
            })
          : new Observable<void>(() => {})
      ),
      // 🔴 P0 修复：全局 catchError 作为安全网 - 任何未捕获的错误转换为 agent.error + done
      catchError(error => {
        // Notify error handler
        const err = error instanceof Error ? error : new Error(String(error));
        const globalErrorEvent: AgentEvent = {
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId,
          error: serializeError(err),
        };
        ctx.onError?.(err, globalErrorEvent, 'unknown');
        console.error('Agent loop unexpected error:', error);
        const errorEvent: AgentEvent = {
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId,
          error: serializeError(error),
        };
        const doneEvent: AgentEvent = {
          type: 'done',
          timestamp: Date.now(),
          sessionId,
          reason: 'error',
        };
        return of(errorEvent, doneEvent);
      }),
      finalize(() => {
        isRunning = false;
      })
    );
  }

  return {
    run,
    destroy$: destroy$.asObservable(),
    getCurrentState: () => latestState,
  };
}
