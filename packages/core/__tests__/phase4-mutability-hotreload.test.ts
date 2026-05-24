import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MutabilityLevel, MutabilityPolicy, HarnessConfig, StageMutation } from '@primo-ai/sdk';
import { ConfigLoader } from '../src/config.js';
import { MutabilityPolicyEngine } from '../src/mutability-policy.js';
import { ConfigWatcher } from '../src/config-watcher.js';
import { Agent } from '../src/agent.js';
import { PipelineRunner } from '../src/pipeline.js';
import { ToolRegistry } from '../src/tool-registry.js';
import { PluginManager } from '../src/plugin-manager.js';
import { LoopOrchestrator } from '../src/loop-orchestrator.js';
import { EventBus } from '../src/event-bus.js';
import { HarnessAPIImpl, type HarnessDeps } from '../src/harness.js';
import { StateMachine } from '../src/state-machine.js';

// ---------------------------------------------------------------------------
// Phase 4: Runtime Mutability + Hot Reload
// User Journeys:
//   J1: Configure mutability levels for pipeline/processors/plugins/tools
//   J2: frozen level = immutable after agent starts (current default)
//   J3: configOnly = change via config file + hot reload
//   J4: dynamic = change via API at any time
//   J5: ConfigWatcher detects file changes, triggers hot reload
//   J6: Agent.reload() for programmatic config reload
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// J1 + J2 + J3 + J4: MutabilityPolicy type + validation
// ---------------------------------------------------------------------------

describe('Phase 4: MutabilityPolicy types and ConfigLoader', () => {
  const loader = new ConfigLoader();

  describe('ConfigLoader validates mutability field', () => {
    it('accepts a valid mutability policy with all levels', async () => {
      const config = await loader.load({
        session: {
          mutability: {
            pipeline: 'frozen',
            processors: 'configOnly',
            plugins: 'dynamic',
            tools: 'dynamic',
            hotReload: true,
            watchConfig: true,
          },
        } as any,
      });
      expect(config.mutability).toBeDefined();
      expect((config.mutability as any).pipeline).toBe('frozen');
      expect((config.mutability as any).processors).toBe('configOnly');
      expect((config.mutability as any).plugins).toBe('dynamic');
      expect((config.mutability as any).tools).toBe('dynamic');
      expect((config.mutability as any).hotReload).toBe(true);
      expect((config.mutability as any).watchConfig).toBe(true);
    });

    it('accepts partial mutability policy', async () => {
      const config = await loader.load({
        session: {
          mutability: {
            plugins: 'dynamic',
          },
        } as any,
      });
      expect(config.mutability).toBeDefined();
      expect((config.mutability as any).plugins).toBe('dynamic');
    });

    it('accepts mutability as a string shorthand', async () => {
      const config = await loader.load({
        session: {
          mutability: 'configOnly',
        } as any,
      });
      expect(config.mutability).toBeDefined();
    });

    it('rejects invalid mutability level values', async () => {
      await expect(loader.load({
        session: {
          mutability: { pipeline: 'invalid' },
        } as any,
      })).rejects.toThrow();
    });

    it('defaults to undefined when mutability not specified', async () => {
      const config = await loader.load({ session: {} });
      expect(config.mutability).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// MutabilityPolicyEngine
// ---------------------------------------------------------------------------

describe('MutabilityPolicyEngine', () => {
  const defaultPolicy: MutabilityPolicy = {
    pipeline: 'frozen',
    processors: 'frozen',
    plugins: 'frozen',
    tools: 'frozen',
    hotReload: false,
    watchConfig: false,
  };

  describe('construction and defaults', () => {
    it('creates engine with explicit policy', () => {
      const engine = new MutabilityPolicyEngine(defaultPolicy);
      expect(engine.policy).toEqual(defaultPolicy);
    });

    it('creates engine with default all-frozen policy', () => {
      const engine = new MutabilityPolicyEngine();
      expect(engine.policy.pipeline).toBe('frozen');
      expect(engine.policy.processors).toBe('frozen');
      expect(engine.policy.plugins).toBe('frozen');
      expect(engine.policy.tools).toBe('frozen');
      expect(engine.policy.hotReload).toBe(false);
      expect(engine.policy.watchConfig).toBe(false);
    });

    it('creates engine from string shorthand', () => {
      const engine = new MutabilityPolicyEngine('configOnly');
      expect(engine.policy.pipeline).toBe('configOnly');
      expect(engine.policy.processors).toBe('configOnly');
      expect(engine.policy.plugins).toBe('configOnly');
      expect(engine.policy.tools).toBe('configOnly');
    });
  });

  describe('isMutable()', () => {
    it('returns false for frozen level regardless of state', () => {
      const engine = new MutabilityPolicyEngine(defaultPolicy);
      expect(engine.isMutable('pipeline')).toBe(false);
      expect(engine.isMutable('pipeline', 'pending')).toBe(false);
      expect(engine.isMutable('pipeline', 'completed')).toBe(false);
    });

    it('returns true for dynamic level regardless of state', () => {
      const policy: MutabilityPolicy = { ...defaultPolicy, pipeline: 'dynamic' };
      const engine = new MutabilityPolicyEngine(policy);
      expect(engine.isMutable('pipeline')).toBe(true);
      expect(engine.isMutable('pipeline', 'pending')).toBe(true);
      expect(engine.isMutable('pipeline', 'running')).toBe(true);
      expect(engine.isMutable('pipeline', 'completed')).toBe(true);
    });

    it('returns true for configOnly when state allows', () => {
      const policy: MutabilityPolicy = { ...defaultPolicy, processors: 'configOnly' };
      const engine = new MutabilityPolicyEngine(policy);
      expect(engine.isMutable('processors', 'pending')).toBe(true);
      expect(engine.isMutable('processors', 'completed')).toBe(true);
      expect(engine.isMutable('processors', 'running')).toBe(true);
    });

    it('covers all four domains', () => {
      const policy: MutabilityPolicy = {
        pipeline: 'frozen',
        processors: 'configOnly',
        plugins: 'dynamic',
        tools: 'dynamic',
        hotReload: false,
        watchConfig: false,
      };
      const engine = new MutabilityPolicyEngine(policy);
      expect(engine.isMutable('pipeline')).toBe(false);
      expect(engine.isMutable('processors')).toBe(true);
      expect(engine.isMutable('plugins')).toBe(true);
      expect(engine.isMutable('tools')).toBe(true);
    });
  });

  describe('canApplyDirectly()', () => {
    it('returns false for frozen and configOnly', () => {
      const engine = new MutabilityPolicyEngine(defaultPolicy);
      expect(engine.canApplyDirectly('pipeline')).toBe(false);

      const policy: MutabilityPolicy = { ...defaultPolicy, pipeline: 'configOnly' };
      const engine2 = new MutabilityPolicyEngine(policy);
      expect(engine2.canApplyDirectly('pipeline')).toBe(false);
    });

    it('returns true for dynamic', () => {
      const policy: MutabilityPolicy = { ...defaultPolicy, plugins: 'dynamic' };
      const engine = new MutabilityPolicyEngine(policy);
      expect(engine.canApplyDirectly('plugins')).toBe(true);
    });
  });

  describe('canApplyViaReload()', () => {
    it('returns false for frozen', () => {
      const engine = new MutabilityPolicyEngine(defaultPolicy);
      expect(engine.canApplyViaReload('pipeline')).toBe(false);
    });

    it('returns true for configOnly and dynamic', () => {
      const policy: MutabilityPolicy = { ...defaultPolicy, pipeline: 'configOnly', plugins: 'dynamic' };
      const engine = new MutabilityPolicyEngine(policy);
      expect(engine.canApplyViaReload('pipeline')).toBe(true);
      expect(engine.canApplyViaReload('plugins')).toBe(true);
    });
  });

  describe('updatePolicy()', () => {
    it('allows updating individual policy fields', () => {
      const engine = new MutabilityPolicyEngine(defaultPolicy);
      engine.updatePolicy({ plugins: 'dynamic', hotReload: true });
      expect(engine.policy.plugins).toBe('dynamic');
      expect(engine.policy.hotReload).toBe(true);
      expect(engine.policy.pipeline).toBe('frozen');
    });

    it('emits policy:updated event on change', () => {
      const engine = new MutabilityPolicyEngine(defaultPolicy);
      const listener = vi.fn();
      engine.onPolicyChange(listener);
      engine.updatePolicy({ plugins: 'dynamic' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ plugins: 'dynamic' }));
    });
  });
});

// ---------------------------------------------------------------------------
// Harness.freeze() controlled by MutabilityPolicy
// ---------------------------------------------------------------------------

describe('Harness freeze respects MutabilityPolicy', () => {
  function createHarnessDeps(): HarnessDeps {
    const eventBus = new EventBus();
    return {
      runner: new PipelineRunner(),
      registry: new ToolRegistry(),
      hookManager: { register: vi.fn(), invoke: vi.fn().mockResolvedValue(undefined) } as any,
      eventSystem: { bus: eventBus, replay: vi.fn() } as any,
      eventBus,
      emitEvent: vi.fn(),
      registerProvider: vi.fn(),
      mutateStages: vi.fn(),
    };
  }

  it('frozen policy: freeze blocks stage mutations', () => {
    const deps = createHarnessDeps();
    const harness = new HarnessAPIImpl(deps);
    harness.setMutabilityPolicy(new MutabilityPolicyEngine());
    harness.freeze();
    expect(() => harness.insertStage('loop', 'invokeLLM', 'customStage')).toThrow();
  });

  it('dynamic policy: freeze does not block stage mutations', () => {
    const deps = createHarnessDeps();
    const harness = new HarnessAPIImpl(deps);
    const policy = new MutabilityPolicyEngine({
      pipeline: 'dynamic',
      processors: 'dynamic',
      plugins: 'dynamic',
      tools: 'dynamic',
      hotReload: false,
      watchConfig: false,
    });
    harness.setMutabilityPolicy(policy);
    harness.freeze();
    expect(() => harness.insertStage('loop', 'invokeLLM', 'customStage')).not.toThrow();
  });

  it('configOnly policy: freeze blocks direct mutations', () => {
    const deps = createHarnessDeps();
    const harness = new HarnessAPIImpl(deps);
    const policy = new MutabilityPolicyEngine({
      pipeline: 'configOnly',
      processors: 'configOnly',
      plugins: 'configOnly',
      tools: 'configOnly',
      hotReload: true,
      watchConfig: false,
    });
    harness.setMutabilityPolicy(policy);
    harness.freeze();
    expect(() => harness.insertStage('loop', 'invokeLLM', 'customStage')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ConfigWatcher
// ---------------------------------------------------------------------------

describe('ConfigWatcher', () => {
  it('constructs with file path and options', () => {
    const watcher = new ConfigWatcher({
      configPath: '/tmp/test-config.jsonc',
      debounceMs: 100,
    });
    expect(watcher).toBeDefined();
    expect(watcher.isWatching).toBe(false);
  });

  it('starts watching and stops cleanly', () => {
    const watcher = new ConfigWatcher({
      configPath: '/tmp/test-config.jsonc',
      debounceMs: 100,
    });
    watcher.start();
    expect(watcher.isWatching).toBe(true);
    watcher.stop();
    expect(watcher.isWatching).toBe(false);
  });

  it('emits config:changed when file changes', async () => {
    const onChange = vi.fn();
    const watcher = new ConfigWatcher({
      configPath: '/tmp/test-config.jsonc',
      debounceMs: 50,
      fileReader: vi.fn().mockResolvedValue('{"pipeline":{"loop":["invokeLLM"]}}'),
    });
    watcher.onConfigChange(onChange);
    await watcher.simulateChange(true);
    expect(onChange).toHaveBeenCalled();
  });

  it('debounces rapid file changes', async () => {
    const onChange = vi.fn();
    const watcher = new ConfigWatcher({
      configPath: '/tmp/test-config.jsonc',
      debounceMs: 100,
      fileReader: vi.fn().mockResolvedValue('{"plugins":[]}'),
    });
    watcher.onConfigChange(onChange);
    // Use debounced mode (no immediate)
    watcher.simulateChange();
    watcher.simulateChange();
    watcher.simulateChange();
    await new Promise((r) => setTimeout(r, 200));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not start when watchConfig is false in policy', () => {
    const policy = new MutabilityPolicyEngine({
      pipeline: 'frozen',
      processors: 'frozen',
      plugins: 'frozen',
      tools: 'frozen',
      hotReload: false,
      watchConfig: false,
    });
    const watcher = new ConfigWatcher({
      configPath: '/tmp/test-config.jsonc',
      debounceMs: 100,
      policy,
    });
    watcher.start();
    expect(watcher.isWatching).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Agent.reload()
// ---------------------------------------------------------------------------

describe('Agent.reload() with MutabilityPolicy', () => {
  it('Agent has reload method', () => {
    const agent = new Agent({ model: 'test-model' });
    expect(typeof agent.reload).toBe('function');
  });

  it('reload rejects frozen changes', () => {
    const agent = new Agent({ model: 'test-model' });
    const result = agent.reload({
      pipeline: {
        loop: ['prepareStep', 'invokeLLM', 'customStage', 'evaluateIteration'],
      },
    });
    expect(result.applied).toBe(false);
    expect(result.rejectedKeys).toContain('pipeline');
  });

  it('reload applies configOnly changes', () => {
    const policy: MutabilityPolicy = {
      pipeline: 'configOnly',
      processors: 'configOnly',
      plugins: 'dynamic',
      tools: 'dynamic',
      hotReload: true,
      watchConfig: false,
    };
    const agent = new Agent(
      { model: 'test-model' },
      { mutabilityPolicy: policy },
    );
    const result = agent.reload({
      pipeline: {
        loop: ['prepareStep', 'invokeLLM', 'evaluateIteration'],
      },
    });
    expect(result.applied).toBe(true);
  });

  it('reload emits config:reload:applied on success', () => {
    const policy: MutabilityPolicy = {
      pipeline: 'configOnly',
      processors: 'configOnly',
      plugins: 'dynamic',
      tools: 'dynamic',
      hotReload: true,
      watchConfig: false,
    };
    const agent = new Agent(
      { model: 'test-model' },
      { mutabilityPolicy: policy },
    );
    const listener = vi.fn();
    agent.on('config:reload:applied', listener);
    agent.reload({
      pipeline: { loop: ['prepareStep', 'invokeLLM', 'evaluateIteration'] },
    });
    expect(listener).toHaveBeenCalled();
  });

  it('reload emits config:reload:rejected on frozen changes', () => {
    const agent = new Agent({ model: 'test-model' });
    const listener = vi.fn();
    agent.on('config:reload:rejected', listener);
    agent.reload({
      pipeline: { loop: ['prepareStep', 'invokeLLM', 'evaluateIteration'] },
    });
    expect(listener).toHaveBeenCalled();
  });
});
