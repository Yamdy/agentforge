import { describe, it, expect, beforeEach } from 'vitest';
import { PluginManager } from '../src/plugin-manager.js';
import { PipelineRunner } from '../src/pipeline.js';
import { ToolRegistry } from '../src/tool-registry.js';
import type { HarnessAPI, PluginRegistration } from '@primo-ai/sdk';
import path from 'node:path';

describe('PluginManager error visibility', () => {
  let runner: PipelineRunner;
  let registry: ToolRegistry;
  let manager: PluginManager;

  beforeEach(() => {
    runner = new PipelineRunner();
    registry = new ToolRegistry();
    manager = new PluginManager(runner, registry);
  });

  describe('loadPlugin', () => {
    it('emits plugin:load_error event on load failure', async () => {
      const events: Array<{ source: string; error: Error }> = [];
      const unsub = manager.eventBus.subscribe('plugin:load_error', (data) => {
        events.push(data as { source: string; error: Error });
      });

      const badPath = path.resolve(__dirname, 'fixtures/nonexistent-plugin.ts');
      await manager.loadPlugin(badPath);

      unsub();
      expect(events).toHaveLength(1);
      expect(events[0].source).toBe(badPath);
      expect(events[0].error).toBeInstanceOf(Error);
    });

    it('adds to errors array on load failure', async () => {
      const badPath = path.resolve(__dirname, 'fixtures/nonexistent-plugin.ts');
      await manager.loadPlugin(badPath);

      const errors = manager.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].source).toBe(badPath);
      expect(errors[0].error).toBeInstanceOf(Error);
    });
  });

  describe('initializeAll', () => {
    it('throws AggregateError when resources fail to start', async () => {
      manager.initializePlugin((api: HarnessAPI): PluginRegistration => {
        api.registerResource({
          id: 'failing-resource',
          type: 'test',
          config: {},
          start: async () => { throw new Error('resource start failed'); },
          stop: async () => {},
        });
        return {};
      });

      let thrown: unknown;
      try {
        await manager.initializeAll();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(AggregateError);
      const aggregate = thrown as AggregateError;
      expect(aggregate.errors).toHaveLength(1);
      expect(aggregate.errors[0].message).toBe('resource start failed');
    });

    it('emits plugin:resource_init_error for each failed resource', async () => {
      const events: Array<{ source: string; error: Error }> = [];
      const unsub = manager.eventBus.subscribe('plugin:resource_init_error', (data) => {
        events.push(data as { source: string; error: Error });
      });

      manager.initializePlugin((api: HarnessAPI): PluginRegistration => {
        api.registerResource({
          id: 'fail-a',
          type: 'test',
          config: {},
          start: async () => { throw new Error('boom a'); },
          stop: async () => {},
        });
        api.registerResource({
          id: 'fail-b',
          type: 'test',
          config: {},
          start: async () => { throw new Error('boom b'); },
          stop: async () => {},
        });
        return {};
      });

      // Suppress AggregateError in test — we only care about events
      try { await manager.initializeAll(); } catch { /* expected */ }

      unsub();
      expect(events).toHaveLength(2);
      expect(events[0].source).toBe('resource:fail-a');
      expect(events[1].source).toBe('resource:fail-b');
    });
  });

  describe('shutdown', () => {
    it('emits plugin:shutdown_error for each failed resource stop', async () => {
      const initEvents: Array<{ source: string; error: Error }> = [];
      const shutdownEvents: Array<{ source: string; error: Error }> = [];
      manager.eventBus.subscribe('plugin:resource_init_error', (data) => {
        initEvents.push(data as { source: string; error: Error });
      });
      const unsubShutdown = manager.eventBus.subscribe('plugin:shutdown_error', (data) => {
        shutdownEvents.push(data as { source: string; error: Error });
      });

      manager.initializePlugin((api: HarnessAPI): PluginRegistration => {
        api.registerResource({
          id: 'bad-stop',
          type: 'test',
          config: {},
          start: async () => ({ ok: true }),
          stop: async () => { throw new Error('stop failed'); },
        });
        return {};
      });

      // Suppress AggregateError from initializeAll
      try { await manager.initializeAll(); } catch { /* expected */ }

      await manager.shutdown();

      unsubShutdown();
      expect(shutdownEvents).toHaveLength(1);
      expect(shutdownEvents[0].source).toBe('resource:bad-stop');
      expect(shutdownEvents[0].error.message).toBe('stop failed');
    });
  });
});
