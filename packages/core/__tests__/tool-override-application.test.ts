import { describe, it, expect } from 'vitest';
import { createInvokeLLMProcessor } from '../src/processors/invoke-llm.js';
import type { PipelineContext } from '@primo-ai/sdk';
import type { ToolRegistry } from '../src/tool-registry.js';
import type { HookManager } from '../src/hook-manager.js';
import type { LLMInvoker } from '../src/llm-invoker.js';
import { ProcessorContextImpl } from '../src/processor-context.js';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: {
      config: { model: 'mock/test' },
      promptFragments: [],
      toolDeclarations: [],
    },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

/**
 * F-10: invokeLLM should use ctx.agent.toolDeclarations (which include profile
 * overrides like exclusion and description changes) instead of raw
 * registry.toAiSdkToolSchemas() which returns all registered tools unmodified.
 */
describe('F-10: tool override application', () => {
  it('invokeLLM passes toolDeclarations from context, not raw registry schemas', async () => {
    let capturedTools: Record<string, unknown> | undefined;

    const mockGetLLM = async (): Promise<LLMInvoker> => ({
      stream: (input: { tools?: Record<string, unknown> }) => {
        capturedTools = input.tools as Record<string, unknown> | undefined;
        return {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'response' };
            yield { type: 'finish-step', usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } };
          })(),
          usage: Promise.resolve({ input: 1, output: 1 }),
          reasoning: Promise.resolve(undefined),
        };
      },
    } as unknown as LLMInvoker);

    // Registry has 3 tools: search, calculate, echo
    const registrySchemas = {
      search: { description: 'Search the web', inputSchema: {} },
      calculate: { description: 'Do math', inputSchema: {} },
      echo: { description: 'Echo input', inputSchema: {} },
    };

    const processor = createInvokeLLMProcessor({
      getLLM: mockGetLLM,
      registry: {
        toAiSdkToolSchemas: () => registrySchemas,
        setToolExecutionContext: () => {},
        get: (name: string) => ({
          search: { name: 'search', description: 'Search the web', inputSchema: {} },
          calculate: { name: 'calculate', description: 'Do math', inputSchema: {} },
          echo: { name: 'echo', description: 'Echo input', inputSchema: {} },
        }[name]),
      } as unknown as ToolRegistry,
      hookManager: { invoke: async () => {} } as unknown as HookManager,
      modelString: 'mock/test',
    });

    // Context builder excluded 'echo' and changed 'search' description
    const ctx = makeContext({
      agent: {
        config: { model: 'mock/test' },
        promptFragments: [],
        toolDeclarations: [
          { name: 'search', description: 'Search the web (enhanced)' },
          { name: 'calculate', description: 'Do math' },
          // 'echo' excluded by profile override
        ],
      },
    });

    await processor.execute(new ProcessorContextImpl(ctx));

    // BUG: currently invokeLLM uses registry.toAiSdkToolSchemas() which returns
    // all 3 tools with original descriptions. FIX: should use ctx.agent.toolDeclarations.
    expect(capturedTools).toBeDefined();
    const toolNames = Object.keys(capturedTools!);
    expect(toolNames).not.toContain('echo');
    expect(toolNames).toContain('search');
    expect(toolNames).toContain('calculate');
    // Description should be overridden
    expect((capturedTools!.search as { description: string }).description).toBe('Search the web (enhanced)');
  });

  it('falls back to registry schemas when no toolDeclarations in context', async () => {
    let capturedTools: Record<string, unknown> | undefined;

    const mockGetLLM = async (): Promise<LLMInvoker> => ({
      stream: (input: { tools?: Record<string, unknown> }) => {
        capturedTools = input.tools as Record<string, unknown> | undefined;
        return {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'ok' };
            yield { type: 'finish-step', usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } };
          })(),
          usage: Promise.resolve({ input: 1, output: 1 }),
          reasoning: Promise.resolve(undefined),
        };
      },
    } as unknown as LLMInvoker);

    const registrySchemas = {
      search: { description: 'Search the web', inputSchema: {} },
    };

    const processor = createInvokeLLMProcessor({
      getLLM: mockGetLLM,
      registry: { toAiSdkToolSchemas: () => registrySchemas, setToolExecutionContext: () => {} } as unknown as ToolRegistry,
      hookManager: { invoke: async () => {} } as unknown as HookManager,
      modelString: 'mock/test',
    });

    // Empty toolDeclarations (context builder didn't run)
    const ctx = makeContext({
      agent: {
        config: { model: 'mock/test' },
        promptFragments: [],
        toolDeclarations: [],
      },
    });

    await processor.execute(new ProcessorContextImpl(ctx));

    // Should still use registry schemas as fallback
    expect(capturedTools).toBeDefined();
    expect(Object.keys(capturedTools!)).toContain('search');
  });
});
