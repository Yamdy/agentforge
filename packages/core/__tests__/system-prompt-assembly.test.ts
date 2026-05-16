import { describe, it, expect } from 'vitest';
import { createInvokeLLMProcessor } from '../src/processors/invoke-llm.js';
import type { PipelineContext } from '@agentforge/sdk';
import type { ToolRegistry } from '../src/tool-registry.js';
import type { HookManager } from '../src/hook-manager.js';
import type { LLMInvoker } from '../src/llm-invoker.js';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test input', sessionId: 's1' },
    agent: {
      config: { model: 'mock/test', systemPrompt: 'raw config prompt' },
      promptFragments: [],
      toolDeclarations: [],
    },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

/**
 * F-9: invokeLLM should use the assembled systemPrompt (ctx.agent.systemPrompt)
 * which includes promptFragments, not the raw config prompt.
 *
 * F-11: promptFragments added during the loop (after buildContext) should also
 * be visible to invokeLLM.
 */
describe('F-9/F-11: system prompt assembly', () => {
  it('F-9: invokeLLM passes assembled systemPrompt to getLLM, not raw config prompt', async () => {
    let capturedSystemPrompt: string | undefined;

    const mockGetLLM = async (systemPrompt?: string): Promise<LLMInvoker> => {
      capturedSystemPrompt = systemPrompt;
      return {
        stream: () => ({
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'response' };
            yield { type: 'finish-step', usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } };
          })(),
          usage: Promise.resolve({ input: 1, output: 1 }),
          reasoning: Promise.resolve(undefined),
        }),
      } as unknown as LLMInvoker;
    };

    const processor = createInvokeLLMProcessor({
      getLLM: mockGetLLM,
      registry: { toAiSdkToolSchemas: () => ({}), setToolExecutionContext: () => {} } as unknown as ToolRegistry,
      hookManager: { invoke: async () => {} } as unknown as HookManager,
      modelString: 'mock/test',
    });

    // Simulate what buildContext produces:
    // ctx.agent.systemPrompt = assembled (raw + fragments)
    // ctx.agent.config.systemPrompt = raw (unchanged)
    const ctx = makeContext({
      agent: {
        config: { model: 'mock/test', systemPrompt: 'raw config prompt' },
        systemPrompt: 'raw config prompt\n\ninjected fragment from plugin',
        promptFragments: ['injected fragment from plugin'],
        toolDeclarations: [],
        _assembledFragmentCount: 1,
      } as unknown as PipelineContext['agent'],
    });

    await processor.execute(ctx);

    // BUG: currently invokeLLM reads ctx.agent.config.systemPrompt ("raw config prompt")
    // FIX: should read ctx.agent.systemPrompt ("raw config prompt\n\ninjected fragment from plugin")
    expect(capturedSystemPrompt).toBe('raw config prompt\n\ninjected fragment from plugin');
  });

  it('F-9: falls back to config.systemPrompt when assembled prompt is undefined', async () => {
    let capturedSystemPrompt: string | undefined;

    const mockGetLLM = async (systemPrompt?: string): Promise<LLMInvoker> => {
      capturedSystemPrompt = systemPrompt;
      return {
        stream: () => ({
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'ok' };
            yield { type: 'finish-step', usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } };
          })(),
          usage: Promise.resolve({ input: 1, output: 1 }),
          reasoning: Promise.resolve(undefined),
        }),
      } as unknown as LLMInvoker;
    };

    const processor = createInvokeLLMProcessor({
      getLLM: mockGetLLM,
      registry: { toAiSdkToolSchemas: () => ({}), setToolExecutionContext: () => {} } as unknown as ToolRegistry,
      hookManager: { invoke: async () => {} } as unknown as HookManager,
      modelString: 'mock/test',
    });

    // No systemPrompt assembled (no buildContext stage ran)
    const ctx = makeContext();

    await processor.execute(ctx);

    expect(capturedSystemPrompt).toBe('raw config prompt');
  });

  it('F-11: promptFragments added by evaluateIteration are visible to invokeLLM in next loop step', async () => {
    let capturedSystemPrompt: string | undefined;

    const mockGetLLM = async (systemPrompt?: string): Promise<LLMInvoker> => {
      capturedSystemPrompt = systemPrompt;
      return {
        stream: () => ({
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'response' };
            yield { type: 'finish-step', usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } };
          })(),
          usage: Promise.resolve({ input: 1, output: 1 }),
          reasoning: Promise.resolve(undefined),
        }),
      } as unknown as LLMInvoker;
    };

    const processor = createInvokeLLMProcessor({
      getLLM: mockGetLLM,
      registry: { toAiSdkToolSchemas: () => ({}), setToolExecutionContext: () => {} } as unknown as ToolRegistry,
      hookManager: { invoke: async () => {} } as unknown as HookManager,
      modelString: 'mock/test',
    });

    // Simulate loop step 1: buildContext already assembled base prompt,
    // evaluateIteration added a reminder fragment
    const ctx = makeContext({
      agent: {
        config: { model: 'mock/test', systemPrompt: 'base prompt' },
        // buildContext assembled this:
        systemPrompt: 'base prompt\n\ngoal echo fragment',
        // evaluateIteration added this during the loop:
        promptFragments: [
          'goal echo fragment',
          '[system] Required tools not yet called: search_tool. Please call them before finishing.',
        ],
        toolDeclarations: [],
        _assembledFragmentCount: 1,
      } as unknown as PipelineContext['agent'],
    });

    await processor.execute(ctx);

    // The system prompt should include the evaluateIteration-added fragment
    expect(capturedSystemPrompt).toContain('Required tools not yet called');
  });
});
