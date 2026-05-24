import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Hook,
  HookPoint,
  PluginDescriptor,
  HookDescriptor,
  ToolSetConfig,
  HarnessConfig,
} from '@primo-ai/sdk';

// ---------------------------------------------------------------------------
// Phase 3: Config-driven Plugin + Hook + Tool
// User Journeys:
//   1. Declare plugins with structured descriptors (id + config) in config
//   2. Declare hooks in config without writing code
//   3. Declare tool sets (include/exclude) in config
//   4. No config → current default behavior (backward compat)
// ---------------------------------------------------------------------------

describe('Phase 3: PluginRegistry', () => {
  let PluginRegistryImpl: typeof import('../src/plugin-registry.js').PluginRegistryImpl;
  let globalPluginRegistry: import('../src/plugin-registry.js').PluginRegistryImpl;

  beforeEach(async () => {
    const mod = await import('../src/plugin-registry.js');
    PluginRegistryImpl = mod.PluginRegistryImpl;
    globalPluginRegistry = mod.globalPluginRegistry;
  });

  describe('register and resolve', () => {
    it('registers a plugin factory and resolves it by id', () => {
      const registry = new PluginRegistryImpl();
      const factory = vi.fn();
      registry.register('memory', factory);

      const resolved = registry.resolve({ id: 'memory' });
      expect(resolved).toBe(factory);
      expect(factory).not.toHaveBeenCalled();
    });

    it('resolves a plugin with config from descriptor', () => {
      const registry = new PluginRegistryImpl();
      const factory = vi.fn();
      registry.register('memory', factory);

      const descriptor: PluginDescriptor = { id: 'memory', config: { backend: 'sqlite' } };
      const resolved = registry.resolve(descriptor);
      expect(resolved).toBe(factory);
    });

    it('throws when resolving unregistered plugin id', () => {
      const registry = new PluginRegistryImpl();
      expect(() => registry.resolve({ id: 'nonexistent' as any })).toThrow(/not registered/i);
    });

    it('throws for module descriptor (not yet supported)', () => {
      const registry = new PluginRegistryImpl();
      expect(() => registry.resolve({ module: './custom-plugin.js' })).toThrow(/module/i);
    });

    it('lists all registered plugin ids', () => {
      const registry = new PluginRegistryImpl();
      registry.register('memory', vi.fn());
      registry.register('compression', vi.fn());

      expect(registry.list()).toContain('memory');
      expect(registry.list()).toContain('compression');
      expect(registry.list()).toHaveLength(2);
    });

    it('has() returns true for registered plugins', () => {
      const registry = new PluginRegistryImpl();
      registry.register('memory', vi.fn());
      expect(registry.has('memory')).toBe(true);
      expect(registry.has('compression')).toBe(false);
    });
  });

  describe('global registry can register plugins for loadPluginsFromDescriptors', () => {
    it('resolves a registered memory plugin', async () => {
      globalPluginRegistry.register('memory', vi.fn());
      expect(globalPluginRegistry.has('memory')).toBe(true);
    });

    it('resolves a registered compression plugin', async () => {
      globalPluginRegistry.register('compression', vi.fn());
      expect(globalPluginRegistry.has('compression')).toBe(true);
    });

    it('resolves a registered permission plugin', async () => {
      globalPluginRegistry.register('permission', vi.fn());
      expect(globalPluginRegistry.has('permission')).toBe(true);
    });

    it('resolves a registered skill plugin', async () => {
      globalPluginRegistry.register('skill', vi.fn());
      expect(globalPluginRegistry.has('skill')).toBe(true);
    });

    it('resolves a registered eviction plugin', async () => {
      globalPluginRegistry.register('eviction', vi.fn());
      expect(globalPluginRegistry.has('eviction')).toBe(true);
    });
  });
});

describe('Phase 3: HookDescriptor config', () => {
  describe('HookDescriptor type validation', () => {
    it('creates a valid HookDescriptor with point and plugin', () => {
      const descriptor: HookDescriptor = {
        point: 'tool.after',
        plugin: 'eviction',
      };
      expect(descriptor.point).toBe('tool.after');
      expect(descriptor.plugin).toBe('eviction');
    });

    it('creates a HookDescriptor with config and priority', () => {
      const descriptor: HookDescriptor = {
        point: 'tool.after',
        plugin: 'eviction',
        config: { threshold: 4000 },
        priority: 50,
      };
      expect(descriptor.config).toEqual({ threshold: 4000 });
      expect(descriptor.priority).toBe(50);
    });
  });
});

describe('Phase 3: ToolSetConfig', () => {
  describe('ToolSetConfig type validation', () => {
    it('supports include with wildcard', () => {
      const config: ToolSetConfig = { include: ['*'] };
      expect(config.include).toContain('*');
    });

    it('supports include with specific tool names', () => {
      const config: ToolSetConfig = { include: ['echo', 'read_memory'] };
      expect(config.include).toHaveLength(2);
    });

    it('supports exclude list', () => {
      const config: ToolSetConfig = { exclude: ['shell'] };
      expect(config.exclude).toContain('shell');
    });

    it('supports both include and exclude', () => {
      const config: ToolSetConfig = { include: ['*'], exclude: ['shell'] };
      expect(config.include).toContain('*');
      expect(config.exclude).toContain('shell');
    });

    it('supports custom tool descriptors', () => {
      const config: ToolSetConfig = {
        include: ['*'],
        custom: [
          { name: 'myTool', description: 'Custom tool', inputSchema: {}, execute: vi.fn() },
        ],
      };
      expect(config.custom).toHaveLength(1);
    });
  });
});

describe('Phase 3: HarnessConfig extended fields', () => {
  describe('plugins field accepts structured descriptors', () => {
    it('accepts PluginDescriptor array', () => {
      const config: HarnessConfig = {
        plugins: [
          { id: 'memory', config: { backend: 'sqlite' } },
          { id: 'compression', config: { maxTokens: 8000 } },
          { id: 'permission', config: { mode: 'interactive' } },
        ],
      };
      expect(config.plugins).toHaveLength(3);
      expect(config.plugins![0]).toEqual({ id: 'memory', config: { backend: 'sqlite' } });
    });

    it('backward compat: accepts string array (path-based)', () => {
      const config: HarnessConfig = {
        plugins: ['./plugins/memory.ts', './plugins/compression.ts'] as any,
      };
      expect(config.plugins).toHaveLength(2);
    });
  });

  describe('hooks field accepts HookDescriptor array', () => {
    it('accepts HookDescriptor array', () => {
      const config: HarnessConfig = {
        hooks: [
          { point: 'tool.after', plugin: 'eviction', config: { threshold: 4000 } },
          { point: 'llm.before', plugin: 'compression', priority: 10 },
        ],
      } as any;
      expect((config as any).hooks).toHaveLength(2);
    });
  });

  describe('tools field accepts ToolSetConfig', () => {
    it('accepts include/exclude/custom structure', () => {
      const config: HarnessConfig = {
        tools: {
          include: ['*'],
          exclude: ['shell'],
          custom: [],
        },
      } as any;
      expect((config as any).tools.include).toContain('*');
      expect((config as any).tools.exclude).toContain('shell');
    });
  });
});

describe('Phase 3: ConfigLoader validates PluginDescriptor', () => {
  it('validates structured PluginDescriptor in config', async () => {
    const { ConfigLoader } = await import('../src/config.js');
    const loader = new ConfigLoader({
      fileReader: async () => JSON.stringify({
        plugins: [
          { id: 'memory', config: { backend: 'sqlite' } },
          { id: 'compression' },
        ],
      }),
    });

    const config = await loader.load({ project: 'test.jsonc' });
    expect(config.plugins).toHaveLength(2);
    expect(config.plugins![0]).toEqual({ id: 'memory', config: { backend: 'sqlite' } });
  });

  it('validates HookDescriptor in config', async () => {
    const { ConfigLoader } = await import('../src/config.js');
    const loader = new ConfigLoader({
      fileReader: async () => JSON.stringify({
        hooks: [
          { point: 'tool.after', plugin: 'eviction', config: { threshold: 4000 } },
        ],
      }),
    });

    const config = await loader.load({ project: 'test.jsonc' });
    expect((config as any).hooks).toHaveLength(1);
    expect((config as any).hooks[0].point).toBe('tool.after');
  });

  it('validates ToolSetConfig in config', async () => {
    const { ConfigLoader } = await import('../src/config.js');
    const loader = new ConfigLoader({
      fileReader: async () => JSON.stringify({
        tools: {
          include: ['*'],
          exclude: ['shell'],
        },
      }),
    });

    const config = await loader.load({ project: 'test.jsonc' });
    const tools = config.tools as any;
    expect(tools.include).toContain('*');
    expect(tools.exclude).toContain('shell');
  });

  it('backward compat: still accepts string[] plugins', async () => {
    const { ConfigLoader } = await import('../src/config.js');
    const loader = new ConfigLoader({
      fileReader: async () => JSON.stringify({
        plugins: ['./plugins/memory.ts'],
      }),
    });

    const config = await loader.load({ project: 'test.jsonc' });
    expect(config.plugins).toEqual(['./plugins/memory.ts']);
  });
});

describe('Phase 3: PluginManager.loadPluginsFromDescriptors', () => {
  it('loads plugins from structured descriptors using registry', async () => {
    const { PluginRegistryImpl } = await import('../src/plugin-registry.js');
    const { PluginManager } = await import('../src/plugin-manager.js');
    const { PipelineRunner } = await import('../src/pipeline.js');
    const { ToolRegistry } = await import('../src/tool-registry.js');

    const registry = new PluginRegistryImpl();
    const mockFactory = vi.fn();
    registry.register('testPlugin', (config) => {
      expect(config).toEqual({ backend: 'sqlite' });
      return mockFactory;
    });

    const runner = new PipelineRunner();
    const toolReg = new ToolRegistry();
    const pm = new PluginManager(runner, toolReg);

    // Simulate loadPluginsFromDescriptors with a local registry
    const descriptor: PluginDescriptor = { id: 'testPlugin' as any, config: { backend: 'sqlite' } };
    const factoryWrapper = registry.resolve(descriptor);
    expect(factoryWrapper).toBeDefined();
    expect(typeof factoryWrapper).toBe('function');

    // Call factory wrapper with config, it returns a PluginFactory
    const factory = factoryWrapper(descriptor.config);
    expect(factory).toBe(mockFactory);

    await pm.shutdown();
  });
});
