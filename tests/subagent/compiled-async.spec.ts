/**
 * Tests for Compiled/Async Subagent modes
 *
 * Uses listener-based API (registry.run returns Promise<string>).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentEvent } from '../../src/core/events.js';
import { SubagentRegistry, createSubagentRegistry } from '../../src/subagent/registry.js';
import type { AgentLoop } from '../../src/subagent/types.js';

// ============================================================
// Helper: collect events from run
// ============================================================

async function runAndCollect(
  registry: SubagentRegistry,
  name: string,
  input: string
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await registry.run(name, input, (e) => events.push(e));
  return events;
}

// ============================================================
// Mock AgentLoop (Promise-based, matches AgentLoop interface)
// ============================================================

interface MockAgentOptions {
  events?: AgentEvent[];
  delay?: number;
  error?: Error;
}

function createMockAgent(options: MockAgentOptions = {}): AgentLoop {
  const listeners: Array<(event: AgentEvent) => void> = [];

  const run = vi.fn(async (_input: string): Promise<string> => {
    const emit = () => {
      if (options.events) {
        for (const event of options.events) {
          for (const l of listeners) l(event);
        }
      }
    };

    if (options.error) {
      throw options.error;
    }

    if (options.delay && options.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    emit();

    const completeEvent = options.events?.find((e) => e.type === 'agent.complete');
    return (completeEvent as any)?.output ?? '';
  });

  return {
    run,
    onAny: vi.fn((listener: (event: AgentEvent) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
    on: vi.fn(() => () => {}),
  };
}

// ============================================================
// Tests
// ============================================================

describe('Compiled/Async Subagent', () => {
  let registry: SubagentRegistry;

  beforeEach(() => {
    registry = createSubagentRegistry();
  });

  describe('Compiled Mode', () => {
    it('should run compiled subagent with config', async () => {
      const mockEvents: AgentEvent[] = [
        {
          type: 'agent.start',
          timestamp: Date.now(),
          sessionId: 'test',
          input: 'test',
          agentName: 'test',
          model: { provider: 'openai', model: 'gpt-4o' },
        },
        {
          type: 'agent.complete',
          timestamp: Date.now(),
          sessionId: 'test',
          output: 'compiled result',
          steps: 1,
        },
        { type: 'done', timestamp: Date.now(), sessionId: 'test', reason: 'stop' },
      ];

      const agent = createMockAgent({ events: mockEvents });

      registry.register({
        name: 'compiled-agent',
        description: 'A compiled subagent',
        agent,
        mode: 'subagent',
        executionMode: 'compiled',
        compiledConfig: {
          model: { provider: 'openai', model: 'gpt-4o' },
          tools: ['read_file'],
          systemPrompt: 'You are a test agent',
          maxSteps: 5,
        },
      });

      const events = await runAndCollect(registry, 'compiled-agent', 'test input');

      expect(events.length).toBeGreaterThan(0);
      expect(agent.run).toHaveBeenCalledWith('test input');
    });
  });

  describe('Async Mode', () => {
    it('should return subagent.start event immediately', async () => {
      const mockEvents: AgentEvent[] = [
        {
          type: 'agent.start',
          timestamp: Date.now(),
          sessionId: 'test',
          input: 'test',
          agentName: 'test',
          model: { provider: 'openai', model: 'gpt-4o' },
        },
        {
          type: 'agent.complete',
          timestamp: Date.now(),
          sessionId: 'test',
          output: 'async result',
          steps: 1,
        },
        { type: 'done', timestamp: Date.now(), sessionId: 'test', reason: 'stop' },
      ];

      const agent = createMockAgent({ events: mockEvents, delay: 100 });

      registry.register({
        name: 'async-agent',
        description: 'An async subagent',
        agent,
        mode: 'subagent',
        executionMode: 'async',
        asyncConfig: {
          onComplete: vi.fn(),
          onError: vi.fn(),
        },
      });

      const events: AgentEvent[] = [];
      // For async mode, run() returns immediately (doesn't await agent execution)
      await registry.run('async-agent', 'test input', (e) => events.push(e));

      // First event should be subagent.start, emitted synchronously
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]!.type).toBe('subagent.start');
      if (events[0]!.type === 'subagent.start') {
        expect(events[0]!.subagentName).toBe('async-agent');
      }
    });

    it('should store handle in asyncRuns', async () => {
      const mockEvents: AgentEvent[] = [
        {
          type: 'agent.complete',
          timestamp: Date.now(),
          sessionId: 'test',
          output: 'result',
          steps: 1,
        },
      ];

      vi.useFakeTimers();
      const agent = createMockAgent({ events: mockEvents, delay: 50 });

      registry.register({
        name: 'async-agent',
        agent,
        mode: 'subagent',
        executionMode: 'async',
        asyncConfig: {},
      });

      const events: AgentEvent[] = [];
      await registry.run('async-agent', 'input', (e) => events.push(e));

      // Get session ID from start event
      const startEvent = events[0]!;
      const sessionId =
        startEvent.type === 'subagent.start' ? startEvent.sessionId : '';

      // Should have handle (agent still running — timers not yet advanced)
      const handle = registry.getAsyncHandle(sessionId);
      expect(handle).toBeDefined();
      expect(handle?.sessionId).toBe(sessionId);

      // Advance timers through agent delay + onComplete callback
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    });

    it('should call onComplete callback', async () => {
      const mockEvents: AgentEvent[] = [
        {
          type: 'agent.start',
          timestamp: Date.now(),
          sessionId: 'test',
          input: 'input',
          agentName: 'test',
          model: { provider: 'openai', model: 'gpt-4o' },
        },
        {
          type: 'agent.complete',
          timestamp: Date.now(),
          sessionId: 'test',
          output: 'result',
          steps: 1,
        },
        { type: 'done', timestamp: Date.now(), sessionId: 'test', reason: 'stop' },
      ];

      const onComplete = vi.fn();
      const agent = createMockAgent({ events: mockEvents });

      registry.register({
        name: 'async-agent',
        agent,
        mode: 'subagent',
        executionMode: 'async',
        asyncConfig: { onComplete },
      });

      vi.useFakeTimers();
      const events: AgentEvent[] = [];
      await registry.run('async-agent', 'input', (e) => events.push(e));

      // Flush all timers — onComplete fires via .then() chain
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    });

    it('should call onError callback on failure', async () => {
      const error = new Error('Test error');
      const onError = vi.fn();

      const agent = createMockAgent({ error });

      registry.register({
        name: 'error-agent',
        agent,
        mode: 'subagent',
        executionMode: 'async',
        asyncConfig: { onError },
      });

      vi.useFakeTimers();
      const events: AgentEvent[] = [];
      await registry.run('error-agent', 'input', (e) => events.push(e));

      // Flush all timers — onError fires via .catch() chain
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      // onError should have been called since agent.run() rejects
      expect(onError).toHaveBeenCalled();
    });

    it('should support cancel', async () => {
      const mockEvents: AgentEvent[] = [
        {
          type: 'agent.complete',
          timestamp: Date.now(),
          sessionId: 'test',
          output: 'result',
          steps: 1,
        },
      ];

      const agent = createMockAgent({ events: mockEvents, delay: 200 });

      registry.register({
        name: 'async-agent',
        agent,
        mode: 'subagent',
        executionMode: 'async',
        asyncConfig: {},
      });

      const events: AgentEvent[] = [];
      await registry.run('async-agent', 'input', (e) => events.push(e));

      const startEvent = events[0]!;
      const sessionId =
        startEvent.type === 'subagent.start' ? startEvent.sessionId : '';
      const handle = registry.getAsyncHandle(sessionId);

      // Cancel immediately
      await handle?.cancel();

      // Handle should be removed (getAsyncHandle auto-cleans non-running handles)
      expect(registry.getAsyncHandle(sessionId)).toBeUndefined();
    });
  });

  describe('getAsyncHandle', () => {
    it('should return undefined for unknown session', () => {
      const handle = registry.getAsyncHandle('unknown-session');
      expect(handle).toBeUndefined();
    });
  });
});
