import { describe, it, expect, vi } from 'vitest';
import type { ProcessorDescriptor, HarnessConfig, Processor } from '@primo-ai/sdk';
import { ConfigLoader } from '../src/config.js';
import { globalProcessorRegistry } from '../src/processor-registry.js';

// ---------------------------------------------------------------------------
// Phase 2: 配置接管 Processor
// User Journey: As a framework user, I want to declare which Processor to use
// for each pipeline stage in config, so that I can customize processor
// selection without writing code.
// ---------------------------------------------------------------------------

describe('Phase 2: Processor configuration in HarnessConfig', () => {
  const loader = new ConfigLoader();

  describe('ConfigLoader validates processors field', () => {
    it('accepts a valid processors config with builtin descriptors', async () => {
      const config = await loader.load({
        session: {
          processors: {
            processInput: { builtin: 'processInput' },
            invokeLLM: { builtin: 'invokeLLM' },
          },
        } as any,
      });
      expect(config.processors).toBeDefined();
      expect((config.processors as any).processInput).toEqual({ builtin: 'processInput' });
      expect((config.processors as any).invokeLLM).toEqual({ builtin: 'invokeLLM' });
    });

    it('accepts processors config with module descriptors', async () => {
      const config = await loader.load({
        session: {
          processors: {
            invokeLLM: { module: './my-processor.ts', export: 'myInvokeLLM' },
          },
        } as any,
      });
      expect(config.processors).toBeDefined();
      expect((config.processors as any).invokeLLM).toEqual({
        module: './my-processor.ts',
        export: 'myInvokeLLM',
      });
    });

    it('accepts processors config with module descriptor and config', async () => {
      const config = await loader.load({
        session: {
          processors: {
            invokeLLM: { module: './custom.ts', config: { temperature: 0.7 } },
          },
        } as any,
      });
      expect((config.processors as any).invokeLLM.config).toEqual({ temperature: 0.7 });
    });

    it('rejects processors config with invalid descriptor (neither builtin nor module)', async () => {
      await expect(loader.load({
        session: {
          processors: {
            invokeLLM: { unknown: 'value' },
          },
        } as any,
      })).rejects.toThrow(/Invalid config/);
    });
  });

  describe('Agent auto-wires HarnessConfig.processors', () => {
    it('Agent reads processors from harnessConfig and uses them for processor selection', async () => {
      vi.setConfig({ testTimeout: 15000 });
      const { Agent } = await import('../src/agent.js');

      // Register a custom processor that we can detect
      const customExecute = vi.fn(async (ctx) => ctx.state);
      globalProcessorRegistry.register('customGateLLM', () => ({
        stage: 'gateLLM' as any,
        execute: customExecute,
      }));

      const agent = new Agent(
        { model: 'test-model' } as any,
        {
          harnessConfig: {
            processors: {
              gateLLM: { builtin: 'customGateLLM' },
            },
          },
        } as any,
      );

      // The custom processor should be in the pipeline, not the default no-op
      const gateProcessor = (agent.pipelineRunner as any).processors
        .find((p: any) => p.stage === 'gateLLM');
      expect(gateProcessor).toBeDefined();
      expect(gateProcessor.execute).toBe(customExecute);
      await agent.teardown();
    });

    it('harnessConfig.processors merges with defaults for unspecified stages', async () => {
      const { Agent } = await import('../src/agent.js');

      // Only override gateLLM, others should use default descriptors
      const agent = new Agent(
        { model: 'test-model' } as any,
        {
          harnessConfig: {
            processors: {
              gateLLM: { builtin: 'gateLLM' },
            },
          },
        } as any,
      );

      const stages = (agent.pipelineRunner as any).processors.map((p: any) => p.stage);
      expect(stages).toContain('processInput');
      expect(stages).toContain('gateLLM');
      expect(stages).toContain('processOutput');
      await agent.teardown();
    });

    it('processorDescriptors takes precedence over harnessConfig.processors', async () => {
      const { Agent } = await import('../src/agent.js');

      // Register two custom processors to distinguish the paths
      const customForDescriptors = vi.fn(async (ctx) => ctx.state);
      const customForHarness = vi.fn(async (ctx) => ctx.state);

      globalProcessorRegistry.register('customForDescriptors', () => ({
        stage: 'gateLLM' as any,
        execute: customForDescriptors,
      }));
      globalProcessorRegistry.register('customForHarness', () => ({
        stage: 'gateLLM' as any,
        execute: customForHarness,
      }));

      const agent = new Agent(
        { model: 'test-model' } as any,
        {
          processorDescriptors: {
            gateLLM: { builtin: 'customForDescriptors' },
          },
          harnessConfig: {
            processors: {
              gateLLM: { builtin: 'customForHarness' },
            },
          },
        } as any,
      );

      // processorDescriptors should win
      const gateProcessor = (agent.pipelineRunner as any).processors
        .find((p: any) => p.stage === 'gateLLM');
      expect(gateProcessor.execute).toBe(customForDescriptors);
      await agent.teardown();
    });

    it('without harnessConfig, agent uses default processor descriptors', async () => {
      const { Agent } = await import('../src/agent.js');

      const agent = new Agent({ model: 'test-model' });
      const stages = (agent.pipelineRunner as any).processors.map((p: any) => p.stage);
      expect(stages).toContain('processInput');
      expect(stages).toContain('invokeLLM');
      expect(stages).toContain('processOutput');
      await agent.teardown();
    });
  });

  describe('Config-to-Agent end-to-end', () => {
    it('HarnessConfig.processors loaded from config flows into Agent', async () => {
      const { Agent } = await import('../src/agent.js');

      const config = await loader.load({
        session: {
          processors: {
            invokeLLM: { builtin: 'invokeLLM' },
            evaluateIteration: { builtin: 'evaluateIteration' },
          },
        } as any,
      });

      const agent = new Agent(
        { model: 'test-model' },
        { processorDescriptors: config.processors as Record<string, ProcessorDescriptor> },
      );
      const stages = (agent.pipelineRunner as any).processors.map((p: any) => p.stage);
      expect(stages).toContain('invokeLLM');
      await agent.teardown();
    });

    it('empty processors config results in default behavior', async () => {
      const { Agent } = await import('../src/agent.js');

      const config = await loader.load({ session: {} });
      expect(config.processors).toBeUndefined();

      const agent = new Agent(
        { model: 'test-model' },
        { processorDescriptors: config.processors as Record<string, ProcessorDescriptor> | undefined },
      );
      const stages = (agent.pipelineRunner as any).processors.map((p: any) => p.stage);
      expect(stages).toContain('processInput');
      expect(stages).toContain('processOutput');
      await agent.teardown();
    });
  });
});
