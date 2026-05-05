/**
 * Unit tests for PluginContext extended capabilities:
 * emitter, getState, listTools, addMessages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentEventEmitter } from '../../src/core/events.js';
import { createPluginContext, type PluginContext } from '../../src/plugins/plugin.js';
import { createInitialState, type AgentState } from '../../src/core/state.js';
import type { ToolDefinition } from '../../src/core/interfaces.js';

// ============================================================
// Helpers
// ============================================================

function createMockState(opts?: Partial<{ sessionId: string; agentName: string }>): AgentState {
  return createInitialState({
    sessionId: opts?.sessionId ?? 'test-session',
    agentName: opts?.agentName ?? 'test-agent',
    model: { provider: 'test', model: 'test-model' },
    initialMessages: [],
    maxSteps: 10,
  });
}

function createMockToolDef(name: string): ToolDefinition {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: {} as Record<string, unknown>,
    execute: async () => name,
  };
}

// ============================================================
// emitter
// ============================================================

describe('PluginContext emitter', () => {
  let emitter: AgentEventEmitter;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
  });

  it('should emit custom events through the emitter', async () => {
    const received: Array<{ type: string }> = [];
    emitter.onAny(e => { received.push(e as { type: string }); });

    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
    });

    await ctx.emitter.emit({
      type: 'state.change',
      timestamp: Date.now(),
      sessionId: 's1',
      from: 'running',
      to: 'paused',
    });

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]!.type).toBe('state.change');
  });

  it('should support cross-plugin event communication', async () => {
    // Plugin A emits via ctx.emitter, Plugin B receives via eventSubscription
    const receivedEvents: Array<unknown> = [];

    // Simulate Plugin B's subscription via emitter.on()
    const unsubscribe = emitter.on('agent.complete', (e) => {
      receivedEvents.push(e);
    });

    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
    });

    // Plugin A emits
    await ctx.emitter.emit({
      type: 'agent.complete',
      timestamp: Date.now(),
      sessionId: 's1',
      output: 'done',
      steps: 1,
    });

    expect(receivedEvents.length).toBe(1);
    expect((receivedEvents[0] as { output: string }).output).toBe('done');

    unsubscribe();
  });

  it('should use a new default emitter when none provided', () => {
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
    });

    expect(ctx.emitter).toBeDefined();
    expect(typeof ctx.emitter.emit).toBe('function');
    expect(typeof ctx.emitter.on).toBe('function');
  });
});

// ============================================================
// getState()
// ============================================================

describe('PluginContext getState()', () => {
  let emitter: AgentEventEmitter;
  let state: AgentState;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
    state = createMockState();
  });

  it('should return current state snapshot', () => {
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => state,
      listTools: () => [],
      addMessages: () => {},
    });

    const snapshot = ctx.getState();
    expect(snapshot.sessionId).toBe('test-session');
    expect(snapshot.agentName).toBe('test-agent');
    expect(snapshot.step).toBe(0);
    expect(snapshot.messages).toEqual([]);
  });

  it('should reflect state mutations', () => {
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => state,
      listTools: () => [],
      addMessages: () => {},
    });

    expect(ctx.getState().step).toBe(0);

    // Mutate state externally (simulating agent loop progression)
    state = { ...state, step: 5, output: 'partial result' };

    expect(ctx.getState().step).toBe(5);
    expect(ctx.getState().output).toBe('partial result');
  });

  it('should return a Readonly snapshot', () => {
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => state,
      listTools: () => [],
      addMessages: () => {},
    });

    const snapshot = ctx.getState();
    // TypeScript Readonly prevents mutation — verify snapshot has data
    expect(snapshot).toBeDefined();
    expect(snapshot.step).toBe(0);
  });

  it('should throw by default when getState not wired', () => {
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
    });

    expect(() => ctx.getState()).toThrow('PluginContext.getState() is not available in this context');
  });
});

// ============================================================
// listTools()
// ============================================================

describe('PluginContext listTools()', () => {
  let emitter: AgentEventEmitter;
  let state: AgentState;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
    state = createMockState();
  });

  it('should return tool definitions', () => {
    const tools: ToolDefinition[] = [
      createMockToolDef('read_file'),
      createMockToolDef('write_file'),
    ];

    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => state,
      listTools: () => tools,
      addMessages: () => {},
    });

    const result = ctx.listTools();
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('read_file');
    expect(result[1]!.name).toBe('write_file');
  });

  it('should return empty array when no tools registered', () => {
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => state,
      listTools: () => [],
      addMessages: () => {},
    });

    expect(ctx.listTools()).toEqual([]);
  });

  it('should return empty array by default', () => {
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
    });

    expect(ctx.listTools()).toEqual([]);
  });

  it('should include tool descriptions and parameters', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Search the web',
        parameters: { type: 'object', properties: { query: { type: 'string' } } } as Record<string, unknown>,
        execute: async () => 'search result',
      },
    ];

    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => state,
      listTools: () => tools,
      addMessages: () => {},
    });

    const result = ctx.listTools();
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe('Search the web');
    expect(result[0]!.parameters).toBeDefined();
  });
});

// ============================================================
// addMessages()
// ============================================================

describe('PluginContext addMessages()', () => {
  let emitter: AgentEventEmitter;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
  });

  it('should inject messages into the queue', () => {
    const added: Array<{ role: string; content: string }> = [];

    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => createMockState(),
      listTools: () => [],
      addMessages: (msgs) => { added.push(...msgs as Array<{ role: string; content: string }>); },
    });

    ctx.addMessages([{ role: 'system', content: 'Continue working on the task.' }]);

    expect(added).toHaveLength(1);
    expect(added[0]!.role).toBe('system');
    expect(added[0]!.content).toBe('Continue working on the task.');
  });

  it('should inject multiple messages in order', () => {
    const added: Array<{ role: string; content: string }> = [];

    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => createMockState(),
      listTools: () => [],
      addMessages: (msgs) => { added.push(...msgs as Array<{ role: string; content: string }>); },
    });

    ctx.addMessages([
      { role: 'system', content: 'First' },
      { role: 'user', content: 'Second' },
      { role: 'assistant', content: 'Third' },
    ]);

    expect(added).toHaveLength(3);
    expect(added[0]!.content).toBe('First');
    expect(added[1]!.content).toBe('Second');
    expect(added[2]!.content).toBe('Third');
  });

  it('should be a no-op by default', () => {
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
    });

    // Should not throw
    expect(() => ctx.addMessages([{ role: 'system', content: 'test' }])).not.toThrow();
  });

  it('should handle empty message array', () => {
    const added: Array<unknown> = [];

    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => createMockState(),
      listTools: () => [],
      addMessages: (msgs) => { added.push(...msgs); },
    });

    ctx.addMessages([]);
    expect(added).toHaveLength(0);
  });
});

// ============================================================
// Integration: combined capabilities
// ============================================================

describe('PluginContext combined capabilities', () => {
  it('should support all new capabilities together', async () => {
    const emitter = new AgentEventEmitter();
    const state = createMockState();
    const tools = [createMockToolDef('tool_a'), createMockToolDef('tool_b')];
    const injectedMessages: Array<unknown> = [];
    const receivedEvents: Array<unknown> = [];

    emitter.onAny(e => { receivedEvents.push(e); });

    const ctx = createPluginContext({
      sessionId: 'combined-session',
      agentName: 'combined-agent',
      emitter,
      getState: () => state,
      listTools: () => tools,
      addMessages: (msgs) => { injectedMessages.push(...msgs); },
    });

    // Use all capabilities
    expect(ctx.sessionId).toBe('combined-session');

    // getState
    expect(ctx.getState().step).toBe(0);

    // listTools
    expect(ctx.listTools()).toHaveLength(2);

    // addMessages
    ctx.addMessages([{ role: 'user', content: 'hello' }]);
    expect(injectedMessages).toHaveLength(1);

    // emitter
    await ctx.emitter.emit({
      type: 'agent.complete',
      timestamp: Date.now(),
      sessionId: 's1',
      output: 'ok',
      steps: 1,
    });
  });
});
