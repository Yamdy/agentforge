import { describe, it, expect, beforeEach } from 'vitest';
import type { Processor, ProcessorContext, PipelineContext, StageName } from '@primo-ai/sdk';
import { ProcessorRegistryImpl } from '../src/processor-registry.js';

// Import processors to trigger registration with globalProcessorRegistry
import '../src/processors/index.js';

// ---------------------------------------------------------------------------
// Phase 1b: Processor Registry
// User Journey: As a framework user, I want processors to be discoverable via
// a registry, so that I can replace or extend processors without modifying
// hardcoded registration.
// ---------------------------------------------------------------------------

function makeProcessor(stage: StageName): Processor {
  return {
    stage,
    execute: async (ctx: ProcessorContext) => ctx.state,
  };
}

function makeContext(): ProcessorContext {
  return {
    state: {
      agent: { config: { model: 'test' }, toolDeclarations: [], promptFragments: [] },
      iteration: { step: 1 },
      session: { input: '', sessionId: 'test', custom: {} },
    } as PipelineContext,
    control: {
      abort: () => { throw new Error('abort'); },
      suspend: () => { throw new Error('suspend'); },
      error: () => { throw new Error('error'); },
    },
  };
}

describe('Phase 1b: ProcessorRegistry', () => {
  let registry: ProcessorRegistryImpl;

  beforeEach(() => {
    registry = new ProcessorRegistryImpl();
  });

  describe('register and resolve', () => {
    it('registers a processor factory and resolves it by builtin name', () => {
      const proc = makeProcessor('processInput');
      registry.register('processInput', () => proc);

      const resolved = registry.resolve({ builtin: 'processInput' });
      expect(resolved.stage).toBe('processInput');
    });

    it('resolves a builtin processor with deps passed to factory', () => {
      let receivedDeps: any = null;
      registry.register('invokeLLM', (deps) => {
        receivedDeps = deps;
        return makeProcessor('invokeLLM');
      });

      const deps = { modelString: 'test-model' };
      registry.resolve({ builtin: 'invokeLLM' }, deps);
      expect(receivedDeps).toEqual(deps);
    });

    it('throws when resolving unregistered builtin', () => {
      expect(() => registry.resolve({ builtin: 'unknownProcessor' as any })).toThrow(/not registered/);
    });

    it('lists all registered processor names', () => {
      registry.register('processInput', () => makeProcessor('processInput'));
      registry.register('invokeLLM', () => makeProcessor('invokeLLM'));

      expect(registry.list()).toContain('processInput');
      expect(registry.list()).toContain('invokeLLM');
      expect(registry.list()).toHaveLength(2);
    });

    it('has() returns true for registered processors', () => {
      registry.register('processInput', () => makeProcessor('processInput'));
      expect(registry.has('processInput')).toBe(true);
      expect(registry.has('invokeLLM')).toBe(false);
    });
  });

  describe('resolve with module descriptor', () => {
    it('throws descriptive error for module descriptor (not yet supported)', () => {
      expect(() => registry.resolve({ module: './custom-processor.js' })).toThrow(/module/i);
    });
  });

  describe('global registry has built-in processors', () => {
    it('globalProcessorRegistry has all 10 built-in processor names', async () => {
      const { globalProcessorRegistry } = await import('../src/processor-registry.js');
      const names = globalProcessorRegistry.list();

      const expected = [
        'processInput', 'buildContext', 'prepareStep', 'gateLLM',
        'invokeLLM', 'processStepOutput', 'gateTool',
        'executeTools', 'evaluateIteration', 'processOutput',
      ];

      for (const name of expected) {
        expect(names).toContain(name);
      }
    });

    it('global registry resolves each built-in processor', async () => {
      const { globalProcessorRegistry } = await import('../src/processor-registry.js');

      const names = globalProcessorRegistry.list();
      for (const name of names) {
        const proc = globalProcessorRegistry.resolve({ builtin: name as any });
        expect(proc).toBeDefined();
        expect(proc.stage).toBe(name);
      }
    });
  });

  describe('Agent uses ProcessorRegistry for registration', () => {
    it('Agent.registerBuiltinProcessors() resolves from globalProcessorRegistry', async () => {
      // Create an Agent and verify it has processors registered via the registry path
      const { Agent } = await import('../src/agent.js');

      const agent = new Agent({ model: 'test-model' });

      // Check that the pipelineRunner has processors for all default stages
      const processors = (agent.pipelineRunner as any).processors;
      const stages = processors.map((p: Processor) => p.stage);

      // All default stages should be registered
      expect(stages).toContain('processInput');
      expect(stages).toContain('buildContext');
      expect(stages).toContain('invokeLLM');
      expect(stages).toContain('evaluateIteration');
      expect(stages).toContain('processOutput');

      await agent.teardown();
    });
  });
});
