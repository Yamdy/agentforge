import { describe, it, expect, beforeEach } from 'vitest';
import { PluginManager } from '../src/plugin-manager.js';
import { PipelineRunner } from '../src/pipeline.js';
import { ToolRegistry } from '../src/tool-registry.js';
import type { PipelineStage, PipelineContext, Processor, Tool, PluginRegistration, HarnessAPI, Hook } from '@agentforge/sdk';
import { z } from 'zod';
import path from 'node:path';

describe('PluginManager', () => {
  let runner: PipelineRunner;
  let registry: ToolRegistry;
  let manager: PluginManager;

  beforeEach(() => {
    runner = new PipelineRunner();
    registry = new ToolRegistry();
    manager = new PluginManager(runner, registry);
  });

  it('allows plugin to register a processor via HarnessAPI', async () => {
    const loggedStages: PipelineStage[] = [];

    const plugin = (api: HarnessAPI): PluginRegistration => {
      const logger: Processor = {
        stage: 'processInput',
        execute: async (ctx) => {
          loggedStages.push('processInput');
          return ctx;
        },
      };
      api.registerProcessor('processInput', logger);
      return { processors: [logger] };
    };

    manager.initializePlugin(plugin);

    const ctx: PipelineContext = {
      request: { input: 'test', sessionId: 's1' },
      agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { custom: {} },
    };
    await runner.run(ctx, ['processInput']);

    expect(loggedStages).toContain('processInput');
  });

  it('allows plugin to register a tool via HarnessAPI', () => {
    const greetTool: Tool<{ name: string }, string> = {
      name: 'greet',
      description: 'Greet someone',
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    };

    const plugin = (api: HarnessAPI): PluginRegistration => {
      api.registerTool(greetTool);
      return { tools: [greetTool] };
    };

    manager.initializePlugin(plugin);

    expect(registry.get('greet')).toBeDefined();
    expect(registry.get('greet')!.description).toBe('Greet someone');
  });

  it('allows plugin to register commands', async () => {
    const plugin = (api: HarnessAPI): PluginRegistration => {
      api.registerCommand('hello', async (args) => {});
      return {};
    };

    manager.initializePlugin(plugin);

    expect(manager.getCommand('hello')).toBeDefined();
  });

  it('allows plugin to subscribe to events and receive them', () => {
    const received: unknown[] = [];

    const plugin = (api: HarnessAPI): PluginRegistration => {
      api.subscribe('agent:start', (data) => {
        received.push(data);
      });
      return {};
    };

    manager.initializePlugin(plugin);
    manager.emitEvent('agent:start', { sessionId: 's1' });

    expect(received).toEqual([{ sessionId: 's1' }]);
  });

  it('loads plugin from a file path', async () => {
    const fixturePath = path.resolve(__dirname, 'fixtures/test-plugin.ts');

    await manager.loadPlugin(fixturePath);

    const ctx: PipelineContext = {
      request: { input: 'test', sessionId: 's1' },
      agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { custom: {} },
    };
    const result = await runner.run(ctx, ['processInput']);
    expect(result).toBeDefined();
  });

  it('catches plugin initialization errors without crashing', async () => {
    const badPath = path.resolve(__dirname, 'fixtures/nonexistent-plugin.ts');

    await manager.loadPlugin(badPath);

    expect(manager.getErrors()).toHaveLength(1);
    expect(manager.getErrors()[0].source).toBe(badPath);
    expect(manager.getErrors()[0].error.message).toContain('nonexistent-plugin');
  });

  it('catches factory function errors without crashing', () => {
    const brokenPlugin = (_api: HarnessAPI): PluginRegistration => {
      throw new Error('Plugin setup failed');
    };

    expect(() => manager.initializePlugin(brokenPlugin)).toThrow('Plugin setup failed');
  });

  it('allows plugin to register a hook at a HookPoint', () => {
    const hookCalls: Array<{ point: string; data: unknown }> = [];

    const hook: Hook = {
      point: 'tool.before',
      handler: (data) => { hookCalls.push({ point: 'tool.before', data }); },
    };

    const plugin = (api: HarnessAPI): PluginRegistration => {
      api.registerHook(hook);
      return {};
    };

    manager.initializePlugin(plugin);

    manager.hookManager.invoke('tool.before', { toolName: 'greet' }, {});

    expect(hookCalls).toEqual([{ point: 'tool.before', data: { toolName: 'greet' } }]);
  });

  it('allows plugin to declare a resource with start/stop lifecycle', async () => {
    const started: string[] = [];

    const plugin = (api: HarnessAPI): PluginRegistration => {
      api.registerResource({
        id: 'test-db',
        type: 'database',
        config: {},
        start: async () => { started.push('test-db:start'); return { connected: true }; },
        stop: async () => { started.push('test-db:stop'); },
      });
      return {};
    };

    manager.initializePlugin(plugin);
    await manager.initializeAll();
    expect(started).toEqual(['test-db:start']);

    await manager.shutdown();
    expect(started).toEqual(['test-db:start', 'test-db:stop']);
  });

  it('initializeAll starts all declared resources across plugins', async () => {
    const order: string[] = [];

    const pluginA = (api: HarnessAPI): PluginRegistration => {
      api.registerResource({ id: 'a', type: 'test', config: {}, start: async () => { order.push('a'); }, stop: async () => {} });
      return {};
    };
    const pluginB = (api: HarnessAPI): PluginRegistration => {
      api.registerResource({ id: 'b', type: 'test', config: {}, start: async () => { order.push('b'); }, stop: async () => {} });
      return {};
    };

    manager.initializePlugin(pluginA);
    manager.initializePlugin(pluginB);
    await manager.initializeAll();

    expect(order).toEqual(['a', 'b']);
  });

  it('shutdown cleans up all subscriptions', async () => {
    const received: unknown[] = [];

    const plugin = (api: HarnessAPI): PluginRegistration => {
      api.subscribe('agent:end', (data) => received.push(data));
      return {};
    };

    manager.initializePlugin(plugin);
    manager.emitEvent('agent:end', 'before-shutdown');
    await manager.shutdown();
    manager.emitEvent('agent:end', 'after-shutdown');

    expect(received).toEqual(['before-shutdown']);
  });

  it('plugin resource start errors are caught without crashing', async () => {
    const plugin = (api: HarnessAPI): PluginRegistration => {
      api.registerResource({
        id: 'bad',
        type: 'test',
        config: {},
        start: async () => { throw new Error('boom'); },
        stop: async () => {},
      });
      return {};
    };

    manager.initializePlugin(plugin);
    await manager.initializeAll();

    const errors = manager.getErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe('boom');
  });

  describe('HookManager delegation', () => {
    it('delegates registerHook to HookManager', async () => {
      const calls: unknown[] = [];
      manager.initializePlugin((api) => {
        api.registerHook({ point: 'tool.before', handler: (input) => { calls.push(input); } });
        return {};
      });

      await manager.hookManager.invoke('tool.before', { toolName: 'test' }, {});
      expect(calls).toEqual([{ toolName: 'test' }]);
    });
  });

  describe('integration', () => {
    it('test plugin registers processor and tool that work in full pipeline', async () => {
      const fixturePath = path.resolve(__dirname, 'fixtures/test-plugin.ts');
      await manager.loadPlugin(fixturePath);

      expect(registry.get('ping')).toBeDefined();
      expect(registry.get('ping')!.description).toBe('Returns pong + message');

      const pingTool = registry.get('ping')!;
      const result = await pingTool.execute({ message: 'hello' }, {});
      expect(result).toBe('pong: hello');

      const ctx: PipelineContext = {
        request: { input: 'test', sessionId: 's1' },
        agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
        iteration: { step: 0 },
        session: { custom: {} },
      };
      const pipelineResult = await runner.run(ctx, ['processInput']);
      expect(pipelineResult).toBeDefined();
    });

    it('full plugin lifecycle: processor + hook + tool + resource', async () => {
      const events: string[] = [];
      const hookCalls: unknown[] = [];

      const plugin = (api: HarnessAPI): PluginRegistration => {
        api.registerProcessor('processInput', {
          stage: 'processInput',
          execute: async (ctx) => {
            events.push('processor:processInput');
            return { ...ctx, session: { ...ctx.session, custom: { ...ctx.session.custom, annotated: true } } };
          },
        });

        const calcTool: Tool<{ a: number; b: number }, number> = {
          name: 'calc',
          description: 'Add two numbers',
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          execute: async ({ a, b }) => a + b,
        };
        api.registerTool(calcTool);

        api.registerHook({
          point: 'tool.before',
          handler: (data) => { hookCalls.push(data); },
        });

        api.subscribe('agent:start', () => events.push('event:agent:start'));
        api.subscribe('agent:end', () => events.push('event:agent:end'));

        api.registerResource({
          id: 'test-store',
          type: 'memory',
          config: {},
          start: async () => { events.push('resource:start'); return { data: new Map() }; },
          stop: async () => { events.push('resource:stop'); },
        });

        return {};
      };

      manager.initializePlugin(plugin);
      await manager.initializeAll();

      expect(events).toContain('resource:start');

      manager.emitEvent('agent:start');
      expect(events).toContain('event:agent:start');

      manager.hookManager.invoke('tool.before', { toolName: 'calc' }, {});
      expect(hookCalls).toEqual([{ toolName: 'calc' }]);

      const tool = registry.get('calc')!;
      expect(await tool.execute({ a: 2, b: 3 }, {})).toBe(5);

      const ctx: PipelineContext = {
        request: { input: 'test', sessionId: 's1' },
        agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
        iteration: { step: 0 },
        session: { custom: {} },
      };
      const result = (await runner.run(ctx, ['processInput'])) as PipelineContext;
      expect(result.session.custom.annotated).toBe(true);
      expect(events).toContain('processor:processInput');

      manager.emitEvent('agent:end');
      await manager.shutdown();

      expect(events).toContain('event:agent:end');
      expect(events).toContain('resource:stop');

      const afterShutdown: string[] = [...events];
      manager.emitEvent('agent:end');
      expect(events.length).toBe(afterShutdown.length);
    });
  });
});
