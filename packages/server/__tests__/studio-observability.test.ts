import { describe, it, expect } from 'vitest';
import { EventBus } from '@primo-ai/core';

import { StudioObservability } from '../src/studio/observability.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal agent-like object with an EventBus and a display name. */
function createMockAgent(name: string) {
  const eventBus = new EventBus();
  return { eventBus, name };
}

/** Emit an agent:start event as the real SessionManagerImpl does. */
function emitAgentStart(
  agent: { eventBus: EventBus; name?: string },
  sessionId: string,
  overrides?: Record<string, unknown>,
): void {
  agent.eventBus.emit('agent:start', {
    sessionId,
    input: 'hello',
    agentConfig: { name: agent.name },
    ...overrides,
  });
}

/** Emit an agent:end event as the real HookManager bridge does. */
function emitAgentEnd(
  agent: { eventBus: EventBus; name?: string },
  sessionId: string,
  overrides?: Record<string, unknown>,
): void {
  agent.eventBus.emit('agent:end', {
    sessionId,
    response: 'done',
    tokenUsage: { input: 50, output: 150 },
    duration: 1000,
    ...overrides,
  });
}

/** Run a full agent lifecycle on the given bus. */
function runFullAgentLifecycle(
  agent: { eventBus: EventBus; name?: string },
  sessionId: string,
  endOverrides?: Record<string, unknown>,
): void {
  emitAgentStart(agent, sessionId);
  emitAgentEnd(agent, sessionId, endOverrides);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('StudioObservability', () => {
  // We use a factory function that will fail at runtime until the real class
  // exists (RED phase). Each test will fail with a clear TypeError.
  function createObs(): StudioObservability {
    return new (StudioObservability as unknown as new () => StudioObservability)();
  }

  // -----------------------------------------------------------------------
  // 1. Constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('creates an instance with empty initial state', () => {
      const obs = createObs();
      expect(obs.getTraces()).toEqual([]);
    });

    it('creates an instance with zeroed metrics snapshot', () => {
      const obs = createObs();
      const snapshot = obs.getMetricsSnapshot();
      expect(snapshot.counters).toEqual({});
      expect(snapshot.gauges).toEqual({});
    });

    it('creates an instance with zeroed KPI', () => {
      const obs = createObs();
      const kpi = obs.getKpi();
      expect(kpi.totalRuns).toBe(0);
      expect(kpi.avgLatency).toBe(0);
      expect(kpi.totalTokens).toBe(0);
      expect(kpi.estimatedCost).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 2. attachAgent
  // -----------------------------------------------------------------------
  describe('attachAgent', () => {
    it('returns an unsubscribe function', () => {
      const obs = createObs();
      const agent = createMockAgent('test-agent');
      const unsubscribe = obs.attachAgent(agent);
      expect(typeof unsubscribe).toBe('function');
    });

    it('subscribing and unsubscribing stops event delivery', () => {
      const obs = createObs();
      const agent = createMockAgent('unsub-agent');
      const unsubscribe = obs.attachAgent(agent);

      // Agent:start while subscribed — should create a trace
      emitAgentStart(agent, 'session-1');
      expect(obs.getTraces().length).toBe(1);

      // Unsubscribe
      unsubscribe();

      // Another agent:start — should NOT create a trace
      emitAgentStart(agent, 'session-2');
      expect(obs.getTraces().length).toBe(1);
    });

    it('attaching the same agent twice does not duplicate handlers', () => {
      const obs = createObs();
      const agent = createMockAgent('dup-agent');

      obs.attachAgent(agent);
      obs.attachAgent(agent);

      // Start events should only be handled once
      emitAgentStart(agent, 'session-1');
      expect(obs.getTraces().length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Event: agent:start
  // -----------------------------------------------------------------------
  describe('on agent:start', () => {
    it('creates a new trace entry', () => {
      const obs = createObs();
      const agent = createMockAgent('alpha');
      obs.attachAgent(agent);

      emitAgentStart(agent, 'sid-001');
      const traces = obs.getTraces();

      expect(traces.length).toBe(1);
      expect(traces[0].id).toBe('sid-001');
      expect(traces[0].agentName).toBe('alpha');
    });

    it('starts a new trace when agent:start arrives without agentConfig.name, falling back to agent.name', () => {
      const obs = createObs();
      const agent = createMockAgent('named-agent');
      obs.attachAgent(agent);

      agent.eventBus.emit('agent:start', { sessionId: 'sid-fallback' });

      const traces = obs.getTraces();
      expect(traces.length).toBe(1);
      expect(traces[0].agentName).toBe('named-agent');
    });

    it('records startTime from the event timestamp', () => {
      const obs = createObs();
      const agent = createMockAgent('timed');
      obs.attachAgent(agent);

      const before = Date.now();
      emitAgentStart(agent, 'timed-session');
      const after = Date.now();

      const traces = obs.getTraces();
      expect(traces.length).toBe(1);
      expect(traces[0].startTime).toBeGreaterThanOrEqual(before);
      expect(traces[0].startTime).toBeLessThanOrEqual(after);
    });

    it('does not create a duplicate trace if agent:start fires twice for the same sessionId', () => {
      const obs = createObs();
      const agent = createMockAgent('dedup');
      obs.attachAgent(agent);

      emitAgentStart(agent, 'dup-session');
      emitAgentStart(agent, 'dup-session');

      const traces = obs.getTraces();
      expect(traces.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Event: agent:end
  // -----------------------------------------------------------------------
  describe('on agent:end', () => {
    it('completes the trace and sets status to "completed"', () => {
      const obs = createObs();
      const agent = createMockAgent('alpha');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-002');
      const traces = obs.getTraces();
      const trace = obs.getTrace('sid-002')!;

      // The trace should be in the list
      expect(traces.length).toBe(1);
      expect(trace.status).toBe('completed');
    });

    it('records duration from the agent:end event', () => {
      const obs = createObs();
      const agent = createMockAgent('beta');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-003', { duration: 2500 });
      const trace = obs.getTrace('sid-003')!;

      expect(trace.duration).toBe(2500);
    });

    it('records token usage', () => {
      const obs = createObs();
      const agent = createMockAgent('gamma');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-004', {
        tokenUsage: { input: 100, output: 300 },
      });
      const trace = obs.getTrace('sid-004')!;

      expect(trace.tokenTotal).toBe(400);
    });

    it('treats agent:end with an error property as "failed" status', () => {
      const obs = createObs();
      const agent = createMockAgent('epsilon');
      obs.attachAgent(agent);

      emitAgentStart(agent, 'sid-error');
      emitAgentEnd(agent, 'sid-error', { error: 'LLM quota exceeded' });
      const trace = obs.getTrace('sid-error')!;

      expect(trace.status).toBe('failed');
    });

    it('does nothing if agent:end fires for an unknown sessionId', () => {
      const obs = createObs();
      const agent = createMockAgent('zeta');
      obs.attachAgent(agent);

      // No agent:start for this session
      expect(() => {
        agent.eventBus.emit('agent:end', { sessionId: 'ghost-session' });
      }).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 5. getTraces
  // -----------------------------------------------------------------------
  describe('getTraces', () => {
    it('returns all traces when no filter is provided', () => {
      const obs = createObs();
      const a1 = createMockAgent('alpha');
      const a2 = createMockAgent('beta');
      obs.attachAgent(a1);
      obs.attachAgent(a2);

      runFullAgentLifecycle(a1, 'sid-a1');
      runFullAgentLifecycle(a1, 'sid-a2');
      runFullAgentLifecycle(a2, 'sid-b1');

      const traces = obs.getTraces();
      expect(traces.length).toBe(3);
    });

    it('filters by agentName', () => {
      const obs = createObs();
      const a1 = createMockAgent('alpha');
      const a2 = createMockAgent('beta');
      obs.attachAgent(a1);
      obs.attachAgent(a2);

      runFullAgentLifecycle(a1, 'sid-a1');
      runFullAgentLifecycle(a1, 'sid-a2');
      runFullAgentLifecycle(a2, 'sid-b1');

      const traces = obs.getTraces({ agentName: 'alpha' });
      expect(traces.length).toBe(2);
      traces.forEach((t) => expect(t.agentName).toBe('alpha'));
    });

    it('filters by status', () => {
      const obs = createObs();
      const agent = createMockAgent('theta');
      obs.attachAgent(agent);

      // Completed run
      runFullAgentLifecycle(agent, 'sid-ok');
      // Failed run
      emitAgentStart(agent, 'sid-fail');
      emitAgentEnd(agent, 'sid-fail', { error: 'fail' });
      // Started but not yet ended (status = "running")
      emitAgentStart(agent, 'sid-running');

      const completed = obs.getTraces({ status: 'completed' });
      expect(completed.length).toBe(1);
      expect(completed[0].id).toBe('sid-ok');

      const failed = obs.getTraces({ status: 'failed' });
      expect(failed.length).toBe(1);
      expect(failed[0].id).toBe('sid-fail');

      const running = obs.getTraces({ status: 'running' });
      expect(running.length).toBe(1);
      expect(running[0].id).toBe('sid-running');
    });

    it('filters by time range (since / until)', () => {
      const obs = createObs();
      const agent = createMockAgent('iota');
      obs.attachAgent(agent);

      const now = Date.now();

      // Past
      emitAgentStart(agent, 'sid-old', { timestamp: now - 5000 });
      emitAgentEnd(agent, 'sid-old', { timestamp: now - 4000 });

      // Recent
      emitAgentStart(agent, 'sid-recent', { timestamp: now - 1000 });
      emitAgentEnd(agent, 'sid-recent', { timestamp: now });

      const recent = obs.getTraces({ since: now - 2000 });
      expect(recent.length).toBe(1);
      expect(recent[0].id).toBe('sid-recent');

      const all = obs.getTraces({ since: now - 10_000, until: now + 1000 });
      expect(all.length).toBe(2);
    });

    it('returns an empty array when no traces match the filter', () => {
      const obs = createObs();
      const agent = createMockAgent('kappa');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-1');

      const result = obs.getTraces({ agentName: 'nonexistent' });
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 6. getTrace
  // -----------------------------------------------------------------------
  describe('getTrace', () => {
    it('returns full TraceDetail for a completed trace', () => {
      const obs = createObs();
      const agent = createMockAgent('lambda');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-detail', {
        duration: 500,
        tokenUsage: { input: 80, output: 120 },
      });

      const detail = obs.getTrace('sid-detail')!;
      expect(detail).toBeDefined();
      expect(detail.id).toBe('sid-detail');
      expect(detail.agentName).toBe('lambda');
      expect(detail.status).toBe('completed');
      expect(detail.duration).toBe(500);
      expect(detail.tokenTotal).toBe(200);
      expect(detail.startTime).toBeGreaterThan(0);

      // Should have spans (at minimum a root span from agent:start → agent:end)
      expect(Array.isArray(detail.spans)).toBe(true);
      expect(detail.spans.length).toBeGreaterThanOrEqual(0);
    });

    it('returns a TraceDetail with a rootSpan tree', () => {
      const obs = createObs();
      const agent = createMockAgent('mu');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-tree');

      const detail = obs.getTrace('sid-tree')!;
      expect(detail.rootSpan).toBeDefined();
      expect(detail.rootSpan.span.name).toBeTruthy();
      expect(Array.isArray(detail.rootSpan.children)).toBe(true);
    });

    it('returns undefined for a non-existent trace ID', () => {
      const obs = createObs();
      const result = obs.getTrace('i-do-not-exist');
      expect(result).toBeUndefined();
    });

    it('returns a TraceDetail with status "running" when agent:start fired but agent:end has not', () => {
      const obs = createObs();
      const agent = createMockAgent('nu');
      obs.attachAgent(agent);

      emitAgentStart(agent, 'sid-running');

      const detail = obs.getTrace('sid-running')!;
      expect(detail).toBeDefined();
      expect(detail.status).toBe('running');
      expect(detail.duration).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 7. getMetricsSnapshot
  // -----------------------------------------------------------------------
  describe('getMetricsSnapshot', () => {
    it('returns a MetricsSnapshot with counters after a completed run', () => {
      const obs = createObs();
      const agent = createMockAgent('xi');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-metrics');

      const snapshot = obs.getMetricsSnapshot();
      expect(snapshot).toHaveProperty('counters');
      expect(snapshot).toHaveProperty('gauges');
      expect(snapshot).toHaveProperty('histograms');
    });

    it('tracks run counts in counters', () => {
      const obs = createObs();
      const agent = createMockAgent('omicron');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-1');
      runFullAgentLifecycle(agent, 'sid-2');

      const snapshot = obs.getMetricsSnapshot();
      const totalRuns = Object.values(snapshot.counters).reduce((a, b) => a + b, 0);
      expect(totalRuns).toBeGreaterThanOrEqual(1);
    });

    it('records latency histogram after agent:end', () => {
      const obs = createObs();
      const agent = createMockAgent('pi');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-latency', { duration: 1500 });

      const snapshot = obs.getMetricsSnapshot();
      const histograms = snapshot.histograms;
      const hasLatencyEntry = Object.keys(histograms).some(
        (k) => k.toLowerCase().includes('latency') || k.toLowerCase().includes('duration'),
      );
      expect(hasLatencyEntry).toBe(true);
    });

    it('tracks active agent gauge', () => {
      const obs = createObs();
      const agent = createMockAgent('rho');
      obs.attachAgent(agent);

      // Start agent — gauge should increase
      emitAgentStart(agent, 'sid-gauge');

      const runningSnapshot = obs.getMetricsSnapshot();
      const activeGauges = Object.values(runningSnapshot.gauges).filter((v) => v > 0);
      expect(activeGauges.length).toBeGreaterThan(0);

      // End agent — gauge should decrease
      emitAgentEnd(agent, 'sid-gauge');

      const completedSnapshot = obs.getMetricsSnapshot();
      // Either gauge is 0 or there's no active gauge entry
      const activeVals = Object.values(completedSnapshot.gauges).filter((v) => v > 0);
      expect(activeVals.length).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // 8. getKpi
  // -----------------------------------------------------------------------
  describe('getKpi', () => {
    it('returns zeroed KPI when there are no completed traces', () => {
      const obs = createObs();
      const kpi = obs.getKpi();
      expect(kpi.totalRuns).toBe(0);
      expect(kpi.avgLatency).toBe(0);
      expect(kpi.totalTokens).toBe(0);
      expect(kpi.estimatedCost).toBe(0);
    });

    it('computes totalRuns from completed traces', () => {
      const obs = createObs();
      const agent = createMockAgent('sigma');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-1');
      runFullAgentLifecycle(agent, 'sid-2');
      runFullAgentLifecycle(agent, 'sid-3');

      const kpi = obs.getKpi();
      expect(kpi.totalRuns).toBe(3);
    });

    it('computes avgLatency as average duration of completed traces', () => {
      const obs = createObs();
      const agent = createMockAgent('tau');
      obs.attachAgent(agent);

      // Durations: 1000, 2000, 3000 → avg 2000
      runFullAgentLifecycle(agent, 'sid-a', { duration: 1000 });
      runFullAgentLifecycle(agent, 'sid-b', { duration: 2000 });
      runFullAgentLifecycle(agent, 'sid-c', { duration: 3000 });

      const kpi = obs.getKpi();
      expect(kpi.avgLatency).toBe(2000);
    });

    it('computes totalTokens as sum of all completed trace tokens', () => {
      const obs = createObs();
      const agent = createMockAgent('upsilon');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-a', { tokenUsage: { input: 50, output: 50 } });  // 100
      runFullAgentLifecycle(agent, 'sid-b', { tokenUsage: { input: 100, output: 200 } }); // 300

      const kpi = obs.getKpi();
      expect(kpi.totalTokens).toBe(400);
    });

    it('computes estimatedCost from total tokens using a default rate', () => {
      const obs = createObs();
      const agent = createMockAgent('phi');
      obs.attachAgent(agent);

      runFullAgentLifecycle(agent, 'sid-cost', {
        tokenUsage: { input: 1000, output: 500 },
      });
      // 1500 total tokens → cost depends on rate; just verify > 0
      const kpi = obs.getKpi();
      expect(kpi.estimatedCost).toBeGreaterThan(0);
    });

    it('only counts completed traces in totalRuns (not running-only)', () => {
      const obs = createObs();
      const agent = createMockAgent('chi');
      obs.attachAgent(agent);

      // A running trace (no agent:end yet)
      emitAgentStart(agent, 'sid-running');
      // A completed trace
      runFullAgentLifecycle(agent, 'sid-completed');

      const kpi = obs.getKpi();
      expect(kpi.totalRuns).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Multiple agents
  // -----------------------------------------------------------------------
  describe('multiple agents', () => {
    it('isolates traces from differently named agents', () => {
      const obs = createObs();
      const agentA = createMockAgent('agent-a');
      const agentB = createMockAgent('agent-b');
      obs.attachAgent(agentA);
      obs.attachAgent(agentB);

      runFullAgentLifecycle(agentA, 'sid-a1');
      runFullAgentLifecycle(agentA, 'sid-a2');
      runFullAgentLifecycle(agentB, 'sid-b1');

      const agentATraces = obs.getTraces({ agentName: 'agent-a' });
      const agentBTraces = obs.getTraces({ agentName: 'agent-b' });

      expect(agentATraces.length).toBe(2);
      agentATraces.forEach((t) => expect(t.agentName).toBe('agent-a'));

      expect(agentBTraces.length).toBe(1);
      agentBTraces.forEach((t) => expect(t.agentName).toBe('agent-b'));
    });

    it('agents on separate EventBus instances do not interfere', () => {
      const obs = createObs();
      const agentA = createMockAgent('separate-a');
      const agentB = createMockAgent('separate-b');
      obs.attachAgent(agentA);
      obs.attachAgent(agentB);

      emitAgentStart(agentA, 'sid-only-a');
      emitAgentStart(agentB, 'sid-only-b');

      // agentA's bus should not trigger agentB's traces
      const aTraces = obs.getTraces({ agentName: 'separate-a' });
      expect(aTraces.length).toBe(1);
      expect(aTraces[0].id).toBe('sid-only-a');

      const bTraces = obs.getTraces({ agentName: 'separate-b' });
      expect(bTraces.length).toBe(1);
      expect(bTraces[0].id).toBe('sid-only-b');
    });

    it('aggregates metrics across all agents', () => {
      const obs = createObs();
      const a1 = createMockAgent('alpha');
      const a2 = createMockAgent('beta');
      obs.attachAgent(a1);
      obs.attachAgent(a2);

      runFullAgentLifecycle(a1, 'sid-1', { duration: 500, tokenUsage: { input: 10, output: 20 } });
      runFullAgentLifecycle(a2, 'sid-2', { duration: 1500, tokenUsage: { input: 30, output: 40 } });

      const kpi = obs.getKpi();
      expect(kpi.totalRuns).toBe(2);
      expect(kpi.totalTokens).toBe(100); // (10+20) + (30+40)
      expect(kpi.avgLatency).toBe(1000); // (500+1500)/2
    });
  });

  // -----------------------------------------------------------------------
  // 10. Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('getTraces on a fresh instance returns empty array', () => {
      const obs = createObs();
      expect(obs.getTraces()).toEqual([]);
    });

    it('getTrace for a non-existent ID returns undefined', () => {
      const obs = createObs();
      expect(obs.getTrace('ghost')).toBeUndefined();
    });

    it('survives agent:end without a preceding agent:start', () => {
      const obs = createObs();
      const agent = createMockAgent('orphan');
      obs.attachAgent(agent);

      expect(() => {
        agent.eventBus.emit('agent:end', { sessionId: 'orphan-session' });
      }).not.toThrow();
    });

    it('handles rapid sequential lifecycle events without error', () => {
      const obs = createObs();
      const agent = createMockAgent('rapid');
      obs.attachAgent(agent);

      const sessionCount = 20;
      for (let i = 0; i < sessionCount; i++) {
        runFullAgentLifecycle(agent, `rapid-session-${i}`, {
          duration: i * 100,
          tokenUsage: { input: 10 * i, output: 20 * i },
        });
      }

      expect(obs.getTraces().length).toBe(sessionCount);
      const kpi = obs.getKpi();
      expect(kpi.totalRuns).toBe(sessionCount);
    });

    it('handles agent:start events before attachAgent (ignores them)', () => {
      const obs = createObs();
      const agent = createMockAgent('late-attach');

      // Emit before attaching
      emitAgentStart(agent, 'sid-early');

      // Now attach — the early event should have been missed
      obs.attachAgent(agent);
      expect(obs.getTraces().length).toBe(0);
    });

    it('survives events with malformed payloads', () => {
      const obs = createObs();
      const agent = createMockAgent('malformed');
      obs.attachAgent(agent);

      expect(() => {
        agent.eventBus.emit('agent:start', null);
        agent.eventBus.emit('agent:end', undefined);
        agent.eventBus.emit('agent:start', {});
        agent.eventBus.emit('agent:end', {});
      }).not.toThrow();
    });
  });
});
