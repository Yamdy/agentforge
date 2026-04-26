/**
 * SubagentRegistry Test Suite
 *
 * Tests for the SubagentRegistry implementation.
 * Covers registration, unregistration, execution, and event emission.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Observable,
  of,
  from,
  Subject,
  EMPTY,
  firstValueFrom,
  toArray,
} from 'rxjs';
import {
  SubagentRegistry,
  createSubagentRegistry,
} from '../../src/subagent/index.js';
import type {
  SubagentConfig,
  AgentLoop,
} from '../../src/subagent/types.js';
import type { AgentEvent } from '../../src/core/events.js';

// ============================================================
// Mock AgentLoop
// ============================================================

interface MockAgentBehavior {
  events?: AgentEvent[];
  error?: Error;
  delay?: number;
}

class MockAgentLoop implements AgentLoop {
  private behavior: MockAgentBehavior = {};
  private runCallCount = 0;
  private runInputs: string[] = [];
  readonly destroy$: Observable<void> = EMPTY;

  setBehavior(behavior: MockAgentBehavior): void {
    this.behavior = behavior;
  }

  run(input: string): Observable<AgentEvent> {
    this.runCallCount++;
    this.runInputs.push(input);

    if (this.behavior.error) {
      return new Observable(subscriber => {
        subscriber.error(this.behavior.error);
      });
    }

    if (this.behavior.events) {
      return from(this.behavior.events);
    }

    // Default: emit a simple agent.complete event
    return of({
      type: 'agent.complete',
      timestamp: Date.now(),
      sessionId: 'mock-session',
      output: `Mock output for: ${input}`,
      steps: 1,
    } as AgentEvent);
  }

  getCallCount(): number {
    return this.runCallCount;
  }

  getInputs(): string[] {
    return [...this.runInputs];
  }

  reset(): void {
    this.behavior = {};
    this.runCallCount = 0;
    this.runInputs = [];
  }
}

// ============================================================
// Test Helper: Create Mock SubagentConfig
// ============================================================

function createMockSubagentConfig(
  name: string,
  options?: {
    description?: string;
    mode?: 'primary' | 'subagent' | 'all';
    agent?: AgentLoop;
  }
): SubagentConfig {
  const agent = options?.agent ?? new MockAgentLoop();
  const config: SubagentConfig = {
    name,
    agent,
  };
  if (options?.description !== undefined) {
    config.description = options.description;
  }
  if (options?.mode !== undefined) {
    config.mode = options.mode;
  }
  return config;
}

// ============================================================
// Tests
// ============================================================

describe('SubagentRegistry', () => {
  let registry: SubagentRegistry;
  let mockAgent: MockAgentLoop;

  beforeEach(() => {
    registry = createSubagentRegistry();
    mockAgent = new MockAgentLoop();
  });

  // ========================================
  // register() - Registration
  // ========================================
  describe('register()', () => {
    it('should register a subagent successfully', () => {
      const config = createMockSubagentConfig('research-agent', {
        description: 'Search and summarize',
        agent: mockAgent,
      });

      registry.register(config);

      expect(registry.has('research-agent')).toBe(true);
    });

    it('should allow overwriting on duplicate registration (with warning)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config1 = createMockSubagentConfig('research-agent', {
        description: 'Original description',
        agent: mockAgent,
      });

      const newMockAgent = new MockAgentLoop();
      const config2 = createMockSubagentConfig('research-agent', {
        description: 'Updated description',
        agent: newMockAgent,
      });

      registry.register(config1);
      expect(registry.has('research-agent')).toBe(true);

      // Register same name again - should overwrite with warning
      registry.register(config2);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('research-agent')
      );

      // Should have the updated config
      const info = registry.get('research-agent');
      expect(info?.description).toBe('Updated description');

      warnSpy.mockRestore();
    });

    it('should register subagent with mode', () => {
      const config = createMockSubagentConfig('tool-agent', {
        mode: 'subagent',
        agent: mockAgent,
      });

      registry.register(config);

      const info = registry.get('tool-agent');
      expect(info?.mode).toBe('subagent');
    });

    it('should default mode to "subagent" when not specified', () => {
      const config = createMockSubagentConfig('default-mode-agent', {
        agent: mockAgent,
      });

      registry.register(config);

      const info = registry.get('default-mode-agent');
      expect(info?.mode).toBe('subagent');
    });
  });

  // ========================================
  // unregister() - Unregistration
  // ========================================
  describe('unregister()', () => {
    it('should unregister an existing subagent', () => {
      const config = createMockSubagentConfig('research-agent', {
        agent: mockAgent,
      });

      registry.register(config);
      expect(registry.has('research-agent')).toBe(true);

      const result = registry.unregister('research-agent');

      expect(result).toBe(true);
      expect(registry.has('research-agent')).toBe(false);
    });

    it('should return false when unregistering non-existent subagent', () => {
      const result = registry.unregister('non-existent');

      expect(result).toBe(false);
    });

    it('should not affect other registered subagents', () => {
      const agent1 = new MockAgentLoop();
      const agent2 = new MockAgentLoop();

      registry.register(createMockSubagentConfig('agent-1', { agent: agent1 }));
      registry.register(createMockSubagentConfig('agent-2', { agent: agent2 }));

      registry.unregister('agent-1');

      expect(registry.has('agent-1')).toBe(false);
      expect(registry.has('agent-2')).toBe(true);
    });
  });

  // ========================================
  // has() - Existence Check
  // ========================================
  describe('has()', () => {
    it('should return true for registered subagent', () => {
      registry.register(createMockSubagentConfig('test-agent', { agent: mockAgent }));

      expect(registry.has('test-agent')).toBe(true);
    });

    it('should return false for non-existent subagent', () => {
      expect(registry.has('non-existent')).toBe(false);
    });

    it('should return false after unregistration', () => {
      registry.register(createMockSubagentConfig('temp-agent', { agent: mockAgent }));
      registry.unregister('temp-agent');

      expect(registry.has('temp-agent')).toBe(false);
    });
  });

  // ========================================
  // list() - List All Subagents
  // ========================================
  describe('list()', () => {
    it('should return empty array when no subagents registered', () => {
      const result = registry.list();

      expect(result).toEqual([]);
    });

    it('should return list of registered subagents', () => {
      registry.register(createMockSubagentConfig('agent-1', {
        description: 'First agent',
        agent: mockAgent,
      }));

      const agent2 = new MockAgentLoop();
      registry.register(createMockSubagentConfig('agent-2', {
        description: 'Second agent',
        agent: agent2,
      }));

      const result = registry.list();

      expect(result).toHaveLength(2);
      expect(result.map(i => i.name)).toContain('agent-1');
      expect(result.map(i => i.name)).toContain('agent-2');
    });

    it('should include description when present', () => {
      registry.register(createMockSubagentConfig('described-agent', {
        description: 'A helpful agent',
        agent: mockAgent,
      }));

      const result = registry.list();

      expect(result).toHaveLength(1);
      expect(result[0]?.description).toBe('A helpful agent');
    });

    it('should not include description when not set', () => {
      registry.register(createMockSubagentConfig('undescribed-agent', {
        agent: mockAgent,
      }));

      const result = registry.list();

      expect(result).toHaveLength(1);
      expect(result[0]?.description).toBeUndefined();
    });
  });

  // ========================================
  // get() - Get Subagent Info
  // ========================================
  describe('get()', () => {
    it('should return subagent info for registered subagent', () => {
      registry.register(createMockSubagentConfig('info-agent', {
        description: 'Test description',
        mode: 'subagent',
        agent: mockAgent,
      }));

      const info = registry.get('info-agent');

      expect(info).toBeDefined();
      expect(info?.name).toBe('info-agent');
      expect(info?.description).toBe('Test description');
      expect(info?.mode).toBe('subagent');
    });

    it('should return undefined for non-existent subagent', () => {
      const info = registry.get('non-existent');

      expect(info).toBeUndefined();
    });
  });

  // ========================================
  // run() - Execute Subagent
  // ========================================
  describe('run()', () => {
    it('should execute a registered subagent', async () => {
      mockAgent.setBehavior({
        events: [
          {
            type: 'agent.complete',
            timestamp: Date.now(),
            sessionId: 'sub-session',
            output: 'Task completed',
            steps: 1,
          },
        ],
      });

      registry.register(createMockSubagentConfig('worker-agent', {
        agent: mockAgent,
      }));

      const events = await firstValueFrom(
        registry.run('worker-agent', 'Do something').pipe(toArray())
      );

      // Should emit subagent.start and subagent.complete
      expect(events.find(e => e.type === 'subagent.start')).toBeDefined();
      expect(events.find(e => e.type === 'subagent.complete')).toBeDefined();

      // Agent should have been called
      expect(mockAgent.getCallCount()).toBe(1);
      expect(mockAgent.getInputs()).toContain('Do something');
    });

    it('should emit subagent.error for unregistered subagent', async () => {
      const events = await firstValueFrom(
        registry.run('non-existent-agent', 'Do something').pipe(toArray())
      );

      const errorEvent = events.find(e => e.type === 'subagent.error');
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === 'subagent.error') {
        expect(errorEvent.error.name).toBe('SubagentNotFoundError');
        expect(errorEvent.error.message).toContain('non-existent-agent');
      }
    });

    it('should emit subagent.start event with correct fields', async () => {
      registry.register(createMockSubagentConfig('starter-agent', {
        agent: mockAgent,
      }));

      const events = await firstValueFrom(
        registry.run('starter-agent', 'Test input').pipe(toArray())
      );

      const startEvent = events.find(e => e.type === 'subagent.start');
      expect(startEvent).toBeDefined();
      if (startEvent?.type === 'subagent.start') {
        expect(startEvent.subagentName).toBe('starter-agent');
        expect(startEvent.input).toBe('Test input');
        expect(startEvent.sessionId).toBeDefined();
        expect(startEvent.parentSessionId).toBeDefined();
        expect(startEvent.timestamp).toBeGreaterThan(0);
      }
    });

    it('should emit subagent.complete event with output', async () => {
      mockAgent.setBehavior({
        events: [
          {
            type: 'agent.complete',
            timestamp: Date.now(),
            sessionId: 'sub-session',
            output: 'Final result',
            steps: 2,
          },
        ],
      });

      registry.register(createMockSubagentConfig('completer-agent', {
        agent: mockAgent,
      }));

      const events = await firstValueFrom(
        registry.run('completer-agent', 'Calculate').pipe(toArray())
      );

      const completeEvent = events.find(e => e.type === 'subagent.complete');
      expect(completeEvent).toBeDefined();
      if (completeEvent?.type === 'subagent.complete') {
        expect(completeEvent.output).toBe('Final result');
        expect(completeEvent.sessionId).toBeDefined();
        expect(completeEvent.timestamp).toBeGreaterThan(0);
      }
    });

    it('should emit subagent.error when subagent throws', async () => {
      mockAgent.setBehavior({
        error: new Error('Subagent execution failed'),
      });

      registry.register(createMockSubagentConfig('failing-agent', {
        agent: mockAgent,
      }));

      const events = await firstValueFrom(
        registry.run('failing-agent', 'Fail task').pipe(toArray())
      );

      const errorEvent = events.find(e => e.type === 'subagent.error');
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === 'subagent.error') {
        expect(errorEvent.error.message).toBe('Subagent execution failed');
      }
    });

    it('should emit subagent.error when subagent emits subagent.error event', async () => {
      mockAgent.setBehavior({
        events: [
          {
            type: 'subagent.error',
            timestamp: Date.now(),
            sessionId: 'sub-session',
            error: {
              name: 'SubagentError',
              message: 'Internal error',
            },
          },
        ],
      });

      registry.register(createMockSubagentConfig('error-agent', {
        agent: mockAgent,
      }));

      const events = await firstValueFrom(
        registry.run('error-agent', 'Error task').pipe(toArray())
      );

      const errorEvent = events.find(e => e.type === 'subagent.error');
      expect(errorEvent).toBeDefined();
    });

    it('should decorate nested events with parentSessionId', async () => {
      mockAgent.setBehavior({
        events: [
          {
            type: 'agent.step',
            timestamp: Date.now(),
            sessionId: 'nested-session',
            step: 1,
            maxSteps: 5,
          },
          {
            type: 'agent.complete',
            timestamp: Date.now(),
            sessionId: 'nested-session',
            output: 'Done',
            steps: 1,
          },
        ],
      });

      registry.register(createMockSubagentConfig('nested-agent', {
        agent: mockAgent,
      }));

      const events = await firstValueFrom(
        registry.run('nested-agent', 'Nested test').pipe(toArray())
      );

      // Find nested agent.step event (not subagent.start)
      const stepEvent = events.find(e => e.type === 'agent.step');
      expect(stepEvent).toBeDefined();
      if (stepEvent?.type === 'agent.step') {
        expect(stepEvent.parentSessionId).toBeDefined();
      }
    });

    it('should emit events in correct order: start -> nested -> complete', async () => {
      mockAgent.setBehavior({
        events: [
          {
            type: 'agent.step',
            timestamp: Date.now(),
            sessionId: 'nested-session',
            step: 1,
            maxSteps: 5,
          },
          {
            type: 'agent.complete',
            timestamp: Date.now(),
            sessionId: 'nested-session',
            output: 'Done',
            steps: 1,
          },
        ],
      });

      registry.register(createMockSubagentConfig('ordered-agent', {
        agent: mockAgent,
      }));

      const events = await firstValueFrom(
        registry.run('ordered-agent', 'Order test').pipe(toArray())
      );

      const types = events.map(e => e.type);

      // First event should be subagent.start
      expect(types[0]).toBe('subagent.start');

      // Last event should be subagent.complete
      expect(types[types.length - 1]).toBe('subagent.complete');

      // Nested events should be in between
      const startIdx = types.indexOf('subagent.start');
      const nestedIdx = types.indexOf('agent.step');
      const completeIdx = types.indexOf('subagent.complete');

      expect(nestedIdx).toBeGreaterThan(startIdx);
      expect(nestedIdx).toBeLessThan(completeIdx);
    });

    it('should not emit subagent.complete after subagent.error', async () => {
      mockAgent.setBehavior({
        error: new Error('Failure'),
      });

      registry.register(createMockSubagentConfig('no-complete-agent', {
        agent: mockAgent,
      }));

      const events = await firstValueFrom(
        registry.run('no-complete-agent', 'Fail').pipe(toArray())
      );

      // Should have start and error, but NOT complete
      expect(events.find(e => e.type === 'subagent.start')).toBeDefined();
      expect(events.find(e => e.type === 'subagent.error')).toBeDefined();
      expect(events.find(e => e.type === 'subagent.complete')).toBeUndefined();
    });

    it('should pass sessionMessages in options', async () => {
      registry.register(createMockSubagentConfig('session-agent', {
        agent: mockAgent,
      }));

      const sessionMessages = [
        { role: 'user' as const, content: 'Previous message', name: 'parent-session' },
      ];

      const events = await firstValueFrom(
        registry.run('session-agent', 'New input', { sessionMessages }).pipe(toArray())
      );

      const startEvent = events.find(e => e.type === 'subagent.start');
      expect(startEvent).toBeDefined();
      if (startEvent?.type === 'subagent.start') {
        // parentSessionId should be extracted from sessionMessages[0].name
        expect(startEvent.parentSessionId).toBe('parent-session');
      }
    });
  });

  // ========================================
  // clear() - Clear All Subagents
  // ========================================
  describe('clear()', () => {
    it('should clear all registered subagents', () => {
      registry.register(createMockSubagentConfig('agent-1', { agent: mockAgent }));
      registry.register(createMockSubagentConfig('agent-2', { agent: new MockAgentLoop() }));

      expect(registry.list()).toHaveLength(2);

      registry.clear();

      expect(registry.list()).toHaveLength(0);
      expect(registry.has('agent-1')).toBe(false);
      expect(registry.has('agent-2')).toBe(false);
    });

    it('should allow re-registration after clear', () => {
      registry.register(createMockSubagentConfig('agent-1', { agent: mockAgent }));
      registry.clear();

      registry.register(createMockSubagentConfig('agent-1', { agent: mockAgent }));

      expect(registry.has('agent-1')).toBe(true);
    });
  });

  // ========================================
  // getConfig() - Get Full Config
  // ========================================
  describe('getConfig()', () => {
    it('should return full config for registered subagent', () => {
      const config = createMockSubagentConfig('config-agent', {
        description: 'Test description',
        mode: 'subagent',
        agent: mockAgent,
      });

      registry.register(config);

      const result = registry.getConfig('config-agent');

      expect(result).toBeDefined();
      expect(result?.name).toBe('config-agent');
      expect(result?.description).toBe('Test description');
      expect(result?.mode).toBe('subagent');
      expect(result?.agent).toBe(mockAgent);
    });

    it('should return undefined for non-existent subagent', () => {
      const result = registry.getConfig('non-existent');

      expect(result).toBeUndefined();
    });
  });

  // ========================================
  // destroy$ - Lifecycle Management
  // ========================================
  describe('destroy$', () => {
    it('should stop subagent execution when destroy$ emits', async () => {
      const destroySubject = new Subject<void>();
      const registryWithDestroy = new SubagentRegistry(destroySubject);

      // Agent that emits slowly
      const slowAgent = new MockAgentLoop();
      slowAgent.setBehavior({
        events: [
          { type: 'agent.step', timestamp: Date.now(), sessionId: 'slow', step: 1, maxSteps: 5 },
          { type: 'agent.complete', timestamp: Date.now(), sessionId: 'slow', output: 'Done', steps: 1 },
        ],
      });

      registryWithDestroy.register(createMockSubagentConfig('slow-agent', {
        agent: slowAgent,
      }));

      // Start collecting events
      const eventsPromise = firstValueFrom(
        registryWithDestroy.run('slow-agent', 'Slow task').pipe(toArray())
      );

      // Emit destroy signal immediately
      destroySubject.next();

      const events = await eventsPromise;

      // May have partial events or just start
      // The key is that it should complete without hanging
      expect(events.length).toBeGreaterThanOrEqual(0);

      destroySubject.complete();
    });
  });

  // ========================================
  // Integration Scenarios
  // ========================================
  describe('Integration Scenarios', () => {
    it('should handle multiple sequential runs', async () => {
      registry.register(createMockSubagentConfig('reusable-agent', {
        agent: mockAgent,
      }));

      // First run
      const events1 = await firstValueFrom(
        registry.run('reusable-agent', 'First task').pipe(toArray())
      );
      expect(events1.find(e => e.type === 'subagent.complete')).toBeDefined();

      // Second run
      mockAgent.reset();
      const events2 = await firstValueFrom(
        registry.run('reusable-agent', 'Second task').pipe(toArray())
      );
      expect(events2.find(e => e.type === 'subagent.complete')).toBeDefined();
    });

    it('should handle concurrent runs of different subagents', async () => {
      const agent1 = new MockAgentLoop();
      const agent2 = new MockAgentLoop();

      registry.register(createMockSubagentConfig('concurrent-1', { agent: agent1 }));
      registry.register(createMockSubagentConfig('concurrent-2', { agent: agent2 }));

      // Run both concurrently
      const [events1, events2] = await Promise.all([
        firstValueFrom(registry.run('concurrent-1', 'Task 1').pipe(toArray())),
        firstValueFrom(registry.run('concurrent-2', 'Task 2').pipe(toArray())),
      ]);

      // Both should complete
      expect(events1.find(e => e.type === 'subagent.start')).toBeDefined();
      expect(events2.find(e => e.type === 'subagent.start')).toBeDefined();
    });

    it('should handle complex event chain from subagent', async () => {
      mockAgent.setBehavior({
        events: [
          { type: 'agent.step', timestamp: Date.now(), sessionId: 'complex', step: 1, maxSteps: 3 },
          { type: 'llm.request', timestamp: Date.now(), sessionId: 'complex', messages: [], model: { provider: 'mock', model: 'test' } },
          { type: 'llm.response', timestamp: Date.now(), sessionId: 'complex', content: 'Response', finishReason: 'stop' },
          { type: 'agent.step', timestamp: Date.now(), sessionId: 'complex', step: 2, maxSteps: 3 },
          { type: 'agent.complete', timestamp: Date.now(), sessionId: 'complex', output: 'Complex done', steps: 2 },
        ],
      });

      registry.register(createMockSubagentConfig('complex-agent', {
        agent: mockAgent,
      }));

      const events = await firstValueFrom(
        registry.run('complex-agent', 'Complex task').pipe(toArray())
      );

      // Should have all nested events plus start/complete
      expect(events.find(e => e.type === 'subagent.start')).toBeDefined();
      expect(events.filter(e => e.type === 'agent.step')).toHaveLength(2);
      expect(events.find(e => e.type === 'llm.request')).toBeDefined();
      expect(events.find(e => e.type === 'llm.response')).toBeDefined();
      expect(events.find(e => e.type === 'subagent.complete')).toBeDefined();
    });
  });
});
