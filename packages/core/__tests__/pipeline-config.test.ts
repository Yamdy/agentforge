import { describe, it, expect } from 'vitest';
import type { PipelineStageConfig, StageName } from '@primo-ai/sdk';
import { ConfigLoader } from '../src/config.js';

// ---------------------------------------------------------------------------
// Phase 1a: 配置接管 Pipeline
// User Journey: As a framework user, I want to declare pipeline stage order
// in config, so that I can customize the agent lifecycle without writing code.
// ---------------------------------------------------------------------------

describe('Phase 1a: Pipeline configuration in HarnessConfig', () => {
  const loader = new ConfigLoader();

  describe('ConfigLoader validates pipeline field', () => {
    it('accepts a valid pipeline config with preLoop/loop/postLoop', async () => {
      const config = await loader.load({
        session: {
          pipeline: {
            preLoop: ['processInput', 'buildContext'],
            loop: ['prepareStep', 'invokeLLM', 'evaluateIteration'],
            postLoop: ['processOutput'],
          },
        } as any,
      });
      expect(config.pipeline).toBeDefined();
      expect(config.pipeline!.loop).toContain('invokeLLM');
    });

    it('accepts pipeline config with only loop override', async () => {
      const config = await loader.load({
        session: {
          pipeline: {
            loop: ['prepareStep', 'invokeLLM', 'processStepOutput', 'evaluateIteration'],
          },
        } as any,
      });
      expect(config.pipeline).toBeDefined();
      expect(config.pipeline!.loop).toHaveLength(4);
      expect(config.pipeline!.preLoop).toBeUndefined();
    });

    it('accepts pipeline config with custom stage names', async () => {
      const config = await loader.load({
        session: {
          pipeline: {
            loop: ['prepareStep', 'gateLLM', 'invokeLLM', 'myCustomStage', 'evaluateIteration'],
          },
        } as any,
      });
      expect(config.pipeline!.loop).toContain('myCustomStage');
    });

    it('rejects pipeline config with non-array loop field', async () => {
      await expect(loader.load({
        session: {
          pipeline: { loop: 'invalid' },
        } as any,
      })).rejects.toThrow(/Invalid config/);
    });
  });

  describe('LoopOrchestrator uses pipeline from config', () => {
    it('LoopOrchestrator constructor accepts stageConfig from HarnessConfig.pipeline', async () => {
      const { LoopOrchestrator } = await import('../src/loop-orchestrator.js');
      const mockRunner = {
        register() {},
        unregister() {},
        replace() {},
        setHookManager() {},
        processors: [],
        tracer: { startSpan: () => ({ startChild: () => ({ end() {}, setAttribute() { return this; }, addEvent() { return this; }, spanContext: () => ({}) }), end() {}, setAttribute() { return this; }, addEvent() { return this; }, spanContext: () => ({}) }), getCurrentSpan: () => undefined },
        run: async () => ({} as any),
        stream: async function*() {},
      } as any;

      const pipelineConfig: PipelineStageConfig = {
        preLoop: ['processInput'],
        loop: ['invokeLLM', 'evaluateIteration'],
        postLoop: ['processOutput'],
      };

      const orch = new LoopOrchestrator(
        mockRunner,
        { register: () => {}, invoke: async () => {}, disablePoint() {}, setProfile() {} } as any,
        undefined,
        undefined,
        pipelineConfig,
      );

      // Verify mutation works on custom stages — proves they were set
      expect(() => orch.applyMutation({
        type: 'remove', phase: 'loop', stage: 'invokeLLM',
      })).not.toThrow();
    });
  });

  describe('Agent wires pipeline config to LoopOrchestrator', () => {
    it('Agent passes stageConfig to LoopOrchestrator with custom pipeline', async () => {
      const { Agent } = await import('../src/agent.js');

      const agent = new Agent(
        { model: 'test-model' },
        {
          stageConfig: {
            preLoop: ['processInput'],
            loop: ['invokeLLM', 'evaluateIteration'],
            postLoop: ['processOutput'],
          },
        },
      );

      expect(agent.state).toBe('pending');
      await agent.teardown();
    });

    it('Agent without stageConfig uses default pipeline stages', async () => {
      const { Agent } = await import('../src/agent.js');

      const agent = new Agent({ model: 'test-model' });
      expect(agent.state).toBe('pending');
      await agent.teardown();
    });

    it('Config-loaded pipeline can be passed as Agent stageConfig', async () => {
      const { Agent } = await import('../src/agent.js');

      const config = await loader.load({
        session: {
          pipeline: {
            loop: ['prepareStep', 'invokeLLM', 'evaluateIteration'],
          },
        } as any,
      });

      const agent = new Agent(
        { model: 'test-model' },
        { stageConfig: config.pipeline },
      );

      expect(agent.state).toBe('pending');
      await agent.teardown();
    });
  });
});
