import { describe, it, expect } from 'vitest';
import { PluginManager } from '../src/plugin-manager.js';
import { PipelineRunner } from '../src/pipeline.js';
import { ToolRegistry } from '../src/tool-registry.js';
import type { PluginFactory } from '../src/plugin-manager.js';
import type { Tool } from '@primo-ai/sdk';

function makePluginManager(): PluginManager {
  const runner = new PipelineRunner();
  const registry = new ToolRegistry();
  return new PluginManager(runner, registry);
}

describe('PluginLoader', () => {
  describe('loadPlugin from file path', () => {
    it('loads a plugin via dynamic import', async () => {
      const pm = makePluginManager();
      await pm.loadPlugin('./__tests__/fixtures/test-plugin.js');
      expect(pm.getErrors()).toHaveLength(0);
    });

    it('records error for invalid plugin', async () => {
      const pm = makePluginManager();
      await pm.loadPlugin('./nonexistent-module-xyz.js');
      expect(pm.getErrors()).toHaveLength(1);
      expect(pm.getErrors()[0].source).toContain('nonexistent-module');
    });

    it('records error for module without factory function', async () => {
      const pm = makePluginManager();
      await pm.loadPlugin('./__tests__/fixtures/non-plugin.js');
      expect(pm.getErrors()).toHaveLength(1);
      expect(pm.getErrors()[0].error.message).toContain('factory function');
    });
  });

  describe('loadPluginsFromConfig', () => {
    it('loads multiple plugins from config', async () => {
      const pm = makePluginManager();
      const config = {
        plugins: [
          { path: './__tests__/fixtures/test-plugin.js' },
        ],
      };
      await pm.loadPluginsFromConfig(config);
      expect(pm.getErrors()).toHaveLength(0);
    });

    it('continues loading after one plugin fails', async () => {
      const pm = makePluginManager();
      const config = {
        plugins: [
          { path: './nonexistent.js' },
          { path: './__tests__/fixtures/test-plugin.js' },
        ],
      };
      await pm.loadPluginsFromConfig(config);
      expect(pm.getErrors()).toHaveLength(1);
    });

    it('handles empty plugin list', async () => {
      const pm = makePluginManager();
      await pm.loadPluginsFromConfig({ plugins: [] });
      expect(pm.getErrors()).toHaveLength(0);
    });

    it('handles config with no plugins key', async () => {
      const pm = makePluginManager();
      await pm.loadPluginsFromConfig({});
      expect(pm.getErrors()).toHaveLength(0);
    });
  });

  describe('initializePlugin with factory', () => {
    it('registers processors from plugin registration', () => {
      const pm = makePluginManager();
      const factory: PluginFactory = (api) => {
        api.registerProcessor('processOutput', {
          stage: 'processOutput',
          execute: async () => {},
        });
      };
      pm.initializePlugin(factory);
      expect(pm.getErrors()).toHaveLength(0);
    });

    it('registers tools from plugin registration', () => {
      const pm = makePluginManager();
      const factory: PluginFactory = (api) => {
        api.registerTool({
          name: 'test-tool',
          description: 'A test tool',
          inputSchema: {},
          execute: async () => 'ok',
        } as unknown as Tool);
      };
      pm.initializePlugin(factory);
      expect(pm.getErrors()).toHaveLength(0);
    });
  });
});
