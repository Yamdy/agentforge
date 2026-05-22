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

  it('invoke on empty point returns empty array without error', async () => {
    await expect(manager.invoke('agent.start', {}, {})).resolves.toEqual([]);
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

  // -------------------------------------------------------------------------
  // CompositeHook
  // -------------------------------------------------------------------------

  describe('CompositeHook', () => {
    describe('parallel mode', () => {
      it('runs all hooks via Promise.allSettled and collects results', async () => {
        const calls: string[] = [];
        manager.register({
          hooks: [
            { point: 'stage.before', handler: () => { calls.push('a'); } },
            { point: 'stage.before', handler: () => { calls.push('b'); } },
          ],
          mode: 'parallel',
        });
        const results = await manager.invoke('stage.before', {}, {});
        expect(calls.sort()).toEqual(['a', 'b']);
        expect(results).toHaveLength(2);
      });

      it('runs all hooks even when some throw (standard profile)', async () => {
        const calls: string[] = [];
        manager.register({
          hooks: [
            { point: 'stage.before', handler: () => { throw new Error('fail'); } },
            { point: 'stage.before', handler: () => { calls.push('survivor'); } },
          ],
          mode: 'parallel',
        });
        const results = await manager.invoke('stage.before', {}, {});
        expect(calls).toEqual(['survivor']);
        expect(results).toHaveLength(2);
      });

      it('circuit-breaks on error in strict profile', async () => {
        const calls: string[] = [];
        manager.setProfile('strict');
        manager.register({
          hooks: [
            { point: 'stage.before', handler: () => { throw new Error('fail'); } },
            { point: 'stage.before', priority: 10, handler: () => { calls.push('should-not-run'); } },
          ],
          mode: 'parallel',
        });
        await manager.invoke('stage.before', {}, {});
        expect(calls).toEqual([]);
      });
    });

    describe('sequential mode', () => {
      it('runs hooks in priority order', async () => {
        const order: string[] = [];
        manager.register({
          hooks: [
            { point: 'stage.before', handler: () => { order.push('low'); }, priority: 10 },
            { point: 'stage.before', handler: () => { order.push('high'); }, priority: 1 },
            { point: 'stage.before', handler: () => { order.push('mid'); }, priority: 5 },
          ],
          mode: 'sequential',
        });
        await manager.invoke('stage.before', {}, {});
        expect(order).toEqual(['high', 'mid', 'low']);
      });

      it('isolates errors — later hooks still run (standard profile)', async () => {
        const calls: string[] = [];
        manager.register({
          hooks: [
            { point: 'stage.after', handler: () => { throw new Error('boom'); } },
            { point: 'stage.after', handler: () => { calls.push('after-boom'); } },
          ],
          mode: 'sequential',
        });
        await manager.invoke('stage.after', {}, {});
        expect(calls).toEqual(['after-boom']);
      });

      it('returns array of results with one entry per hook', async () => {
        manager.register({
          hooks: [
            { point: 'stage.before', handler: () => {} },
            { point: 'stage.before', handler: () => {} },
            { point: 'stage.before', handler: () => {} },
          ],
          mode: 'sequential',
        });
        const results = await manager.invoke('stage.before', {}, {});
        expect(results).toHaveLength(3);
        results.forEach(r => expect(r).toBeUndefined());
      });
    });

    describe('first-wins mode', () => {
      it('stops at first successful hook', async () => {
        const calls: string[] = [];
        manager.register({
          hooks: [
            { point: 'stage.before', handler: () => { calls.push('first'); } },
            { point: 'stage.before', handler: () => { calls.push('second'); } },
          ],
          mode: 'first-wins',
        });
        const results = await manager.invoke('stage.before', {}, {});
        expect(calls).toEqual(['first']);
        expect(results).toHaveLength(1);
      });

      it('continues to next hook if current throws (standard profile)', async () => {
        const calls: string[] = [];
        manager.register({
          hooks: [
            { point: 'stage.before', handler: () => { calls.push('fail'); throw new Error('fail'); } },
            { point: 'stage.before', handler: () => { calls.push('win'); } },
          ],
          mode: 'first-wins',
        });
        const results = await manager.invoke('stage.before', {}, {});
        expect(calls).toEqual(['fail', 'win']);
        expect(results).toHaveLength(1);
      });

      it('returns empty array if all hooks throw', async () => {
        manager.register({
          hooks: [
            { point: 'stage.before', handler: () => { throw new Error('e1'); } },
            { point: 'stage.before', handler: () => { throw new Error('e2'); } },
          ],
          mode: 'first-wins',
        });
        const results = await manager.invoke('stage.before', {}, {});
        expect(results).toEqual([]);
      });
    });

    it('register accepts both Hook and CompositeHook at the same point', async () => {
      const calls: string[] = [];
      manager.register({ point: 'stage.before', handler: () => { calls.push('single'); } });
      manager.register({
        hooks: [
          { point: 'stage.before', handler: () => { calls.push('composite-a'); } },
          { point: 'stage.before', handler: () => { calls.push('composite-b'); } },
        ],
        mode: 'parallel',
      });
      await manager.invoke('stage.before', {}, {});
      expect(calls).toContain('single');
      expect(calls).toContain('composite-a');
      expect(calls).toContain('composite-b');
    });

    it('CompositeHook respects disabledHookNames', async () => {
      const calls: string[] = [];
      const hm = new HookManager(eventBus, { disabledHooks: ['skip-me'] });
      hm.register({
        hooks: [
          { point: 'stage.before', name: 'skip-me', handler: () => { calls.push('should-not-run'); } },
          { point: 'stage.before', name: 'run-me', handler: () => { calls.push('ran'); } },
        ],
        mode: 'sequential',
      });
      await hm.invoke('stage.before', {}, {});
      expect(calls).toEqual(['ran']);
    });

    it('first-wins respects priority order', async () => {
      const order: string[] = [];
      manager.register({
        hooks: [
          { point: 'stage.before', priority: 10, handler: () => { order.push('low'); } },
          { point: 'stage.before', priority: 1, handler: () => { order.push('high'); } },
        ],
        mode: 'first-wins',
      });
      await manager.invoke('stage.before', {}, {});
      // High priority (lower number) runs first and wins
      expect(order).toEqual(['high']);
    });

    it('minimal profile skips CompositeHook at non-error points', async () => {
      const calls: string[] = [];
      const hm = new HookManager(eventBus, { profile: 'minimal' });
      hm.register({
        hooks: [
          { point: 'stage.before', handler: () => { calls.push('should-not-run'); } },
        ],
        mode: 'sequential',
      });
      await hm.invoke('stage.before', {}, {});
      expect(calls).toEqual([]);
    });

    it('minimal profile still runs CompositeHook at error point', async () => {
      const calls: string[] = [];
      const hm = new HookManager(eventBus, { profile: 'minimal' });
      hm.register({
        hooks: [
          { point: 'error', handler: () => { calls.push('error-ran'); } },
        ],
        mode: 'sequential',
      });
      await hm.invoke('error', {}, {});
      expect(calls).toEqual(['error-ran']);
    });
  });
});
