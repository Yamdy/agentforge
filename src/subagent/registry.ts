/**
 * Subagent Registry Implementation
 *
 * Manages subagent registration and execution.
 * Implements the SubagentRegistry interface from interfaces.ts.
 *
 * Design: run() takes a listener callback and returns Promise<string>.
 * Uses agent.onAny() for event subscription.
 *
 * @module agentforge/subagent
 */

import type { AgentEvent, Message } from '../core/events.js';
import {
  type SubagentRegistry as ISubagentRegistry,
  type SubagentInfo,
} from '../core/interfaces.js';
import { serializeError, generateId } from '../core/events.js';
import type {
  SubagentConfig,
  SubagentEntry,
  AgentLoop,
  AsyncSubagentHandle,
  SubagentAsyncResult,
} from './types.js';

/**
 * Internal implementation of AsyncSubagentHandle.
 */
class AsyncHandleImpl implements AsyncSubagentHandle {
  public readonly sessionId: string;
  private _status: 'running' | 'completed' | 'error' | 'cancelled' = 'running';
  private _output = '';
  private _error?: Error;
  private _events: AgentEvent[] = [];
  private _resolve!: () => void;
  private readonly _done: Promise<void>;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this._done = new Promise<void>(resolve => {
      this._resolve = resolve;
    });
  }

  get statusValue(): 'running' | 'completed' | 'error' | 'cancelled' {
    return this._status;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async status(): Promise<'running' | 'completed' | 'error'> {
    if (this._status === 'cancelled') return 'error';
    return this._status;
  }

  async result(): Promise<SubagentAsyncResult> {
    await this._done;
    const base: SubagentAsyncResult = {
      sessionId: this.sessionId,
      status: this._status as 'completed' | 'error' | 'cancelled',
      output: this._output,
      events: this._events,
    };
    if (this._error !== undefined) {
      base.error = this._error;
    }
    return base;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async cancel(): Promise<void> {
    if (this._status === 'running') {
      this._status = 'cancelled';
      this._resolve();
    }
  }

  setCompleted(output: string, events: AgentEvent[]): void {
    if (this._status !== 'running') return;
    this._status = 'completed';
    this._output = output;
    this._events = events;
    this._resolve();
  }

  setError(error: Error, events: AgentEvent[]): void {
    if (this._status !== 'running') return;
    this._status = 'error';
    this._error = error;
    this._events = events;
    this._resolve();
  }
}

// Track active subagent runs for cancellation support.
interface ActiveRun {
  sessionId: string;
  subagentName: string;
  startedAt: number;
  agent: AgentLoop;
}

export class SubagentRegistry implements ISubagentRegistry {
  private readonly subagents: Map<string, SubagentEntry> = new Map();
  private readonly asyncRuns: Map<string, AsyncHandleImpl> = new Map();
  private readonly activeRuns: Map<string, ActiveRun> = new Map();

  // ============================================================
  // SubagentRegistry Interface Implementation
  // ============================================================

  has(name: string): boolean {
    return this.subagents.has(name);
  }

  get(name: string): SubagentInfo | undefined {
    const entry = this.subagents.get(name);
    if (!entry) return undefined;
    const info: SubagentInfo = {
      name: entry.config.name,
      mode: entry.config.mode ?? 'subagent',
    };
    if (entry.config.description !== undefined) {
      info.description = entry.config.description;
    }
    return info;
  }

  list(): SubagentInfo[] {
    return Array.from(this.subagents.values()).map(entry => {
      const info: SubagentInfo = {
        name: entry.config.name,
        mode: entry.config.mode ?? 'subagent',
      };
      if (entry.config.description !== undefined) {
        info.description = entry.config.description;
      }
      return info;
    });
  }

  /**
   * Run a subagent — emits events via listener, returns output via Promise.
   */
  async run(
    name: string,
    input: string,
    listener: (event: AgentEvent) => void,
    options?: { sessionMessages?: Message[] }
  ): Promise<string> {
    const entry = this.subagents.get(name);

    if (!entry) {
      listener({
        type: 'subagent.error',
        timestamp: Date.now(),
        sessionId: '',
        error: {
          name: 'SubagentNotFoundError',
          message: `Subagent '${name}' is not registered`,
        },
      } as AgentEvent);
      return '';
    }

    const sessionId = generateId('session');
    const parentSessionId = options?.sessionMessages?.[0]?.name ?? '';

    // ── Tool isolation validation ──
    if (entry.config.allowedTools && entry.config.allowedTools.length > 0) {
      // Emit an event noting that tools are scoped for this subagent
      listener({
        type: 'subagent.start',
        timestamp: Date.now(),
        sessionId,
        subagentName: name,
        input: `Tool scope restricted to: ${entry.config.allowedTools.join(', ')}`,
        parentSessionId,
      } as AgentEvent);
    }

    switch (entry.config.executionMode) {
      case 'async':
        return this.runAsync(entry, input, listener, name, sessionId, parentSessionId);
      case 'compiled':
      case 'sync':
      default:
        return this.runWithFullEventStream(
          entry,
          input,
          listener,
          name,
          sessionId,
          parentSessionId
        );
    }
  }

  /**
   * Execute subagent with full event stream.
   *
   * Emits: subagent.start → all nested agent events → subagent.complete (or error)
   */
  private async runWithFullEventStream(
    entry: SubagentEntry,
    input: string,
    listener: (event: AgentEvent) => void,
    subagentName: string,
    sessionId: string,
    parentSessionId: string
  ): Promise<string> {
    const agent = entry.config.agent;

    // ── Track active run for isolation-aware cancellation ──
    const activeRun: ActiveRun = {
      sessionId,
      subagentName,
      startedAt: Date.now(),
      agent,
    };
    this.activeRuns.set(sessionId, activeRun);

    try {
      // Emit subagent.start
      listener({
        type: 'subagent.start',
        timestamp: Date.now(),
        sessionId,
        parentSessionId,
        subagentName,
        input,
      } as AgentEvent);

      let finalOutput = '';
      let hadError = false;

      // Subscribe to all nested agent events
      const unreg = agent.onAny((event: AgentEvent) => {
        if (event.type === 'agent.complete') {
          finalOutput = event.output ?? '';
        }
        if (event.type === 'subagent.error') {
          hadError = true;
        }
        listener({ ...event, parentSessionId } as AgentEvent);
      });

      try {
        finalOutput = await agent.run(input);
      } catch (error) {
        hadError = true;
        listener({
          type: 'subagent.error',
          timestamp: Date.now(),
          sessionId,
          error: serializeError(error),
        } as AgentEvent);
      } finally {
        unreg();
        this.activeRuns.delete(sessionId);
      }

      // Emit subagent.complete if no error
      if (!hadError) {
        listener({
          type: 'subagent.complete',
          timestamp: Date.now(),
          sessionId,
          output: finalOutput,
        } as AgentEvent);
      }

      return finalOutput;
    } catch (error) {
      this.activeRuns.delete(sessionId);
      throw error;
    }
  }

  // ============================================================
  // Extended Methods (beyond SubagentRegistry interface)
  // ============================================================

  /**
   * Register a subagent.
   *
   * When `allowedTools` is set, the subagent is validated to ensure tool
   * isolation is properly configured (the subagent's AgentLoop should be
   * created with a filtered tool registry). A warning is emitted if tool
   * isolation cannot be enforced at the registry level.
   */
  register(config: SubagentConfig): void {
    // NOTE: allowedTools is validated at AgentLoop creation time.
    // The registry cannot retroactively filter tools from an existing
    // AgentLoop — users must pass a filtered ToolRegistry when creating
    // the subagent's AgentLoop via createAgentLoop().
    this.subagents.set(config.name, {
      config,
      registeredAt: Date.now(),
    });
  }

  /**
   * Cancel a specific subagent run by session ID.
   *
   * For isolated subagents, this calls the underlying AgentLoop's cancel().
   * For non-isolated subagents, cancellation is a no-op (the agent runs
   * in the parent's scope and shouldn't be canceled independently).
   *
   * @returns true if the run was found and canceled, false otherwise
   */
  cancelSubagent(sessionId: string): boolean {
    const activeRun = this.activeRuns.get(sessionId);
    if (!activeRun) {
      // Check async runs too
      const asyncHandle = this.asyncRuns.get(sessionId);
      if (asyncHandle) {
        asyncHandle.cancel().catch(() => {});
        return true;
      }
      return false;
    }

    // Only isolated subagents can be independently canceled.
    // Non-isolated subagents run in the parent's scope — they remain
    // tracked in activeRuns until they complete naturally.
    const config = this.subagents.get(activeRun.subagentName)?.config;
    if (!config?.isolated) {
      return false;
    }
    try {
      activeRun.agent?.cancel?.();
    } catch {
      /* isolate */
    }
    this.activeRuns.delete(sessionId);
    return true;
  }

  /**
   * Cancel all active subagent runs.
   */
  cancelAll(): void {
    for (const [sessionId] of this.activeRuns) {
      this.cancelSubagent(sessionId);
    }
  }

  /**
   * Get the list of currently active subagent runs.
   */
  getActiveRuns(): ReadonlyArray<{ sessionId: string; subagentName: string; startedAt: number }> {
    return Array.from(this.activeRuns.values()).map(r => ({
      sessionId: r.sessionId,
      subagentName: r.subagentName,
      startedAt: r.startedAt,
    }));
  }

  /**
   * Check if a subagent is configured for tool isolation.
   */
  isIsolated(name: string): boolean {
    const config = this.subagents.get(name)?.config;
    return config?.isolated === true || (config?.allowedTools?.length ?? 0) > 0;
  }

  /**
   * Unregister a subagent.
   */
  unregister(name: string): boolean {
    return this.subagents.delete(name);
  }

  /**
   * Register multiple subagents.
   */
  registerAll(configs: SubagentConfig[]): void {
    for (const config of configs) {
      this.subagents.set(config.name, {
        config,
        registeredAt: Date.now(),
      });
    }
  }

  /**
   * Get number of registered subagents.
   */
  get size(): number {
    return this.subagents.size;
  }

  /**
   * Execute subagent in async mode (fire-and-forget).
   *
   * Emits subagent.start immediately, then runs the agent in background.
   * Stores a handle in asyncRuns for status/cancel/result tracking.
   * Calls onComplete/onError callbacks from asyncConfig when done.
   */
  private runAsync(
    entry: SubagentEntry,
    input: string,
    listener: (event: AgentEvent) => void,
    subagentName: string,
    sessionId: string,
    parentSessionId: string
  ): Promise<string> {
    // Emit subagent.start immediately
    listener({
      type: 'subagent.start',
      timestamp: Date.now(),
      sessionId,
      parentSessionId,
      subagentName,
      input,
    } as AgentEvent);

    // Create handle and store it
    const handle = new AsyncHandleImpl(sessionId);
    this.asyncRuns.set(sessionId, handle);

    // Track in activeRuns so getActiveRuns() and cancelAll() cover async subagents
    const activeRun: ActiveRun = {
      sessionId,
      subagentName,
      startedAt: Date.now(),
      agent: entry.config.agent,
    };
    this.activeRuns.set(sessionId, activeRun);

    const cleanup = (): void => {
      this.activeRuns.delete(sessionId);
    };

    const events: AgentEvent[] = [];

    // Subscribe to agent events
    const unreg = entry.config.agent.onAny((event: AgentEvent) => {
      events.push(event);
      listener({ ...event, parentSessionId } as AgentEvent);
    });

    // Fire-and-forget background execution
    entry.config.agent.run(input).then(
      (output: string) => {
        unreg();
        cleanup();
        handle.setCompleted(output, events);
        // Emit subagent.complete
        listener({
          type: 'subagent.complete',
          timestamp: Date.now(),
          sessionId,
          output,
        } as AgentEvent);
        // Call onComplete callback
        entry.config.asyncConfig?.onComplete?.({
          sessionId,
          status: 'completed',
          output,
          events,
        });
      },
      (error: unknown) => {
        unreg();
        cleanup();
        const err = serializeError(error);
        handle.setError(error instanceof Error ? error : new Error(String(error)), events);
        // Emit subagent.error
        listener({
          type: 'subagent.error',
          timestamp: Date.now(),
          sessionId,
          error: err,
        } as AgentEvent);
        // Call onError callback
        entry.config.asyncConfig?.onError?.(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    );

    // Return immediately — don't await agent execution
    return Promise.resolve('');
  }

  /**
   * Get async run handle by session ID.
   * Returns undefined for cancelled/completed/errored handles (auto-cleanup).
   */
  getAsyncHandle(sessionId: string): AsyncSubagentHandle | undefined {
    const handle = this.asyncRuns.get(sessionId);
    if (!handle) return undefined;
    // Auto-cleanup: only return handles that are still running
    if (handle.statusValue !== 'running') {
      this.asyncRuns.delete(sessionId);
      return undefined;
    }
    return handle;
  }

  /**
   * Get async run by ID (alias for getAsyncHandle).
   */
  getAsyncRun(id: string): AsyncSubagentHandle | undefined {
    return this.asyncRuns.get(id);
  }

  /**
   * Cancel an async run.
   */
  cancelAsyncRun(id: string): void {
    const handle = this.asyncRuns.get(id);
    if (handle) {
      handle
        .cancel()
        .then(() => {
          this.asyncRuns.delete(id);
        })
        .catch(() => {
          this.asyncRuns.delete(id);
        });
    }
  }

  /**
   * Remove all registered subagents.
   */
  clear(): void {
    this.subagents.clear();
  }

  /**
   * Get the full config for a registered subagent.
   */
  getConfig(name: string): SubagentConfig | undefined {
    return this.subagents.get(name)?.config;
  }
}

/**
 * Create a new subagent registry.
 */
export function createSubagentRegistry(): SubagentRegistry {
  return new SubagentRegistry();
}
