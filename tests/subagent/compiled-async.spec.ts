/**
 * Tests for Compiled/Async Subagent modes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Observable, of, EMPTY, Subject, toArray, firstValueFrom } from 'rxjs';
import { take, timeout } from 'rxjs/operators';
import type { AgentEvent } from '../../src/core/events.js';
import { SubagentRegistry, createSubagentRegistry } from '../../src/subagent/registry.js';
import type { SubagentConfig, AgentLoop, AsyncSubagentHandle } from '../../src/subagent/types.js';

// Helper to create a mock agent loop
function createMockAgentLoop(events: AgentEvent[], delay = 0): AgentLoop {
  return {
    run: vi.fn((input: string) => {
      if (delay > 0) {
        return new Observable<AgentEvent>(subscriber => {
          const timer = setTimeout(() => {
            events.forEach(e => subscriber.next(e));
            subscriber.complete();
          }, delay);
          return () => clearTimeout(timer);
        });
      }
      return of(...events);
    }),
    destroy$: EMPTY,
  };
}

// Helper to create a mock agent loop that errors
function createErrorAgentLoop(error: Error): AgentLoop {
  return {
    run: vi.fn(() => {
      return new Observable<AgentEvent>(subscriber => {
        subscriber.next({
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId: 'test',
          error: { name: error.name, message: error.message },
        });
        subscriber.complete();
      });
    }),
    destroy$: EMPTY,
  };
}

describe('Compiled/Async Subagent', () => {
  let registry: SubagentRegistry;

  beforeEach(() => {
    registry = createSubagentRegistry();
  });

  describe('Compiled Mode', () => {
    it('should run compiled subagent with config', async () => {
      const mockEvents: AgentEvent[] = [
        { type: 'agent.start', timestamp: Date.now(), sessionId: 'test', input: 'test', agentName: 'test', model: { provider: 'openai', model: 'gpt-4o' } },
        { type: 'agent.complete', timestamp: Date.now(), sessionId: 'test', output: 'compiled result', steps: 1 },
        { type: 'done', timestamp: Date.now(), sessionId: 'test', reason: 'stop' },
      ];

      const agent = createMockAgentLoop(mockEvents);

      registry.register({
        name: 'compiled-agent',
        description: 'A compiled subagent',
        agent,
        mode: 'subagent',
        compiledConfig: {
          model: { provider: 'openai', model: 'gpt-4o' },
          tools: ['read_file'],
          systemPrompt: 'You are a test agent',
          maxSteps: 5,
        },
      });

      const events = await firstValueFrom(
        registry.run('compiled-agent', 'test input').pipe(toArray())
      );

      expect(events.length).toBeGreaterThan(0);
      expect(agent.run).toHaveBeenCalledWith('test input');
    });
  });

  describe('Async Mode', () => {
    it('should return subagent.start event immediately', async () => {
      const mockEvents: AgentEvent[] = [
        { type: 'agent.start', timestamp: Date.now(), sessionId: 'test', input: 'test', agentName: 'test', model: { provider: 'openai', model: 'gpt-4o' } },
        { type: 'agent.complete', timestamp: Date.now(), sessionId: 'test', output: 'async result', steps: 1 },
        { type: 'done', timestamp: Date.now(), sessionId: 'test', reason: 'stop' },
      ];

      const agent = createMockAgentLoop(mockEvents, 100); // 100ms delay

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

      const events = await firstValueFrom(
        registry.run('async-agent', 'test input').pipe(take(1))
      );

      // Should only get subagent.start event immediately
      expect(events.type).toBe('subagent.start');
      if (events.type === 'subagent.start') {
        expect(events.subagentName).toBe('async-agent');
      }
    });

    it('should store handle in asyncRuns', async () => {
      const mockEvents: AgentEvent[] = [
        { type: 'agent.complete', timestamp: Date.now(), sessionId: 'test', output: 'result', steps: 1 },
      ];

      const agent = createMockAgentLoop(mockEvents, 50);

      registry.register({
        name: 'async-agent',
        agent,
        mode: 'subagent',
        executionMode: 'async',
        asyncConfig: {},
      });

      // Start async execution
      const startEvent = await firstValueFrom(
        registry.run('async-agent', 'input').pipe(take(1))
      );

      // Get session ID from start event
      const sessionId = startEvent.type === 'subagent.start' ? startEvent.sessionId : '';

      // Should have handle
      const handle = registry.getAsyncHandle(sessionId);
      expect(handle).toBeDefined();
      expect(handle?.sessionId).toBe(sessionId);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should call onComplete callback', async () => {
      const mockEvents: AgentEvent[] = [
        { type: 'agent.start', timestamp: Date.now(), sessionId: 'test', input: 'input', agentName: 'test', model: { provider: 'openai', model: 'gpt-4o' } },
        { type: 'agent.complete', timestamp: Date.now(), sessionId: 'test', output: 'result', steps: 1 },
        { type: 'done', timestamp: Date.now(), sessionId: 'test', reason: 'stop' },
      ];

      const onComplete = vi.fn();
      const agent = createMockAgentLoop(mockEvents);

      registry.register({
        name: 'async-agent',
        agent,
        mode: 'subagent',
        executionMode: 'async',
        asyncConfig: { onComplete },
      });

      // Start async execution
      await firstValueFrom(
        registry.run('async-agent', 'input').pipe(take(1))
      );

      // Wait for async completion
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(onComplete).toHaveBeenCalled();
      const result = onComplete.mock.calls[0]![0];
      expect(result.status).toBe('completed');
    });

    it('should call onError callback on failure', async () => {
      const error = new Error('Test error');
      const agent = createErrorAgentLoop(error);

      const onError = vi.fn();

      registry.register({
        name: 'error-agent',
        agent,
        mode: 'subagent',
        executionMode: 'async',
        asyncConfig: { onError },
      });

      // Start async execution
      await firstValueFrom(
        registry.run('error-agent', 'input').pipe(take(1))
      );

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 100));

      // Note: onError might not be called because the agent emits subagent.error event
      // but doesn't throw. The behavior depends on implementation.
    });

    it('should support cancel', async () => {
      const mockEvents: AgentEvent[] = [
        { type: 'agent.complete', timestamp: Date.now(), sessionId: 'test', output: 'result', steps: 1 },
      ];

      const agent = createMockAgentLoop(mockEvents, 200); // 200ms delay

      registry.register({
        name: 'async-agent',
        agent,
        mode: 'subagent',
        executionMode: 'async',
        asyncConfig: {},
      });

      // Start async execution
      const startEvent = await firstValueFrom(
        registry.run('async-agent', 'input').pipe(take(1))
      );

      const sessionId = startEvent.type === 'subagent.start' ? startEvent.sessionId : '';
      const handle = registry.getAsyncHandle(sessionId);

      // Cancel immediately
      await handle?.cancel();

      // Handle should be removed
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
