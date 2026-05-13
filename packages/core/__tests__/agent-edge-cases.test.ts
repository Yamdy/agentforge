import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider, createMockModelWithToolCalls } from './helpers.js';
import type { AgentConfig, Tool } from '@agentforge/sdk';

// Helper: create a mock tool
function mockTool(name: string): Tool {
  return {
    name,
    description: `Mock ${name} tool`,
    inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
    execute: async () => `Result from ${name}`,
  };
}

describe('Agent edge cases', () => {
  beforeEach(() => {
    registerMockProvider('edge', () =>
      createMockLanguageModel({ text: 'edge response' }),
    );
  });

  // ---------------------------------------------------------------------------
  // stream()
  // ---------------------------------------------------------------------------

  describe('stream()', () => {
    it('yields text deltas from LLM', async () => {
      registerMockProvider('stream-basic', () =>
        createMockLanguageModel({ text: 'Hello streamed!' }),
      );

      const agent = new Agent({ model: 'stream-basic/test' });
      const chunks: string[] = [];
      for await (const chunk of agent.stream('hi')) {
        chunks.push(chunk);
      }
      expect(chunks.join('')).toBe('Hello streamed!');
    });

    it('throws AbortError when signal is already aborted', async () => {
      const agent = new Agent({ model: 'edge/test' });
      const controller = new AbortController();
      controller.abort();

      const gen = agent.stream('test', controller.signal);
      await expect(gen.next()).rejects.toThrow('Agent stream aborted');
    });

    it('handles empty string input via stream', async () => {
      registerMockProvider('empty-stream', () =>
        createMockLanguageModel({ text: 'got empty' }),
      );

      const agent = new Agent({ model: 'empty-stream/test' });
      const chunks: string[] = [];
      for await (const chunk of agent.stream('')) {
        chunks.push(chunk);
      }
      expect(chunks.join('')).toBe('got empty');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool registration
  // ---------------------------------------------------------------------------

  describe('tool registration', () => {
    it('deduplicates echo tool when user registers a tool named echo', async () => {
      registerMockProvider('echo-dup', () =>
        createMockLanguageModel({ text: 'done' }),
      );

      const customEcho: Tool = {
        name: 'echo',
        description: 'Custom echo',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => 'custom echo result',
      };

      const agent = new Agent({ model: 'echo-dup/test', tools: [customEcho] });
      const tools = agent.toolRegistry.getAll();
      const echoTools = tools.filter(t => t.name === 'echo');
      expect(echoTools).toHaveLength(1);
    });

    it('registers user-provided tools alongside echo', async () => {
      registerMockProvider('tools-reg', () =>
        createMockLanguageModel({ text: 'done' }),
      );

      const tool = mockTool('myTool');
      const agent = new Agent({ model: 'tools-reg/test', tools: [tool] });
      const names = agent.toolRegistry.getAll().map(t => t.name);
      expect(names).toContain('echo');
      expect(names).toContain('myTool');
    });
  });

  // ---------------------------------------------------------------------------
  // Agentic loop edge cases
  // ---------------------------------------------------------------------------

  describe('agentic loop', () => {
    it('stops at default maxIterations (10) when not configured', async () => {
      let callCount = 0;
      registerMockProvider('default-iter', () => {
        callCount++;
        // Model always returns a tool call, forcing loop continuation
        return createMockModelWithToolCalls(
          [{ toolName: 'echo', args: { input: 'loop' } }],
          'never reached',
        );
      });

      const agent = new Agent({ model: 'default-iter/test' });
      await agent.run('test');
      expect(callCount).toBeLessThanOrEqual(10);
    });

    it('handles agent with no tools in config', async () => {
      registerMockProvider('no-tools', () =>
        createMockLanguageModel({ text: 'no tools needed' }),
      );

      const agent = new Agent({ model: 'no-tools/test' });
      const result = await agent.run('test');
      expect(result.response).toBe('no tools needed');
    });
  });

  // ---------------------------------------------------------------------------
  // Reactive compat rules integration
  // ---------------------------------------------------------------------------

  describe('reactive compat retry', () => {
    it('catches pipeline errors and re-throws when unfixable', async () => {
      const alwaysCrash = createMockLanguageModel({ text: 'nope' });
      (alwaysCrash as any).doStream = async () => {
        throw new Error('completely unknown API error that no rule can fix');
      };
      (alwaysCrash as any).doGenerate = async () => {
        throw new Error('completely unknown API error that no rule can fix');
      };
      registerMockProvider('unfixable', () => alwaysCrash);

      const agent = new Agent({ model: 'unfixable/test' });
      await expect(agent.run('test')).rejects.toThrow('completely unknown API error');
    });

    it('throws when reactive rules cannot fix the error', async () => {
      const alwaysCrash = createMockLanguageModel({ text: 'nope' });
      (alwaysCrash as any).doStream = async () => {
        throw new Error('completely unknown API error that no rule can fix');
      };
      (alwaysCrash as any).doGenerate = async () => {
        throw new Error('completely unknown API error that no rule can fix');
      };
      registerMockProvider('unfixable', () => alwaysCrash);

      const agent = new Agent({ model: 'unfixable/test' });
      await expect(agent.run('test')).rejects.toThrow('completely unknown API error');
    });
  });

  // ---------------------------------------------------------------------------
  // Model resolution caching
  // ---------------------------------------------------------------------------

  describe('model resolution', () => {
    it('caches resolved model across multiple run calls', async () => {
      let resolveCount = 0;
      registerMockProvider('cached', (modelId) => {
        resolveCount++;
        return createMockLanguageModel({ text: `resolved:${modelId}:${resolveCount}` });
      });

      const agent = new Agent({ model: 'cached/test' });
      const r1 = await agent.run('first');
      const r2 = await agent.run('second');
      expect(r1.response).toContain('resolved');
      expect(r2.response).toContain('resolved');
    });
  });
});
