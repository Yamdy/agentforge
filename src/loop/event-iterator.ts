/**
 * Event Iterator — extracted from agent-loop.ts
 *
 * Bridges the AgentEventEmitter to an AsyncGenerator, yielding events
 * as they are emitted and returning the RunResult when the run completes.
 */

import type {
  AgentEvent,
  AgentEventEmitter,
  LLMChunkEvent,
  SerializedError,
} from '../core/events.js';
import type { RunResult } from './agent-loop.js';
import { ErrorCode } from '../core/error-codes.js';

export interface EventIteratorDeps {
  emitter: AgentEventEmitter;
  sessionId: string;
  /** Mutable re-entrancy guard shared with run() */
  isRunning: () => boolean;
  /** Called when the iterator finishes early (cleanup) */
  cancelLoop: () => void;
}

/**
 * Yields events from an async run, bridging the emitter to a generator.
 * Replaces emitter.emit and emitter.emitChunk temporarily to enqueue
 * events for the generator.
 */
export async function* bridgeEmitterToGenerator(
  deps: EventIteratorDeps,
  run: (input: string) => Promise<RunResult>,
  input: string
): AsyncGenerator<AgentEvent | LLMChunkEvent, RunResult, void> {
  const { emitter, sessionId, isRunning, cancelLoop } = deps;

  // Re-entrancy guard
  if (isRunning()) {
    const now = Date.now();
    const err: SerializedError = {
      name: 'AgentAlreadyRunningError',
      message: 'Agent is already running',
      code: ErrorCode.AGENT_ALREADY_RUNNING,
    };
    yield { type: 'agent.error', timestamp: now, sessionId, error: err };
    yield { type: 'done', timestamp: now, sessionId, reason: 'error' as const };
    return { output: '', status: 'error', error: err };
  }

  const eventQueue: AgentEvent[] = [];
  let eventPushResolve: (() => void) | null = null;

  const origEmit = emitter.emit.bind(emitter);
  emitter.emit = async (event: AgentEvent): Promise<void> => {
    eventQueue.push(event);
    if (eventPushResolve) {
      eventPushResolve();
      eventPushResolve = null;
    }
    await origEmit(event);
  };

  const origEmitChunk = emitter.emitChunk.bind(emitter);
  emitter.emitChunk = (delta: string, metadata?: { index?: number }): void => {
    const chunk: LLMChunkEvent = {
      type: 'llm.chunk',
      delta,
      index: metadata?.index ?? 0,
      timestamp: Date.now(),
      sessionId,
    };
    eventQueue.push(chunk as unknown as AgentEvent);
    if (eventPushResolve) {
      eventPushResolve();
      eventPushResolve = null;
    }
    origEmitChunk(delta, metadata);
  };

  let runDone = false;
  try {
    let runResult: RunResult;
    const runPromise = Promise.resolve()
      .then(() => run(input))
      .then(v => {
        runResult = v;
        runDone = true;
        if (eventPushResolve) {
          eventPushResolve();
          eventPushResolve = null;
        }
        return v;
      });

    while (!runDone || eventQueue.length > 0) {
      if (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      } else if (!runDone) {
        await new Promise<void>(resolve => {
          eventPushResolve = resolve;
        });
      }
    }

    await runPromise;
    return runResult!;
  } finally {
    emitter.emit = origEmit;
    emitter.emitChunk = origEmitChunk;
    if (!runDone) {
      cancelLoop();
    }
  }
}
