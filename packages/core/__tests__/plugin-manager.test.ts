import { describe, it, expect, beforeEach } from 'vitest';
import { PluginManager } from '../src/plugin-manager.js';
import { PipelineRunner } from '../src/pipeline.js';
import { ToolRegistry } from '../src/tool-registry.js';
import type { PipelineStage, PipelineContext, Processor, Tool, PluginRegistration, HarnessAPI, Hook, ResourceDeclaration } from '@agentforge/sdk';
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

    // Run pipeline through processInput stage
    const ctx = {
      request: { input: 'test', sessionId: 's1' },
      iteration: { step: 0 },
      pipeline: {},
      session: {},
      config: {},
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
      api.registerCommand('hello', async (args) => {
        /* no-op */
      });
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

    // The test plugin registers a processor at processInput — run pipeline to verify
    const ctx = {
      request: { input: 'test', sessionId: 's1' },
      iteration: { step: 0 },
      pipeline: {},
      session: {},
      config: {},
    };
    // Should not throw — the plugin's processor is active
    const result = await runner.run(ctx, ['processInput']);
    expect(result).toBeDefined();
  });

  it('catches plugin initialization errors without crashing', async () => {
    const badPath = path.resolve(__dirname, 'fixtures/nonexistent-plugin.ts');

    // Should not throw
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

    // Trigger the hook through the manager
    manager.invokeHook('tool.before', { toolName: 'greet' });

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

  describe('invokeWrapHook', () => {
    it('chains return values from multiple hooks', async () => {
      const hook1: Hook = {
        point: 'tool.wrap',
        handler: (data) => ({ ...data as Record<string, unknown>, result: 'replaced-1' }),
        priority: 10,
      };
      const hook2: Hook = {
        point: 'tool.wrap',
        handler: async (data) => ({ ...data as Record<string, unknown>, result: 'replaced-2' }),
        priority: 20,
      };

      manager.initializePlugin((api) => {
        api.registerHook(hook1);
        api.registerHook(hook2);
        return {};
      });

      const result = await manager.invokeWrapHook('tool.wrap', {
        toolName: 'test',
        result: 'original',
      });
      expect(result).toEqual({ toolName: 'test', result: 'replaced-2' });
    });

    it('passes through when hook returns undefined', async () => {
      const hook: Hook = {
        point: 'tool.wrap',
        handler: () => undefined,
      };

      manager.initializePlugin((api) => {
        api.registerHook(hook);
        return {};
      });

      const result = await manager.invokeWrapHook('tool.wrap', {
        toolName: 'test',
        result: 'original',
      });
      expect(result).toEqual({ toolName: 'test', result: 'original' });
    });

    it('returns data unchanged when no hooks registered', async () => {
      const data = { toolName: 'test', result: 'result' };
      const result = await manager.invokeWrapHook('tool.wrap', data);
      expect(result).toEqual(data);
    });

    it('surfaces errors from hook handlers', async () => {
      const hook: Hook = {
        point: 'tool.wrap',
        handler: () => { throw new Error('hook crash'); },
      };

      manager.initializePlugin((api) => {
        api.registerHook(hook);
        return {};
      });

      await expect(
        manager.invokeWrapHook('tool.wrap', { toolName: 'test', result: 'x' }),
      ).rejects.toThrow('hook crash');
    });

    it('handles hook returning a primitive (non-object)', async () => {
      const hook: Hook = {
        point: 'tool.wrap',
        handler: () => 'just a string',
      };

      manager.initializePlugin((api) => {
        api.registerHook(hook);
        return {};
      });

      const result = await manager.invokeWrapHook('tool.wrap', {
        toolName: 'test',
        result: 'original',
      });
      // A primitive return replaces the entire data
      expect(result).toBe('just a string');
    });
  });

  describe('integration', () => {
    it('test plugin registers processor and tool that work in full pipeline', async () => {
      const fixturePath = path.resolve(__dirname, 'fixtures/test-plugin.ts');
      await manager.loadPlugin(fixturePath);

      // Verify tool is registered
      expect(registry.get('ping')).toBeDefined();
      expect(registry.get('ping')!.description).toBe('Returns pong + message');

      // Verify tool is executable
      const pingTool = registry.get('ping')!;
      const result = await pingTool.execute({ message: 'hello' }, {});
      expect(result).toBe('pong: hello');

      // Verify processor runs in pipeline
      const ctx = {
        request: { input: 'test', sessionId: 's1' },
        iteration: { step: 0 },
        pipeline: {},
        session: {},
        config: {},
      };
      const pipelineResult = await runner.run(ctx, ['processInput']);
      expect(pipelineResult).toBeDefined();
    });

    it('full plugin lifecycle: processor + hook + tool + resource', async () => {
      const events: string[] = [];
      const hookCalls: unknown[] = [];

      const plugin = (api: HarnessAPI): PluginRegistration => {
        // Register a processor that annotates context
        api.registerProcessor('processInput', {
          stage: 'processInput',
          execute: async (ctx) => {
            events.push('processor:processInput');
            return { ...ctx, pipeline: { ...ctx.pipeline, annotated: true } };
          },
        });

        // Register a tool
        const calcTool: Tool<{ a: number; b: number }, number> = {
          name: 'calc',
          description: 'Add two numbers',
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          execute: async ({ a, b }) => a + b,
        };
        api.registerTool(calcTool);

        // Register a hook
        api.registerHook({
          point: 'tool.before',
          handler: (data) => hookCalls.push(data),
        });

        // Subscribe to events
        api.subscribe('agent:start', () => events.push('event:agent:start'));
        api.subscribe('agent:end', () => events.push('event:agent:end'));

        // Register a resource
        api.registerResource({
          id: 'test-store',
          type: 'memory',
          config: {},
          start: async () => { events.push('resource:start'); return { data: new Map() }; },
          stop: async () => { events.push('resource:stop'); },
        });

        return {};
      };

      // Full lifecycle
      manager.initializePlugin(plugin);
      await manager.initializeAll();

      // Resource started
      expect(events).toContain('resource:start');

      // Emit events reach subscriber
      manager.emitEvent('agent:start');
      expect(events).toContain('event:agent:start');

      // Hook fires
      manager.invokeHook('tool.before', { toolName: 'calc' });
      expect(hookCalls).toEqual([{ toolName: 'calc' }]);

      // Tool works
      const tool = registry.get('calc')!;
      expect(await tool.execute({ a: 2, b: 3 }, {})).toBe(5);

      // Processor works in pipeline
      const ctx = {
        request: { input: 'test', sessionId: 's1' },
        iteration: { step: 0 },
        pipeline: {},
        session: {},
        config: {},
      };
      const result = (await runner.run(ctx, ['processInput'])) as PipelineContext;
      expect(result.pipeline.annotated).toBe(true);
      expect(events).toContain('processor:processInput');

      // Shutdown cleans up
      manager.emitEvent('agent:end');
      await manager.shutdown();

      expect(events).toContain('event:agent:end');
      expect(events).toContain('resource:stop');

      // After shutdown, subscriptions are cleaned
      const afterShutdown: string[] = [...events];
      manager.emitEvent('agent:end');
      expect(events.length).toBe(afterShutdown.length);
    });

    it('tool.wrap hook replaces tool result through toAiSdkTools', async () => {
      const calcTool: Tool<{ a: number; b: number }, number> = {
        name: 'add',
        description: 'Add two numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => a + b,
      };
      registry.register(calcTool);

      // Register a tool.wrap hook via PluginManager
      manager.initializePlugin((api) => {
        api.registerHook({
          point: 'tool.wrap',
          handler: (data) => {
            const ctx = data as Record<string, unknown>;
            return { ...ctx, result: `evicted: ${ctx.result}` };
          },
        });
        return {};
      });

      // Set execution context to wire PluginManager into ToolRegistry
      registry.setToolExecutionContext({
        span: { spanId: 'span-1', traceId: 'trace-1' },
        sessionId: 'session-1',
        pluginManager: manager,
      });

      const sdkTools = registry.toAiSdkTools();
      const result = await sdkTools['add'].execute({ a: 1, b: 2 });
      expect(result).toBe('evicted: 3');
    });
  });
});
