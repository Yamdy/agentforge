/**
 * Subagent Registry Implementation
 *
 * Manages subagent registration and execution.
 * Implements the SubagentRegistry interface from interfaces.ts with additional
 * register/unregister methods for dynamic management.
 *
 * Design pattern from docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md:
 * - run() emits subagent.start, then nested agent events with parentSessionId, then subagent.complete
 * - All errors converted to subagent.error events (errors-as-events pattern)
 *
 * @module agentforge/subagent
 */

import { Observable, of, concat, EMPTY } from 'rxjs';
import { map, catchError, takeUntil } from 'rxjs/operators';
import type { AgentEvent, Message } from '../core/events.js';
import {
  type SubagentRegistry as ISubagentRegistry,
  type SubagentInfo,
} from '../core/interfaces.js';
import { serializeError, generateId } from '../core/events.js';
import type { SubagentConfig, SubagentEntry, AgentLoop } from './types.js';

/**
 * Subagent Registry
 *
 * Manages subagent lifecycle and execution.
 *
 * @example
 * ```typescript
 * const registry = new SubagentRegistry();
 *
 * // Register a subagent
 * registry.register({
 *   name: 'research-agent',
 *   description: 'Search and summarize information',
 *   agent: researchAgentLoop,
 * });
 *
 * // Check if subagent exists
 * if (registry.has('research-agent')) {
 *   // Run the subagent
 *   registry.run('research-agent', 'Search for AI news')
 *     .subscribe(event => console.log(event.type));
 * }
 * ```
 */
export class SubagentRegistry implements ISubagentRegistry {
  private readonly subagents: Map<string, SubagentEntry> = new Map();
  private readonly destroy$: Observable<void>;

  constructor(destroy$?: Observable<void>) {
    // Create a default destroy$ if not provided
    this.destroy$ = destroy$ ?? EMPTY;
  }

  // ============================================================
  // SubagentRegistry Interface Implementation
  // ============================================================

  /**
   * Check if a subagent is registered.
   */
  has(name: string): boolean {
    return this.subagents.has(name);
  }

  /**
   * Get subagent info by name.
   */
  get(name: string): SubagentInfo | undefined {
    const entry = this.subagents.get(name);
    if (!entry) {
      return undefined;
    }

    // Convert internal entry to SubagentInfo interface
    // Build conditionally to satisfy exactOptionalPropertyTypes
    const info: SubagentInfo = {
      name: entry.config.name,
      mode: entry.config.mode ?? 'subagent',
    };
    if (entry.config.description !== undefined) {
      info.description = entry.config.description;
    }
    return info;
  }

  /**
   * List all registered subagents.
   */
  list(): SubagentInfo[] {
    return Array.from(this.subagents.values()).map((entry) => {
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
   * Run a subagent by name.
   *
   * Emits:
   * 1. subagent.start - Subagent begins execution
   * 2. Nested agent events (agent.*, llm.*, tool.*, etc.) with parentSessionId
   * 3. subagent.complete - Subagent finished successfully
   * 4. OR subagent.error - Subagent failed
   *
   * All nested events are decorated with:
   * - parentSessionId: The parent session's ID
   */
  run(
    name: string,
    input: string,
    options?: { sessionMessages?: Message[] }
  ): Observable<AgentEvent> {
    const entry = this.subagents.get(name);

    if (!entry) {
      // Subagent not found - emit error event
      const errorEvent: AgentEvent = {
        type: 'subagent.error',
        timestamp: Date.now(),
        sessionId: '', // Will be set by caller if needed
        error: {
          name: 'SubagentNotFoundError',
          message: `Subagent '${name}' is not registered`,
        },
      };
      return of(errorEvent);
    }

    const sessionId = generateId('session');
    const parentSessionId = options?.sessionMessages?.[0]?.name ?? '';
    const agent = entry.config.agent;

    return this.runWithFullEventStream(agent, input, name, sessionId, parentSessionId);
  }

  /**
   * Execute subagent with full event stream.
   *
   * Emits all events in order:
   * 1. subagent.start
   * 2. All nested agent events
   * 3. subagent.complete or subagent.error
   */
  private runWithFullEventStream(
    agent: AgentLoop,
    input: string,
    subagentName: string,
    sessionId: string,
    parentSessionId: string
  ): Observable<AgentEvent> {
    const startEvent: AgentEvent = {
      type: 'subagent.start',
      timestamp: Date.now(),
      sessionId,
      parentSessionId,
      subagentName,
      input,
    };

    // Track final output for complete event
    let finalOutput = '';
    let hadError = false;

    const nested$ = agent.run(input).pipe(
      takeUntil(this.destroy$),
      map((event) => {
        // Track completion
        if (event.type === 'agent.complete') {
          const completeEvent = event;
          finalOutput = completeEvent.output;
        }
        if (event.type === 'subagent.error') {
          hadError = true;
        }

        // Decorate nested events with parent context
        return {
          ...event,
          parentSessionId,
        } as AgentEvent;
      }),
      catchError((error: Error) => {
        hadError = true;
        const errorEvent: AgentEvent = {
          type: 'subagent.error',
          timestamp: Date.now(),
          sessionId,
          error: serializeError(error),
        };
        return of(errorEvent);
      })
    );

    // Use concat to properly sequence: start → nested events → complete/error
    return concat(
      of(startEvent),
      nested$,
      new Observable<AgentEvent>((subscriber) => {
        if (!hadError) {
          const completeEvent: AgentEvent = {
            type: 'subagent.complete',
            timestamp: Date.now(),
            sessionId,
            output: finalOutput,
          };
          subscriber.next(completeEvent);
        }
        subscriber.complete();
      })
    );
  }

  // ============================================================
  // Extended Methods (beyond SubagentRegistry interface)
  // ============================================================

  /**
   * Register a subagent.
   *
   * @param config - Subagent configuration
   */
  register(config: SubagentConfig): void {
    if (this.subagents.has(config.name)) {
      // Optionally warn or throw - for now, just overwrite
      console.warn(`Subagent '${config.name}' is already registered, overwriting.`);
    }

    this.subagents.set(config.name, {
      config,
      registeredAt: Date.now(),
    });
  }

  /**
   * Unregister a subagent.
   *
   * @param name - Name of the subagent to remove
   * @returns true if the subagent was removed, false if it didn't exist
   */
  unregister(name: string): boolean {
    return this.subagents.delete(name);
  }

  /**
   * Clear all registered subagents.
   */
  clear(): void {
    this.subagents.clear();
  }

  /**
   * Get the full config for a subagent (including agent reference).
   */
  getConfig(name: string): SubagentConfig | undefined {
    const entry = this.subagents.get(name);
    return entry?.config;
  }
}

/**
 * Create a new SubagentRegistry instance.
 */
export function createSubagentRegistry(destroy$?: Observable<void>): SubagentRegistry {
  return new SubagentRegistry(destroy$);
}
