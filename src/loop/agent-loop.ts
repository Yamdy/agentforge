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

import { Observable, of, from, EMPTY, Subject, asyncScheduler } from 'rxjs';
import {
  expand,
  map,
  takeUntil,
  mergeMap,
  catchError,
  finalize,
  take,
  observeOn,
} from 'rxjs/operators';
import {
  type AgentEvent,
  type AgentState,
  type AgentContext,
  type ToolCall,
  type Message,
  type BatchContext,
  type Checkpoint,
  type CheckpointPosition,
  type LLMOptions,
  isTerminalEvent,
  serializeError,
  generateId,
  createCheckpoint,
} from '../core/index.js';
import { concat } from 'rxjs';
import type { QuotaUsage } from '../quota/quota-controller.js';
import type { CompactionContext } from '../memory/index.js';

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

  // ============================================================
  // Core Step Function - Routes all events
  // ============================================================
  // Checkpoint Helper
  // ============================================================

  /**
   * Emit a checkpoint event and save to storage (fire-and-forget).
   *
   * Does NOT block the event flow. The save is async and errors are
   * logged but never crash the loop. Returns an Observable that
   * emits a single StepContext with the checkpoint event.
   */
  function emitCheckpoint(
    position: CheckpointPosition,
    state: AgentState
  ): Observable<StepContext> {
    // Only emit if checkpoint is enabled and storage is configured
    if (!config.checkpoint?.enabled || !ctx.checkpoint) {
      return EMPTY;
    }

    // 🔴 P0 修复：try/catch 包裹 createCheckpoint（Zod parse 可抛出）
    let cp: Checkpoint;
    try {
      cp = createCheckpoint({
        id: `cp-${generateId()}`,
        sessionId,
        position,
        state,
      });
    } catch (err) {
      // Zod validation failed - emit agent.error event instead of crashing
      const errorEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: {
          name: 'CheckpointCreationError',
          message: err instanceof Error ? err.message : 'Failed to create checkpoint',
        },
      };
      // Don't crash the loop - just log and continue
      console.error('Checkpoint creation failed:', err);
      return of({ event: errorEvent, state } as StepContext);
    }

    // Fire-and-forget save — don't block the event flow
    ctx.checkpoint.save(cp).catch(err => {
      console.error('Checkpoint save failed:', err);
    });

    const checkpointEvent: AgentEvent = {
      type: 'checkpoint',
      timestamp: Date.now(),
      sessionId,
      checkpointId: cp.id,
      position,
      state,
    };

    return of({ event: checkpointEvent, state } as StepContext);
  }

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
        return handleAgentStart(state, event);

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
        return handleLLMRequest(state);

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
        return handleLLMResponse(state, event, sctx.repairAttempt);

      case 'llm.output.invalid':
        return handleLLMOutputInvalid(state, event, sctx.repairAttempt ?? 0);

      case 'tool.call':
        return handleToolCall(state, event);

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
        return handleToolResult(state, event);

      case 'tool.batch.complete':
        return handleBatchComplete(state, event);

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
        return handleHITLAsk(state, event);

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
  // Handler: agent.start → Call LLM
  // ============================================================

  function handleAgentStart(
    state: AgentState,
    _event: Extract<AgentEvent, { type: 'agent.start' }>
  ): Observable<StepContext> {
    // Emit agent.step + llm.request — let llm.request handler call the LLM
    const newStep = 1;
    const newState = { ...state, step: newStep };

    const stepEvent: AgentEvent = {
      type: 'agent.step',
      timestamp: Date.now(),
      sessionId,
      step: newStep,
      maxSteps: state.maxSteps,
    };

    const requestEvent: AgentEvent = {
      type: 'llm.request',
      timestamp: Date.now(),
      sessionId,
      messages: newState.messages,
      model: config.model,
      tools: ctx.tools.list(),
    };

    return from([
      { event: stepEvent, state: newState },
      { event: requestEvent, state: newState },
    ] as StepContext[]);
  }

  // ============================================================
  // Handler: llm.request → Call LLM
  // ============================================================

  function handleLLMRequest(state: AgentState): Observable<StepContext> {
    // MPU M7: Cost pre-check before LLM call
    if (ctx.services.costTracker) {
      return from(ctx.services.costTracker.checkLimit(sessionId)).pipe(
        mergeMap(limitCheck => {
          if (!limitCheck.withinLimit) {
            const errorEvent: AgentEvent = {
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId,
              error: {
                name: 'CostLimitExceededError',
                message: `Cost limit exceeded: ${limitCheck.exceeded?.join(', ')}`,
              },
              step: state.step,
            };
            const doneEv: AgentEvent = {
              type: 'done',
              timestamp: Date.now(),
              sessionId,
              reason: 'error',
            };
            return from([
              { event: errorEvent, state },
              { event: doneEv, state },
            ] as StepContext[]);
          }
          return doLLMRequest(state);
        }),
        catchError(() => {
          // Cost check failure must never crash the loop
          console.warn('Cost check failed, allowing request');
          return doLLMRequest(state);
        })
      );
    }
    return doLLMRequest(state);
  }

  function doLLMRequest(state: AgentState): Observable<StepContext> {
    // Compaction auto-trigger: compress messages before LLM call
    if (ctx.compactionManager && shouldCompact(state)) {
      const compactionCtx: CompactionContext = {
        sessionId,
        messages: state.messages,
        maxTokens: state.contextManagement?.totalTokens ?? 8000,
        currentTokenEstimate: estimateTokenCount(state.messages),
      };
      return from(ctx.compactionManager.compact(compactionCtx)).pipe(
        mergeMap(result => {
          const compactedState: AgentState = {
            ...state,
            messages: result.messages as Message[],
            contextManagement: {
              ...state.contextManagement,
              totalTokens: result.tokensAfter,
              compactionCount: (state.contextManagement?.compactionCount ?? 0) + 1,
              lastCompactionAt: Date.now(),
            },
          };
          return config.streaming ? callLLMStreaming(compactedState) : callLLM(compactedState);
        })
      );
    }

    return config.streaming ? callLLMStreaming(state) : callLLM(state);
  }

  // ============================================================
  // Handler: llm.response → Complete or Execute Tools
  // ============================================================

  function handleLLMResponse(
    state: AgentState,
    event: Extract<AgentEvent, { type: 'llm.response' }>,
    _repairAttempt?: number
  ): Observable<StepContext> {
    const { content, toolCalls, finishReason } = event;

    // Record token consumption (fire-and-forget)
    if (ctx.quota && event.usage) {
      ctx.quota.consume(sessionId, {
        promptTokens: event.usage.promptTokens,
        completionTokens: event.usage.completionTokens,
      });
    }

    // Emit checkpoint after LLM response (before tool execution or completion)
    // Only when interval is 'llm_response' or 'step' (both fire at this position)
    const checkpoint$ = emitCheckpoint('after_llm', state);

    // No tool calls - complete
    if (finishReason === 'stop' || !toolCalls?.length) {
      const completeEvent: AgentEvent = {
        type: 'agent.complete',
        timestamp: Date.now(),
        sessionId,
        output: content,
        steps: state.step,
      };

      const doneEvent: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'stop',
      };

      const mainFlow$ = from([
        { event: completeEvent, state },
        { event: doneEvent, state },
      ] as StepContext[]);

      return concat(checkpoint$, mainFlow$);
    }

    // Validate tool existence
    const invalidTools = toolCalls.filter(tc => !ctx.tools.has(tc.name));
    if (invalidTools.length > 0) {
      const invalidEvent: AgentEvent = {
        type: 'llm.output.invalid',
        timestamp: Date.now(),
        sessionId,
        reason: `Unknown tool(s): ${invalidTools.map(t => t.name).join(', ')}`,
        originalResponse: event,
        attempt: (_repairAttempt ?? 0) + 1,
      };

      // Emit invalid event - will be picked up by handleLLMOutputInvalid
      const mainFlow$ = of({
        event: invalidEvent,
        state,
        repairAttempt: (_repairAttempt ?? 0) + 1,
      } as StepContext);

      return concat(checkpoint$, mainFlow$);
    }

    // Single tool or non-parallel mode — emit tool.call, handler will execute
    if (toolCalls.length === 1 || !config.parallelToolCalls) {
      const firstCall = toolCalls[0]!;

      const callEvent: AgentEvent = {
        type: 'tool.call',
        timestamp: Date.now(),
        sessionId,
        toolCallId: firstCall.id,
        toolName: firstCall.name,
        args: firstCall.args,
      };

      const mainFlow$ = of({ event: callEvent, state } as StepContext);

      return concat(checkpoint$, mainFlow$);
    }

    // Parallel tool execution
    const mainFlow$ = executeBatchTools(toolCalls, state);

    return concat(checkpoint$, mainFlow$);
  }

  // ============================================================
  // Handler: tool.call → Execute Single Tool or Delegate to Subagent
  // ============================================================

  function handleToolCall(
    state: AgentState,
    event: Extract<AgentEvent, { type: 'tool.call' }>
  ): Observable<StepContext> {
    const tc: ToolCall = {
      id: event.toolCallId,
      name: event.toolName,
      args: event.args,
    };

    // Check if this is a subagent delegation
    if (ctx.subagents?.has(event.toolName)) {
      return handleSubagentDelegation(tc, state, event);
    }

    return executeSingleTool(tc, state);
  }

  // ============================================================
  // Handler: Subagent Delegation
  // ============================================================

  /**
   * Handle tool.call by delegating to a subagent.
   *
   * Pattern from design doc:
   * 1. Emit subagent.start event
   * 2. Run nested agent via ctx.subagents.run()
   * 3. All nested events bubble up with parentSessionId
   * 4. Emit subagent.complete event
   * 5. Emit tool.result with subagent output
   *
   * The registry.run() method handles the full lifecycle:
   * - subagent.start, nested agent events, subagent.complete
   *
   * After delegation completes, we emit tool.result with the output.
   */
  function handleSubagentDelegation(
    tc: ToolCall,
    state: AgentState,
    _event: Extract<AgentEvent, { type: 'tool.call' }>
  ): Observable<StepContext> {
    // Extract input from tool args
    // The subagent expects a string input
    let input: string;
    if (typeof tc.args.input === 'string') {
      input = tc.args.input;
    } else if (typeof tc.args.input === 'object' && tc.args.input !== null) {
      input = JSON.stringify(tc.args.input);
    } else if (Object.keys(tc.args).length === 0) {
      // No args, use empty string
      input = '';
    } else {
      // Use all args as input
      input = JSON.stringify(tc.args);
    }

    // Build options with session messages
    const options = {
      sessionMessages: state.messages,
    };

    // Run the subagent via registry
    // The registry emits: subagent.start, nested events (with parentSessionId), subagent.complete
    return ctx.subagents!.run(tc.name, input, options).pipe(
      map(nestedEvent => {
        // Check if this is subagent.complete - we need to create tool.result
        if (nestedEvent.type === 'subagent.complete') {
          const completeEvent = nestedEvent;

          // Create tool.result event with subagent output
          const resultEvent: AgentEvent = {
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            result: completeEvent.output,
            isError: false,
          };

          // Add tool message to state
          const newMessages: Message[] = [
            ...state.messages,
            { role: 'tool', content: completeEvent.output, toolCallId: tc.id, name: tc.name },
          ];
          const newState = { ...state, messages: newMessages };

          return { event: resultEvent, state: newState } as StepContext;
        }

        if (nestedEvent.type === 'subagent.error') {
          const errorEvent = nestedEvent;

          // Create tool.result with error
          const resultEvent: AgentEvent = {
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            result: `Subagent error: ${errorEvent.error.message}`,
            isError: true,
          };

          return { event: resultEvent, state } as StepContext;
        }

        // Pass through all other events (subagent.start, nested agent events, etc.)
        // These are for observability - they bubble up to the parent stream
        return { event: nestedEvent, state } as StepContext;
      }),
      catchError(error => {
        // Notify error handler
        const err = error instanceof Error ? error : new Error(String(error));
        const errorAgentEvent: AgentEvent = {
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId,
          error: serializeError(err),
        };
        ctx.onError?.(err, errorAgentEvent, 'tool_execution');
        // Errors-as-events: convert to tool.result with error
        const resultEvent: AgentEvent = {
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: error instanceof Error ? error.message : String(error),
          isError: true,
        };
        return of({ event: resultEvent, state } as StepContext);
      })
    );
  }

  // ============================================================
  // Handler: llm.output.invalid → Retry or Error
  // ============================================================

  /**
   * LLM output invalidation handler with repair loop.
   *
   * When LLM output fails validation (e.g., calls unknown tool),
   * retry the LLM call with a repair prompt up to maxLLMRepairAttempts.
   * If max attempts reached, emit agent.error and terminate.
   */
  function handleLLMOutputInvalid(
    state: AgentState,
    event: Extract<AgentEvent, { type: 'llm.output.invalid' }>,
    repairAttempt: number
  ): Observable<StepContext> {
    // Check if we've exhausted repair attempts
    if (repairAttempt >= config.maxLLMRepairAttempts) {
      const errorEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: {
          name: 'LLMOutputInvalid',
          message: `LLM output invalid after ${repairAttempt} repair attempt(s): ${event.reason}`,
        },
        step: state.step,
      };

      const doneEvent: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'error',
      };

      return from([
        { event: errorEvent, state },
        { event: doneEvent, state },
      ] as StepContext[]);
    }

    // Retry LLM with repair prompt appended
    const repairMessage: Message = {
      role: 'user',
      content: `Your previous response was invalid: ${event.reason}. Please correct and try again. Only use tools that are available: ${ctx.tools.list().join(', ')}`,
    };

    const repairedMessages = [...state.messages, repairMessage];
    const newState = { ...state, messages: repairedMessages };

    if (config.streaming) {
      return callLLMStreaming(newState, repairAttempt);
    }
    return callLLM(newState, repairAttempt);
  }

  // ============================================================
  // Handler: hitl.ask → Wait for human answer (NEVER-blocking pattern)
  // ============================================================

  /**
   * HITL ask handler.
   *
   * Subscribes to ctx.hitl.ask() Observable. The Observable represents
   * "pause until human answers" semantics:
   * - Observable doesn't emit → expand naturally pauses (equivalent to NEVER)
   * - External answer() call → Subject emits → expand resumes
   * - On answer: emits hitl.answer + tool.result events
   */
  function handleHITLAsk(
    state: AgentState,
    event: Extract<AgentEvent, { type: 'hitl.ask' }>
  ): Observable<StepContext> {
    if (!ctx.hitl) {
      // No HITL controller - shouldn't happen (executeSingleTool guards this)
      // but handle gracefully with errors-as-events
      const errorEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: {
          name: 'HITLNotAvailableError',
          message: 'HITL controller not available for hitl.ask event',
        },
      };
      const doneEvent: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'error',
      };
      return from([
        { event: errorEvent, state },
        { event: doneEvent, state },
      ] as StepContext[]);
    }

    // Subscribe to HITL Observable - this is the core NEVER-blocking pattern
    // Build options conditionally to satisfy exactOptionalPropertyTypes
    const askOptions: {
      question: string;
      askId: string;
      toolCallId: string;
      toolName: string;
      options?: string[];
      metadata?: Record<string, unknown>;
    } = {
      question: event.question,
      askId: event.askId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    };
    if (event.options !== undefined) {
      askOptions.options = event.options;
    }
    if (event.metadata !== undefined) {
      askOptions.metadata = event.metadata;
    }

    return ctx.hitl.ask(askOptions).pipe(
      // Defer emission to next microtask to avoid synchronous deadlock.
      // When hitl.ask is processed in expand, the Observable is subscribed synchronously.
      // If the answer() call happens in the same sync stack (e.g., subscriber.next callback),
      // the answerSubject hasn't been subscribed yet. observeOn(asyncScheduler) ensures
      // the answer is delivered on a fresh microtask, after the subscription is established.
      observeOn(asyncScheduler),
      mergeMap(answer => {
        // Emit hitl.answer (for downstream observability) + tool.result
        const answerEvent: AgentEvent = {
          type: 'hitl.answer',
          timestamp: Date.now(),
          sessionId,
          askId: event.askId,
          answer,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        };

        const resultEvent: AgentEvent = {
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: answer,
          isError: false,
        };

        const newMessages: Message[] = [
          ...state.messages,
          { role: 'tool', content: answer, toolCallId: event.toolCallId, name: event.toolName },
        ];
        const newState = { ...state, messages: newMessages };

        return from([
          { event: answerEvent, state: newState },
          { event: resultEvent, state: newState },
        ] as StepContext[]);
      }),
      catchError(error => {
        // Notify error handler
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.onError?.(err, event, 'unknown');
        // HITL error → errors-as-events
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
        return from([
          { event: errorEvent, state },
          { event: doneEvent, state },
        ] as StepContext[]);
      })
    );
  }

  // ============================================================
  // Handler: tool.result → Continue or Complete
  // ============================================================

  function handleToolResult(
    state: AgentState,
    _event: Extract<AgentEvent, { type: 'tool.result' }>
  ): Observable<StepContext> {
    // Ignore if in batch context - handled by batch.complete
    if (state.batchContext) {
      return EMPTY;
    }

    // Check max steps
    const newStep = state.step + 1;
    if (newStep > state.maxSteps) {
      const completeEvent: AgentEvent = {
        type: 'agent.complete',
        timestamp: Date.now(),
        sessionId,
        output: 'Max steps reached',
        steps: state.step,
      };

      const doneEvent: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'length',
      };

      const newState = { ...state, step: newStep };
      return from([
        { event: completeEvent, state: newState },
        { event: doneEvent, state: newState },
      ] as StepContext[]);
    }

    // Continue to next LLM call — emit agent.step + llm.request
    const newState = { ...state, step: newStep };
    const stepEvent: AgentEvent = {
      type: 'agent.step',
      timestamp: Date.now(),
      sessionId,
      step: newStep,
      maxSteps: state.maxSteps,
    };

    const requestEvent: AgentEvent = {
      type: 'llm.request',
      timestamp: Date.now(),
      sessionId,
      messages: newState.messages,
      model: config.model,
      tools: ctx.tools.list(),
    };

    return from([
      { event: stepEvent, state: newState },
      { event: requestEvent, state: newState },
    ] as StepContext[]);
  }

  // ============================================================
  // Handler: tool.batch.complete → Continue
  // ============================================================

  function handleBatchComplete(
    state: AgentState,
    _event: Extract<AgentEvent, { type: 'tool.batch.complete' }>
  ): Observable<StepContext> {
    const newStep = state.step + 1;

    // Check max steps
    if (newStep > state.maxSteps) {
      const completeEvent: AgentEvent = {
        type: 'agent.complete',
        timestamp: Date.now(),
        sessionId,
        output: 'Max steps reached',
        steps: state.step,
      };

      const doneEvent: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'length',
      };

      const newState = { ...state, step: newStep, batchContext: undefined, pendingToolCalls: [] };
      return from([
        { event: completeEvent, state: newState },
        { event: doneEvent, state: newState },
      ] as StepContext[]);
    }

    const newState = {
      ...state,
      step: newStep,
      batchContext: undefined,
      pendingToolCalls: [],
    };

    const stepEvent: AgentEvent = {
      type: 'agent.step',
      timestamp: Date.now(),
      sessionId,
      step: newStep,
      maxSteps: state.maxSteps,
    };

    const requestEvent: AgentEvent = {
      type: 'llm.request',
      timestamp: Date.now(),
      sessionId,
      messages: newState.messages,
      model: config.model,
      tools: ctx.tools.list(),
    };

    return from([
      { event: stepEvent, state: newState },
      { event: requestEvent, state: newState },
    ] as StepContext[]);
  }

  // ============================================================
  // LLM Call
  // ============================================================

  function callLLM(state: AgentState, repairAttempt: number = 0): Observable<StepContext> {
    // Quota pre-check
    if (ctx.quota) {
      const projected: QuotaUsage = {
        promptTokens: estimateTokenCount(state.messages),
        completionTokens: 0,
      };
      return from(ctx.quota.check(sessionId, projected)).pipe(
        mergeMap(allowed => {
          if (!allowed) {
            const errorEvent: AgentEvent = {
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId,
              error: {
                name: 'QuotaExceededError',
                message: 'Token quota exceeded. Increase limits or check usage.',
              },
              step: state.step,
            };
            const doneEv: AgentEvent = {
              type: 'done',
              timestamp: Date.now(),
              sessionId,
              reason: 'error',
            };
            return from([
              { event: errorEvent, state },
              { event: doneEv, state },
            ] as StepContext[]);
          }
          return callLLMInner(state, repairAttempt);
        }),
        catchError(() => {
          console.warn('Quota check failed, allowing request');
          return callLLMInner(state, repairAttempt);
        })
      );
    }
    return callLLMInner(state, repairAttempt);
  }

  function callLLMInner(state: AgentState, repairAttempt: number = 0): Observable<StepContext> {
    const llmOptions: LLMOptions = {
      tools: ctx.tools.getFunctionDefs(),
    };

    return from(ctx.llm.chat(state.messages, llmOptions)).pipe(
      mergeMap(response => {
        const responseEvent: AgentEvent = {
          type: 'llm.response',
          timestamp: Date.now(),
          sessionId,
          content: response.content,
          toolCalls: response.toolCalls,
          finishReason: response.finishReason,
          usage: response.usage,
        };
        return of({ event: responseEvent, state, repairAttempt } as StepContext);
      }),
      catchError(error => {
        // Notify error handler
        const err = error instanceof Error ? error : new Error(String(error));
        const llmErrorEvent: AgentEvent = {
          type: 'llm.request',
          timestamp: Date.now(),
          sessionId,
          messages: state.messages,
          model: config.model,
          tools: ctx.tools.list(),
        };
        ctx.onError?.(err, llmErrorEvent, 'llm_server_error');
        const errorEvent: AgentEvent = {
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId,
          error: serializeError(error),
          step: state.step,
        };
        const doneEv: AgentEvent = {
          type: 'done',
          timestamp: Date.now(),
          sessionId,
          reason: 'error',
        };
        return from([
          { event: errorEvent, state },
          { event: doneEv, state },
        ] as StepContext[]);
      })
    );
  }

  // ============================================================
  // Streaming LLM Call
  // ============================================================

  /**
   * Streaming LLM call - emits llm.stream.* events then llm.response
   *
   * Event sequence:
   * - llm.stream.start
   * - llm.stream.text (multiple)
   * - llm.stream.tool_call (multiple, for tool calls)
   * - llm.stream.end
   * - llm.response (with accumulated content)
   *
   * Implementation uses a manual Observable to properly sequence events:
   * - mergeMap(() => ...) discards source values, so we can't use it for start event
   * - finalize() doesn't emit values, so we parse tool calls in complete handler
   */
  function callLLMStreaming(state: AgentState, repairAttempt: number = 0): Observable<StepContext> {
    // Quota pre-check
    if (ctx.quota) {
      const projected: QuotaUsage = {
        promptTokens: estimateTokenCount(state.messages),
        completionTokens: 0,
      };
      return from(ctx.quota.check(sessionId, projected)).pipe(
        mergeMap(allowed => {
          if (!allowed) {
            const errorEvent: AgentEvent = {
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId,
              error: {
                name: 'QuotaExceededError',
                message: 'Token quota exceeded. Increase limits or check usage.',
              },
              step: state.step,
            };
            const doneEv: AgentEvent = {
              type: 'done',
              timestamp: Date.now(),
              sessionId,
              reason: 'error',
            };
            return from([
              { event: errorEvent, state },
              { event: doneEv, state },
            ] as StepContext[]);
          }
          return callLLMStreamingInner(state, repairAttempt);
        }),
        catchError(() => {
          console.warn('Quota check failed, allowing request');
          return callLLMStreamingInner(state, repairAttempt);
        })
      );
    }
    return callLLMStreamingInner(state, repairAttempt);
  }

  function callLLMStreamingInner(
    state: AgentState,
    repairAttempt: number = 0
  ): Observable<StepContext> {
    return new Observable<StepContext>(subscriber => {
      // Emit stream start first
      const streamStartEvent: AgentEvent = {
        type: 'llm.stream.start',
        timestamp: Date.now(),
        sessionId,
      };
      subscriber.next({ event: streamStartEvent, state });

      // Accumulators for content and tool calls
      let accumulatedContent = '';
      const accumulatedToolCalls: ToolCall[] = [];
      const toolCallBuffers: Map<string, { name: string; argsDelta: string }> = new Map();

      // Subscribe to the LLM stream
      // Build LLM options with tools
      const llmOptions: LLMOptions = {
        tools: ctx.tools.getFunctionDefs(),
      };

      const subscription = ctx.llm.stream(state.messages, llmOptions).subscribe({
        next(chunk) {
          // Handle text chunks
          if (chunk.text) {
            accumulatedContent += chunk.text;
            subscriber.next({
              event: {
                type: 'llm.stream.text',
                timestamp: Date.now(),
                sessionId,
                delta: chunk.text,
              },
              state,
            });
          }

          // Handle tool call chunks
          if (chunk.toolCallId && chunk.toolName) {
            // New or continued tool call
            if (!toolCallBuffers.has(chunk.toolCallId)) {
              toolCallBuffers.set(chunk.toolCallId, {
                name: chunk.toolName,
                argsDelta: chunk.argsDelta ?? '',
              });
            } else {
              const existing = toolCallBuffers.get(chunk.toolCallId)!;
              existing.argsDelta += chunk.argsDelta ?? '';
            }

            subscriber.next({
              event: {
                type: 'llm.stream.tool_call',
                timestamp: Date.now(),
                sessionId,
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                argsDelta: chunk.argsDelta ?? '',
              },
              state,
            });
          }
        },
        error(error) {
          // Notify error handler
          const err = error instanceof Error ? error : new Error(String(error));
          const streamErrorEvent: AgentEvent = {
            type: 'llm.request',
            timestamp: Date.now(),
            sessionId,
            messages: state.messages,
            model: config.model,
            tools: ctx.tools.list(),
          };
          ctx.onError?.(err, streamErrorEvent, 'llm_server_error');
          // Errors-as-events: convert to agent.error + done
          const errorEvent: AgentEvent = {
            type: 'agent.error',
            timestamp: Date.now(),
            sessionId,
            error: serializeError(error),
            step: state.step,
          };
          const doneEvent: AgentEvent = {
            type: 'done',
            timestamp: Date.now(),
            sessionId,
            reason: 'error',
          };
          subscriber.next({ event: errorEvent, state });
          subscriber.next({ event: doneEvent, state });
          subscriber.complete();
        },
        complete() {
          // Parse accumulated tool calls from buffers
          for (const [id, buffer] of toolCallBuffers) {
            try {
              const args: unknown = JSON.parse(buffer.argsDelta);
              if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
                accumulatedToolCalls.push({
                  id,
                  name: buffer.name,
                  args: args as Record<string, unknown>,
                });
              }
            } catch {
              // Invalid JSON - skip this tool call
            }
          }

          // Emit stream end
          const streamEndEvent: AgentEvent = {
            type: 'llm.stream.end',
            timestamp: Date.now(),
            sessionId,
          };
          subscriber.next({ event: streamEndEvent, state });

          // Emit final response
          const finishReason = accumulatedToolCalls.length > 0 ? 'tool_calls' : 'stop';
          const responseEvent: AgentEvent = {
            type: 'llm.response',
            timestamp: Date.now(),
            sessionId,
            content: accumulatedContent,
            toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
            finishReason,
          };
          subscriber.next({ event: responseEvent, state, repairAttempt });
          subscriber.complete();
        },
      });

      // Return cleanup function
      return () => {
        subscription.unsubscribe();
      };
    });
  }

  // ============================================================
  // Single Tool Execution
  // ============================================================

  function executeSingleTool(tc: ToolCall, state: AgentState): Observable<StepContext> {
    // MPU M6: Security check before tool execution
    if (ctx.securityGuard) {
      try {
        const argsStr = JSON.stringify(tc.args ?? {});
        const cmdCheck = ctx.securityGuard.checkCommand(argsStr);
        if (!cmdCheck.allowed) {
          // Security violation — return error result, do not execute tool
          const resultEvent: AgentEvent = {
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            result: `Security violation: ${cmdCheck.reason}`,
            isError: true,
          };
          return of({ event: resultEvent, state } as StepContext);
        }
      } catch {
        // Security check failure must never crash the loop — allow execution
      }
    }

    const executeEvent: AgentEvent = {
      type: 'tool.execute',
      timestamp: Date.now(),
      sessionId,
      toolCallId: tc.id,
      toolName: tc.name,
    };

    // Emit execute event, then execute tool and emit result or hitl.ask
    return from(
      ctx.tools
        .execute(tc.name, tc.args)
        .then(result => {
          // Check if HITL is required (result starts with HITL_REQUIRED:)
          if (result.startsWith('HITL_REQUIRED:') && ctx.hitl) {
            const question = result.slice('HITL_REQUIRED:'.length).trim();
            const askId = `ask-${generateId()}`;

            // Emit hitl.ask event - step() will handle via hitl.ask case
            // The hitl.ask handler subscribes to ctx.hitl.ask() Observable
            // and emits hitl.answer + tool.result when answer arrives
            const askEvent: AgentEvent = {
              type: 'hitl.ask',
              timestamp: Date.now(),
              sessionId,
              askId,
              question,
              toolCallId: tc.id,
              toolName: tc.name,
            };

            // Only emit execute + hitl.ask, handler will emit result
            return [
              { event: executeEvent, state },
              { event: askEvent, state },
            ] as StepContext[];
          }

          // Normal tool result (no HITL required)
          const resultEvent: AgentEvent = {
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            result,
            isError: false,
          };
          const newMessages: Message[] = [
            ...state.messages,
            { role: 'tool', content: result, toolCallId: tc.id, name: tc.name },
          ];
          const newState = { ...state, messages: newMessages };
          return [
            { event: executeEvent, state },
            { event: resultEvent, state: newState },
          ] as StepContext[];
        })
        .catch(error => {
          // Notify error handler
          const err = error instanceof Error ? error : new Error(String(error));
          const toolErrorEvent: AgentEvent = {
            type: 'tool.call',
            timestamp: Date.now(),
            sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.args,
          };
          ctx.onError?.(err, toolErrorEvent, 'tool_execution');
          const resultEvent: AgentEvent = {
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            result: error instanceof Error ? error.message : String(error),
            isError: true,
          };
          return [
            { event: executeEvent, state },
            { event: resultEvent, state },
          ] as StepContext[];
        })
    ).pipe(mergeMap(arr => from(arr)));
  }

  // ============================================================
  // Batch Tool Execution (Parallel)
  // ============================================================

  function executeBatchTools(toolCalls: ToolCall[], state: AgentState): Observable<StepContext> {
    const batchId = `batch-${generateId()}`;
    const startedAt = Date.now();

    // Create batch context
    const batchContext: BatchContext = {
      batchId,
      totalCalls: toolCalls.length,
      completedCalls: 0,
      startedAt,
    };

    const batchState = {
      ...state,
      pendingToolCalls: toolCalls,
      batchContext,
    };

    // Execute all tools in parallel and collect all events
    return from(
      Promise.all(
        toolCalls.map(async tc => {
          try {
            const result = await ctx.tools.execute(tc.name, tc.args);
            return { tc, result, isError: false };
          } catch (error) {
            return {
              tc,
              result: error instanceof Error ? error.message : String(error),
              isError: true,
            };
          }
        })
      ).then(results => {
        const events: StepContext[] = [];
        const newMessages: Message[] = [...state.messages];
        let successCount = 0;
        let errorCount = 0;

        // Emit batch.start
        events.push({
          event: {
            type: 'tool.batch.start',
            timestamp: Date.now(),
            sessionId,
            batchId,
            totalCalls: toolCalls.length,
          },
          state: batchState,
        });

        // Emit batch event
        events.push({
          event: {
            type: 'tool.batch',
            timestamp: Date.now(),
            sessionId,
            batchId,
            calls: toolCalls.map(tc => ({
              toolCallId: tc.id,
              toolName: tc.name,
              args: tc.args,
            })),
          },
          state: batchState,
        });

        // Emit execute + result for each tool
        for (const r of results) {
          events.push({
            event: {
              type: 'tool.execute',
              timestamp: Date.now(),
              sessionId,
              toolCallId: r.tc.id,
              toolName: r.tc.name,
            },
            state: batchState,
          });

          events.push({
            event: {
              type: 'tool.result',
              timestamp: Date.now(),
              sessionId,
              toolCallId: r.tc.id,
              toolName: r.tc.name,
              result: r.result,
              isError: r.isError,
            },
            state: batchState,
          });

          newMessages.push({
            role: 'tool',
            content: r.result,
            toolCallId: r.tc.id,
            name: r.tc.name,
          });

          if (r.isError) {
            errorCount++;
          } else {
            successCount++;
          }
        }

        // Emit batch.complete
        const completeState = {
          ...state,
          messages: newMessages,
          pendingToolCalls: [],
          batchContext: undefined,
        };

        events.push({
          event: {
            type: 'tool.batch.complete',
            timestamp: Date.now(),
            sessionId,
            batchId,
            totalCalls: toolCalls.length,
            successCount,
            errorCount,
            durationMs: Date.now() - startedAt,
          },
          state: completeState,
        });

        return events;
      })
    ).pipe(mergeMap(arr => from(arr)));
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
              }
              ctx.abortSignal?.addEventListener('abort', () => {
                subscriber.next();
                subscriber.complete();
              });
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

  // ============================================================
  // Helper: Estimate token count from messages
  // ============================================================

  /**
   * 粗略估算消息 token 数。
   * 规则：英文约 4 字符 = 1 token，中文约 1.5 字符 = 1 token。
   * 取 3 字符 = 1 token 作为通用估算。
   * 生产环境可用 tiktoken 精确计算，此处仅做前置估算。
   */
  function estimateTokenCount(messages: Message[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      }
      // ToolMessage 的 content 可能是 string | ToolResultContent[]
      // 简化：只计算 string 部分
    }
    return Math.ceil(totalChars / 3);
  }

  // ============================================================
  // Helper: Check if compaction should trigger
  // ============================================================

  /**
   * 判断是否需要压缩上下文。
   * 触发条件：消息数量 > 50 或估算 token > maxSteps * 4000。
   */
  function shouldCompact(state: AgentState): boolean {
    const messageCount = state.messages.length;
    const estimatedTokens = estimateTokenCount(state.messages);
    const threshold = (state.maxSteps ?? 10) * 4000;
    return messageCount > 50 || estimatedTokens > threshold;
  }
}
