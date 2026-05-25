import { describe, it, expect } from 'vitest';
import { createEvaluateIterationProcessor } from '../src/processors/evaluate-iteration.js';
import type { PipelineContext, AgentConfig, ToolResult, ToolCall, ContextBudget, ProcessorResult, Message } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '../src/processor-context.js';

function asProcessorResult(result: unknown): ProcessorResult {
  if (result && typeof result === 'object' && 'status' in result) return result as ProcessorResult;
  throw new Error('Expected ProcessorResult');
}

function makeContext(overrides?: {
  config?: Partial<AgentConfig>;
  contextBudget?: ContextBudget;
  tokenUsage?: { input: number; output: number };
  toolResults?: unknown[];
  pendingToolCalls?: unknown[];
  history?: unknown[];
  step?: number;
}): PipelineContext {
  return {
    agent: {
      config: { model: 'test', maxIterations: 10, ...overrides?.config },
      promptFragments: [],
      toolDeclarations: [],
      contextBudget: overrides?.contextBudget,
    },
    iteration: {
      step: overrides?.step ?? 1,
      tokenUsage: overrides?.tokenUsage ?? { input: 100, output: 50 },
      toolResults: overrides?.toolResults as unknown as ToolResult[] | undefined,
      pendingToolCalls: overrides?.pendingToolCalls as unknown as ToolCall[] | undefined,
    },
    session: {
      input: 'test',
      sessionId: 's1',
      custom: {},
      messageHistory: overrides?.history as Message[] | undefined,
      totalTokenUsage: { input: 0, output: 0 },
    },
  };
}

describe('F-9: Budget coordination between ContextBuilder and evaluateIteration', () => {
  describe('maxTotalTokens derivation from ContextBudget', () => {
    it('derives maxTotalTokens from contextBudget.maxTokens when no explicit override', async () => {
      // When contextBudget.maxTokens = 128_000, maxTotalTokens should be
      // derived as maxTokens * 0.8 = 102_400
      // maxIterationTokens = 102_400 / 10 = 10_240
      // Use iteration tokens well within per-iteration limit but total > 102_400
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 128_000 },
        config: { maxIterations: 10 },
        // iterationTokens = 10_000 < 10_240 (ok per-iteration)
        tokenUsage: { input: 8_000, output: 2_000 },
      });
      // Set accumulated total from previous iterations
      ctx.session.totalTokenUsage = { input: 95_000, output: 3_000 };
      // Total = 95_000 + 3_000 + 8_000 + 2_000 = 108_000 > 102_400
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
      expect(asProcessorResult(result).status).toBe('warning');
      expect(asProcessorResult(result).summary).toContain('Token budget exceeded');
    });

    it('uses derived budget even when below the old hard-coded default', async () => {
      // contextBudget.maxTokens = 80_000 → derived maxTotalTokens = 64_000
      // maxIterationTokens = 64_000 / 10 = 6_400
      // iterationTokens = 5_000 < 6_400 (ok per-iteration)
      // totalTokens = 5_000 < 64_000 (ok total)
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 80_000 },
        tokenUsage: { input: 4_000, output: 1_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      // Below both budgets — should not stop due to tokens
      expect(asProcessorResult(result).status).toBe('success');
    });

    it('derives correctly for small contextBudget values', async () => {
      // contextBudget.maxTokens = 10_000 → derived maxTotalTokens = 8_000
      // maxIterationTokens = 800
      // iterationTokens = 9_000 > 800 → iteration overflow first
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 10_000 },
        tokenUsage: { input: 8_000, output: 1_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
      expect(asProcessorResult(result).status).toBe('warning');
    });
  });

  describe('explicit maxTotalTokens override', () => {
    it('explicit maxTotalTokens in deps overrides derived value from budget', async () => {
      // contextBudget.maxTokens = 128_000 → would derive 102_400
      // But explicit maxTotalTokens = 50_000 should take precedence
      // maxIterationTokens = 50_000 / 10 = 5_000
      // iterationTokens = 60_000 > 5_000 → iteration overflow
      const processor = createEvaluateIterationProcessor({ maxTotalTokens: 50_000 });
      const ctx = makeContext({
        contextBudget: { maxTokens: 128_000 },
        tokenUsage: { input: 50_000, output: 10_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
      expect(asProcessorResult(result).status).toBe('warning');
    });

    it('explicit maxTotalTokens in ContextBudget overrides derived value', async () => {
      // contextBudget.maxTokens = 128_000 → would derive 102_400
      // But contextBudget.maxTotalTokens = 60_000 should take precedence
      // maxIterationTokens = 60_000 / 10 = 6_000
      // iterationTokens = 70_000 > 6_000 → iteration overflow
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 128_000, maxTotalTokens: 60_000 },
        tokenUsage: { input: 60_000, output: 10_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
      expect(asProcessorResult(result).status).toBe('warning');
    });

    it('explicit maxTotalTokens in ContextBudget is used even when higher than derived', async () => {
      // contextBudget.maxTokens = 128_000 → would derive 102_400
      // contextBudget.maxTotalTokens = 120_000 should take precedence (explicit override)
      // maxIterationTokens = 120_000 / 10 = 12_000
      // iterationTokens = 1_000 < 12_000, totalTokens = 1_000 < 120_000 → ok
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 128_000, maxTotalTokens: 120_000 },
        tokenUsage: { input: 800, output: 200 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(asProcessorResult(result).status).toBe('success');
    });
  });

  describe('maxIterationTokens calculation', () => {
    it('calculates maxIterationTokens as maxTotalTokens / maxIterations', async () => {
      // contextBudget.maxTokens = 100_000, maxIterations = 10
      // derived maxTotalTokens = 80_000
      // maxIterationTokens = 80_000 / 10 = 8_000
      // iterationTokens = 9_000 > 8_000 → iteration overflow
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 100_000 },
        config: { maxIterations: 10 },
        tokenUsage: { input: 8_000, output: 1_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
      expect(asProcessorResult(result).status).toBe('warning');
      expect(asProcessorResult(result).summary.toLowerCase()).toContain('iteration');
    });

    it('allows iteration within per-iteration budget', async () => {
      // contextBudget.maxTokens = 100_000, maxIterations = 10
      // derived maxTotalTokens = 80_000
      // maxIterationTokens = 80_000 / 10 = 8_000
      // iterationTokens = 7_000 < 8_000 (ok per-iteration)
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 100_000 },
        config: { maxIterations: 10 },
        tokenUsage: { input: 6_000, output: 1_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      // Should succeed (no tool results → stop, but not due to budget)
      expect(asProcessorResult(result).status).toBe('success');
    });

    it('respects explicit maxIterationTokens in ContextBudget', async () => {
      // contextBudget.maxTokens = 100_000, maxIterationTokens = 5_000
      // Even though derived would be 8_000, explicit 5_000 takes precedence
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 100_000, maxIterationTokens: 5_000 },
        config: { maxIterations: 10 },
        // Single iteration uses 6_000 > 5_000, should stop with iteration overflow
        tokenUsage: { input: 5_000, output: 1_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
      expect(asProcessorResult(result).status).toBe('warning');
    });

    it('uses default maxIterations=10 when not specified for per-iteration calc', async () => {
      // No maxIterations in config → defaults to 10
      // contextBudget.maxTokens = 100_000 → derived maxTotalTokens = 80_000
      // maxIterationTokens = 80_000 / 10 = 8_000
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 100_000 },
        tokenUsage: { input: 8_000, output: 1_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
      expect(asProcessorResult(result).status).toBe('warning');
    });
  });

  describe('default behavior unchanged (no contextBudget set)', () => {
    it('falls back to old hard-coded 100_000 when no budget is set', async () => {
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        // No contextBudget
        // 90_000 < 100_000, should NOT stop
        tokenUsage: { input: 80_000, output: 10_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(asProcessorResult(result).status).toBe('success');
    });

    it('stops at 100_000 when no budget is set', async () => {
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        // No contextBudget
        // 110_000 > 100_000, should stop
        tokenUsage: { input: 100_000, output: 10_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
      expect(asProcessorResult(result).status).toBe('warning');
    });

    it('no per-iteration limit when no budget is set (backward compat)', async () => {
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        // No contextBudget — single iteration can use lots of tokens
        // as long as total doesn't exceed 100_000
        tokenUsage: { input: 90_000, output: 5_000 },
      });
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      // 95_000 < 100_000 total, and no per-iteration limit, so success
      expect(asProcessorResult(result).status).toBe('success');
    });
  });

  describe('total budget still enforced alongside iteration budget', () => {
    it('stops on total budget even when iteration budget is not exceeded', async () => {
      // contextBudget.maxTokens = 100_000, maxIterations = 10
      // derived maxTotalTokens = 80_000
      // maxIterationTokens = 8_000
      // Iteration uses 5_000 < 8_000 (ok per-iteration)
      // But we simulate accumulated total > maxTotalTokens
      const processor = createEvaluateIterationProcessor();
      const ctx = makeContext({
        contextBudget: { maxTokens: 100_000 },
        config: { maxIterations: 10 },
        tokenUsage: { input: 4_000, output: 1_000 },
      });
      // Set accumulated total from previous iterations
      ctx.session.totalTokenUsage = { input: 75_000, output: 2_000 };
      // Total = 75_000 + 2_000 + 4_000 + 1_000 = 82_000 > 80_000
      const pCtx = new ProcessorContextImpl(ctx);
      const result = await processor.execute(pCtx);
      expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
      expect(asProcessorResult(result).status).toBe('warning');
    });
  });
});
