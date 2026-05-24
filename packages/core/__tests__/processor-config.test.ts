import { describe, it, expect, vi } from 'vitest';
import type { Processor, ProcessorDescriptor, ProcessorContext, PipelineContext, StageName } from '@primo-ai/sdk';
import { ConfigLoader } from '../src/config.js';

// Import processors to trigger registration with globalProcessorRegistry
import '../src/processors/index.js';

// ---------------------------------------------------------------------------
// Phase 2: 配置接管 Processor
// User Journey: As a framework user, I want to declare processor selections
// in config, so that I can customize which processors handle each pipeline
// stage without writing code.
// ---------------------------------------------------------------------------

function makeProcessor(stage: StageName): Processor {
  return {
    stage,
    execute: async (ctx: ProcessorContext) => ctx.state,
  };
}

describe('Phase 2: Processor configuration in HarnessConfig', () => {
  const loader = new ConfigLoader();

  // -------------------------------------------------------------------------
  // ConfigLoader validates processors field
  // -------------------------------------------------------------------------

  describe('ConfigLoader validates processors field', () => {
    it('accepts a valid processors config with builtin descriptors', async () => {
      const config = await loader.load({
        session: {
          processors: {
            processInput: { builtin: 'processInput' },
            invokeLLM: { builtin: 'invokeLLM' },
            processOutput: { builtin: 'processOutput' },
          },
        } as any,
      });
      expect(config.processors).toBeDefined();
      expect(config.processors!.processInput).toEqual({ builtin: 'processInput' });
      expect(config.processors!.invokeLLM).toEqual({ builtin: 'invokeLLM' });
    });

    it('accepts processors config with module descriptors', async () => {
      const config = await loader.load({
        session: {
          processors: {
            invokeLLM: { module: './custom-llm.js', export: 'createProcessor' },
          },
        } as any,
      });
      expect(config.processors).toBeDefined();
      expect(config.processors!.invokeLLM).toEqual({
        module: './custom-llm.js',
        export: 'createProcessor',
      });
    });

    it('accepts processors config with config field in descriptors', async () => {
      const config = await loader.load({
        session: {
          processors: {
            evaluateIteration: { builtin: 'evaluateIteration', config: { strictMode: true } },
          },
        } as any,
      });
      expect(config.processors).toBeDefined();
    });

    it('rejects processors config with invalid descriptor shape', async () => {
      await expect(loader.load({
        session: {
          processors: {
            invokeLLM: { invalid: 'field' },
          },
        } as any,
      })).rejects.toThrow(/Invalid config/);
    });

    it('accepts empty processors config', async () => {
      const config = await loader.load({
        session: {
          processors: {},
        } as any,
      });
      expect(config.processors).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // Agent uses custom processor descriptors
  // -------------------------------------------------------------------------

  describe('Agent uses custom processor descriptors from deps', () => {
    it('Agent accepts processorDescriptors in AgentDependencies', async () => {
      const { Agent } = await import('../src/agent.js');

      const customDescriptors: Record<string, ProcessorDescriptor> = {
        processInput: { builtin: 'processInput' },
        buildContext: { builtin: 'buildContext' },
        prepareStep: { builtin: 'prepareStep' },
        gateLLM: { builtin: 'gateLLM' },
        invokeLLM: { builtin: 'invokeLLM' },
        processStepOutput: { builtin: 'processStepOutput' },
        gateTool: { builtin: 'gateTool' },
        executeTools: { builtin: 'executeTools' },
        evaluateIteration: { builtin: 'evaluateIteration' },
        processOutput: { builtin: 'processOutput' },
      };

      const agent = new Agent(
        { model: 'test-model' },
        { processorDescriptors: customDescriptors },
      );

      expect(agent.state).toBe('pending');
      await agent.teardown();
    });

    it('Agent without processorDescriptors uses defaults (no regression)', async () => {
      const { Agent } = await import('../src/agent.js');

      const agent = new Agent({ model: 'test-model' });

      const processors = (agent.pipelineRunner as any).processors as Processor[];
      const stages = processors.map((p) => p.stage);

      // All default stages should be present
      expect(stages).toContain('processInput');
      expect(stages).toContain('buildContext');
      expect(stages).toContain('invokeLLM');
      expect(stages).toContain('evaluateIteration');
      expect(stages).toContain('processOutput');

      await agent.teardown();
    });

    it('Agent with custom descriptors registers processors for specified stages', async () => {
      const { Agent } = await import('../src/agent.js');

      const customDescriptors: Record<string, ProcessorDescriptor> = {
        processInput: { builtin: 'processInput' },
        buildContext: { builtin: 'buildContext' },
        prepareStep: { builtin: 'prepareStep' },
        gateLLM: { builtin: 'gateLLM' },
        invokeLLM: { builtin: 'invokeLLM' },
        processStepOutput: { builtin: 'processStepOutput' },
        gateTool: { builtin: 'gateTool' },
        executeTools: { builtin: 'executeTools' },
        evaluateIteration: { builtin: 'evaluateIteration' },
        processOutput: { builtin: 'processOutput' },
      };

      const agent = new Agent(
        { model: 'test-model' },
        { processorDescriptors: customDescriptors },
      );

      const processors = (agent.pipelineRunner as any).processors as Processor[];
      const stages = processors.map((p) => p.stage);

      expect(stages).toContain('processInput');
      expect(stages).toContain('invokeLLM');
      expect(stages).toContain('processOutput');

      await agent.teardown();
    });

    it('Agent preserves buildContext special path when using custom descriptors', async () => {
      const { Agent } = await import('../src/agent.js');

      const customDescriptors: Record<string, ProcessorDescriptor> = {
        processInput: { builtin: 'processInput' },
        buildContext: { builtin: 'buildContext' },
        prepareStep: { builtin: 'prepareStep' },
        gateLLM: { builtin: 'gateLLM' },
        invokeLLM: { builtin: 'invokeLLM' },
        processStepOutput: { builtin: 'processStepOutput' },
        gateTool: { builtin: 'gateTool' },
        executeTools: { builtin: 'executeTools' },
        evaluateIteration: { builtin: 'evaluateIteration' },
        processOutput: { builtin: 'processOutput' },
      };

      const agent = new Agent(
        { model: 'test-model' },
        { processorDescriptors: customDescriptors },
      );

      const processors = (agent.pipelineRunner as any).processors as Processor[];
      const buildCtxProc = processors.find((p) => p.stage === 'buildContext');

      expect(buildCtxProc).toBeDefined();

      await agent.teardown();
    });

    it('Agent with partial descriptors fills remaining from defaults', async () => {
      const { Agent } = await import('../src/agent.js');

      const partialDescriptors: Record<string, ProcessorDescriptor> = {
        processInput: { builtin: 'processInput' },
        invokeLLM: { builtin: 'invokeLLM' },
      };

      const agent = new Agent(
        { model: 'test-model' },
        { processorDescriptors: partialDescriptors },
      );

      const processors = (agent.pipelineRunner as any).processors as Processor[];
      const stages = processors.map((p) => p.stage);

      expect(stages).toContain('processInput');
      expect(stages).toContain('invokeLLM');
      expect(stages).toContain('buildContext');
      expect(stages).toContain('evaluateIteration');
      expect(stages).toContain('processOutput');

      await agent.teardown();
    });
  });

  // -------------------------------------------------------------------------
  // End-to-end: Config → Agent
  // -------------------------------------------------------------------------

  describe('Config-loaded processors can be passed to Agent', () => {
    it('ConfigLoader processors can be used as Agent processorDescriptors', async () => {
      const { Agent } = await import('../src/agent.js');

      const config = await loader.load({
        session: {
          processors: {
            processInput: { builtin: 'processInput' },
            invokeLLM: { builtin: 'invokeLLM' },
            processOutput: { builtin: 'processOutput' },
          },
        } as any,
      });

      const agent = new Agent(
        { model: 'test-model' },
        { processorDescriptors: config.processors },
      );

      expect(agent.state).toBe('pending');
      await agent.teardown();
    });
  });
});
