import { describe, it, expect, beforeEach } from 'vitest';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';

describe('HookManager', () => {
  let eventBus: EventBus;
  let manager: HookManager;

  beforeEach(() => {
    eventBus = new EventBus();
    manager = new HookManager(eventBus);
  });

  it('invokes registered hook handler', async () => {
    const calls: string[] = [];
    manager.register({ point: 'stage.before', handler: () => { calls.push('hook1'); } });
    await manager.invoke('stage.before', { stage: 'processInput' }, {});
    expect(calls).toEqual(['hook1']);
  });

  it('invokes hooks in priority order (lower = first)', async () => {
    const calls: string[] = [];
    manager.register({ point: 'stage.before', handler: () => { calls.push('low'); }, priority: 10 });
    manager.register({ point: 'stage.before', handler: () => { calls.push('high'); }, priority: 1 });
    manager.register({ point: 'stage.before', handler: () => { calls.push('mid'); }, priority: 5 });
    await manager.invoke('stage.before', {}, {});
    expect(calls).toEqual(['high', 'mid', 'low']);
  });

  it('isolates errors — later hooks still run in standard profile', async () => {
    const calls: string[] = [];
    manager.register({ point: 'stage.after', handler: () => { throw new Error('boom'); } });
    manager.register({ point: 'stage.after', handler: () => { calls.push('after-boom'); } });
    await manager.invoke('stage.after', {}, {});
    expect(calls).toEqual(['after-boom']);
  });

  it('bridges to EventBus after hook invocation', async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('stage:before', (data) => { events.push({ type: 'stage:before', data }); });

    manager.register({ point: 'stage.before', handler: () => {} });
    await manager.invoke('stage.before', { stage: 'invokeLLM' }, {});

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('stage:before');
  });

  it('minimal profile only runs error hooks', async () => {
    const calls: string[] = [];
    manager.register({ point: 'stage.before', handler: () => { calls.push('stage'); } });
    manager.register({ point: 'error', handler: () => { calls.push('error'); } });
    manager.setProfile('minimal');
    await manager.invoke('stage.before', {}, {});
    await manager.invoke('error', {}, {});
    expect(calls).toEqual(['error']);
  });

  it('strict profile circuit-breaks on hook error', async () => {
    const calls: string[] = [];
    manager.register({ point: 'stage.before', handler: () => { throw new Error('fail'); }, priority: 1 });
    manager.register({ point: 'stage.before', handler: () => { calls.push('should-not-run'); }, priority: 10 });
    manager.setProfile('strict');
    await manager.invoke('stage.before', {}, {});
    expect(calls).toEqual([]);
  });

  it('skips disabled hook points', async () => {
    const calls: string[] = [];
    manager.register({ point: 'tool.before', handler: () => { calls.push('tool'); } });
    manager.register({ point: 'stage.before', handler: () => { calls.push('stage'); } });
    manager.disablePoint('tool.before');
    await manager.invoke('tool.before', {}, {});
    await manager.invoke('stage.before', {}, {});
    expect(calls).toEqual(['stage']);
  });

  it('skips hooks with names in disabledHooks', async () => {
    const calls: string[] = [];
    const hm = new HookManager(eventBus, { disabledHooks: ['secret-hook'] });
    hm.register({ point: 'stage.before', handler: () => { calls.push('a'); }, name: 'secret-hook' });
    hm.register({ point: 'stage.before', handler: () => { calls.push('b'); }, name: 'normal-hook' });
    await hm.invoke('stage.before', {}, {});
    expect(calls).toEqual(['b']);
  });

  it('awaits async handlers in order', async () => {
    const calls: string[] = [];
    manager.register({
      point: 'llm.after',
      handler: async () => {
        await new Promise(r => setTimeout(r, 5));
        calls.push('slow');
      },
      priority: 1,
    });
    manager.register({
      point: 'llm.after',
      handler: () => { calls.push('fast'); },
      priority: 10,
    });
    await manager.invoke('llm.after', {}, {});
    expect(calls).toEqual(['slow', 'fast']);
  });

  it('hook execution succeeds even if EventBus bridge throws', async () => {
    eventBus.subscribe('error', () => { throw new Error('bus fail'); });
    const calls: string[] = [];
    manager.register({ point: 'error', handler: () => { calls.push('hook-ran'); } });
    await manager.invoke('error', { error: new Error('test') }, {});
    expect(calls).toEqual(['hook-ran']);
  });

  it('invoke on empty point returns without error', async () => {
    await expect(manager.invoke('agent.start', {}, {})).resolves.toBeUndefined();
  });

  it('hooks on different points are independent', async () => {
    const stageCalls: string[] = [];
    const toolCalls: string[] = [];
    manager.register({ point: 'stage.before', handler: () => { stageCalls.push('s'); } });
    manager.register({ point: 'tool.before', handler: () => { toolCalls.push('t'); } });
    await manager.invoke('stage.before', {}, {});
    expect(stageCalls).toEqual(['s']);
    expect(toolCalls).toEqual([]);
  });

  it('handler receives input and mutable output', async () => {
    const output: Record<string, unknown> = { count: 0 };
    manager.register({
      point: 'stage.after',
      handler: (_input, out) => { (out as Record<string, unknown>).count = ((out as Record<string, unknown>).count as number) + 1; },
    });
    await manager.invoke('stage.after', { stage: 'processInput' }, output);
    expect(output.count).toBe(1);
  });

  it('bridge maps HookPoint dot notation to EventBus colon notation', async () => {
    const events: string[] = [];
    eventBus.subscribe('agent:start', () => { events.push('agent:start'); });
    eventBus.subscribe('llm:before', () => { events.push('llm:before'); });
    eventBus.subscribe('tool:after', () => { events.push('tool:after'); });

    manager.register({ point: 'agent.start', handler: () => {} });
    manager.register({ point: 'llm.before', handler: () => {} });
    manager.register({ point: 'tool.after', handler: () => {} });

    await manager.invoke('agent.start', {}, {});
    await manager.invoke('llm.before', {}, {});
    await manager.invoke('tool.after', {}, {});

    expect(events).toEqual(['agent:start', 'llm:before', 'tool:after']);
  });
});
