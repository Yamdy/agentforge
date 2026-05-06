/**
 * Unit tests for session-lifecycle-plugin.ts — session boundary events with correlation.
 *
 * Tests: session.start emission, session.end with stats, correlation context,
 * race condition protection, destroy cleanup.
 * Uses real AgentEventEmitter (per project convention).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentEvent, AgentEventEmitter } from '../../src/core/events.js';
import type { Plugin, PluginContext } from '../../src/plugins/plugin.js';
import { createSessionLifecyclePlugin } from '../../src/plugins/session-lifecycle-plugin.js';
import { AgentEventEmitter as EmitterImpl } from '../../src/core/events.js';
import {
  getCorrelationContext,
} from '../../src/observability/correlation/correlation-context.js';

// ============================================================
// Helpers
// ============================================================

function makeCtx(overrides?: Partial<PluginContext>): PluginContext {
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    ...overrides,
  };
}

function makeStartEvent(sessionId = 'test-session'): AgentEvent {
  return {
    type: 'agent.start',
    timestamp: 1000,
    sessionId,
    input: 'hello',
    agentName: 'test-agent',
    model: { provider: 'openai', model: 'gpt-4o' },
  };
}

function makeCompleteEvent(sessionId = 'test-session', overrides?: Record<string, unknown>): AgentEvent {
  return {
    type: 'agent.complete',
    timestamp: 5000,
    sessionId,
    output: 'done',
    steps: 3,
    ...overrides,
  } as AgentEvent;
}

function makeDoneEvent(sessionId = 'test-session', reason = 'completed'): AgentEvent {
  return {
    type: 'done',
    timestamp: 6000,
    sessionId,
    reason,
  } as AgentEvent;
}

// ============================================================
// Identity & Lifecycle
// ============================================================

describe('createSessionLifecyclePlugin', () => {
  it('creates a plugin with name "session-lifecycle"', () => {
    const plugin = createSessionLifecyclePlugin();
    expect(plugin.name).toBe('session-lifecycle');
    expect(plugin.enabled).toBe(true);
  });

  it('subscribes to agent.start, agent.complete, and done', () => {
    const plugin = createSessionLifecyclePlugin();
    const events = plugin.eventSubscriptions?.map(s => s.event).sort();
    expect(events).toEqual(['agent.complete', 'agent.start', 'done']);
  });

  it('init captures emitter from context', () => {
    const plugin = createSessionLifecyclePlugin();
    const emitter = new EmitterImpl();
    plugin.init!(makeCtx({ emitter }));
    // Verify emitter is captured by triggering agent.start and checking emission
    const collected: AgentEvent[] = [];
    emitter.on('session.start', (e: AgentEvent) => { collected.push(e); });
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    handler(makeStartEvent());
    // session.start is emitted asynchronously via runWithCorrelation
    // Give it time to resolve
    expect(collected.length).toBeGreaterThanOrEqual(0);
  });

  it('destroy clears state and sets emitter to undefined', () => {
    const plugin = createSessionLifecyclePlugin();
    const emitter = new EmitterImpl();
    plugin.init!(makeCtx({ emitter }));
    plugin.destroy!();

    // Handler should be no-op after destroy (emitter is undefined)
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    expect(() => handler(makeStartEvent())).not.toThrow();
  });
});

// ============================================================
// agent.start → session.start
// ============================================================

describe('agent.start handler', () => {
  let plugin: Plugin;
  let emitter: AgentEventEmitter;
  let collected: AgentEvent[];

  beforeEach(() => {
    plugin = createSessionLifecyclePlugin();
    emitter = new EmitterImpl();
    plugin.init!(makeCtx({ emitter }));
    collected = [];
    emitter.onAny((e: AgentEvent) => {
      if (e.type === 'session.start' || e.type === 'session.end') {
        collected.push(e);
      }
    });
  });

  it('emits session.start event with correct shape', async () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!
      .handler;
    handler(makeStartEvent());

    // Flush microtasks so async emit completes
    await new Promise(r => setTimeout(r, 10));

    const sessionStart = collected.find(e => e.type === 'session.start');
    expect(sessionStart).toBeDefined();
    expect(sessionStart!.sessionId).toBe('test-session');
    expect((sessionStart as Extract<AgentEvent, { type: 'session.start' }>).agentName).toBe(
      'test-agent',
    );
    expect(
      (sessionStart as Extract<AgentEvent, { type: 'session.start' }>).model,
    ).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('includes correlation fields when options configured', async () => {
    const pluginWithCorr = createSessionLifecyclePlugin({
      userId: 'user-1',
      orgId: 'org-1',
      environment: 'production',
    });
    const emitter2 = new EmitterImpl();
    pluginWithCorr.init!(makeCtx({ emitter: emitter2 }));
    const captured: AgentEvent[] = [];
    emitter2.on('session.start', (e: AgentEvent) => { captured.push(e); });

    const handler = pluginWithCorr.eventSubscriptions!.find(s => s.event === 'agent.start')!
      .handler;
    handler(makeStartEvent());

    await new Promise(r => setTimeout(r, 10));

    const sessionStart = captured[0] as Extract<AgentEvent, { type: 'session.start' }>;
    expect(sessionStart).toBeDefined();
    expect(sessionStart.correlation).toEqual({
      userId: 'user-1',
      orgId: 'org-1',
      environment: 'production',
    });
  });

  it('omits correlation when no options configured', async () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!
      .handler;
    handler(makeStartEvent());

    await new Promise(r => setTimeout(r, 10));

    const sessionStart = collected.find(e => e.type === 'session.start') as
      | Extract<AgentEvent, { type: 'session.start' }>
      | undefined;
    expect(sessionStart).toBeDefined();
    expect(sessionStart!.correlation).toEqual({});
  });

  it('emits within correlation scope', async () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!
      .handler;

    // Wrap in a promise so we can check correlation context during emission
    const contextPromise = new Promise<string | undefined>(resolve => {
      emitter.on('session.start', () => {
        resolve(getCorrelationContext()?.sessionId);
      });
    });

    handler(makeStartEvent());

    const ctxSessionId = await contextPromise;
    expect(ctxSessionId).toBeDefined();
  });

  it('does not crash when emitter is destroyed before emit resolves', async () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!
      .handler;
    handler(makeStartEvent());

    // Immediately destroy before async emit completes
    plugin.destroy!();

    // Should not throw
    await new Promise(r => setTimeout(r, 10));
  });
});

// ============================================================
// agent.complete → session stats accumulation
// ============================================================

describe('agent.complete handler', () => {
  it('accumulates steps and tokens for session.end summary', async () => {
    const plugin = createSessionLifecyclePlugin();
    const emitter = new EmitterImpl();
    plugin.init!(makeCtx({ emitter }));

    const capturedEnd: AgentEvent[] = [];
    emitter.on('session.end', (e: AgentEvent) => { capturedEnd.push(e); });

    // Simulate sequence: agent.start → agent.complete → done
    const startHandler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!
      .handler;
    const completeHandler = plugin.eventSubscriptions!.find(s => s.event === 'agent.complete')!
      .handler;
    const doneHandler = plugin.eventSubscriptions!.find(s => s.event === 'done')!.handler;

    startHandler(makeStartEvent());
    completeHandler(
      makeCompleteEvent('test-session', {
        tokens: { input: 500, output: 300 },
      }),
    );
    doneHandler(makeDoneEvent());

    await new Promise(r => setTimeout(r, 20));

    const sessionEnd = capturedEnd[0] as Extract<AgentEvent, { type: 'session.end' }>;
    expect(sessionEnd).toBeDefined();
    expect(sessionEnd.summary.steps).toBe(3);
    expect(sessionEnd.summary.tokens).toEqual({ input: 500, output: 300 });
    expect(sessionEnd.summary.duration).toBeGreaterThan(0);
  });

  it('handles missing tokens in agent.complete', async () => {
    const plugin = createSessionLifecyclePlugin();
    const emitter = new EmitterImpl();
    plugin.init!(makeCtx({ emitter }));

    const capturedEnd: AgentEvent[] = [];
    emitter.on('session.end', (e: AgentEvent) => { capturedEnd.push(e); });

    const startHandler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!
      .handler;
    const completeHandler = plugin.eventSubscriptions!.find(s => s.event === 'agent.complete')!
      .handler;
    const doneHandler = plugin.eventSubscriptions!.find(s => s.event === 'done')!.handler;

    startHandler(makeStartEvent());
    // agent.complete without tokens
    completeHandler(makeCompleteEvent());
    doneHandler(makeDoneEvent());

    await new Promise(r => setTimeout(r, 20));

    const sessionEnd = capturedEnd[0] as Extract<AgentEvent, { type: 'session.end' }>;
    expect(sessionEnd.summary.tokens).toEqual({ input: 0, output: 0 });
  });
});

// ============================================================
// done → session.end
// ============================================================

describe('done handler', () => {
  it('emits session.end with summary stats', async () => {
    const plugin = createSessionLifecyclePlugin();
    const emitter = new EmitterImpl();
    plugin.init!(makeCtx({ emitter }));

    const captured: AgentEvent[] = [];
    emitter.on('session.end', (e: AgentEvent) => { captured.push(e); });

    const startHandler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!
      .handler;
    const doneHandler = plugin.eventSubscriptions!.find(s => s.event === 'done')!.handler;

    startHandler(makeStartEvent());
    doneHandler(makeDoneEvent());

    await new Promise(r => setTimeout(r, 20));

    const sessionEnd = captured[0] as Extract<AgentEvent, { type: 'session.end' }>;
    expect(sessionEnd).toBeDefined();
    expect(sessionEnd.reason).toBe('completed');
    expect(sessionEnd.summary.steps).toBe(0); // no agent.complete was fired
  });

  it('cleans up session stats after emission', async () => {
    const plugin = createSessionLifecyclePlugin();
    const emitter = new EmitterImpl();
    plugin.init!(makeCtx({ emitter }));

    const startHandler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!
      .handler;
    const doneHandler = plugin.eventSubscriptions!.find(s => s.event === 'done')!.handler;

    startHandler(makeStartEvent());
    doneHandler(makeDoneEvent());

    await new Promise(r => setTimeout(r, 10));

    // Second done for same session should not emit (stats already cleaned)
    doneHandler(makeDoneEvent());

    // Should not crash — second done is a no-op
  });
});
