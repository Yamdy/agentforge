import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRouter, executeRouter } from '../../src/orchestration/executors/router.js';
import type { Agent, AgentRunResult } from '../../src/index.js';
import type { RouterConfig, PipelineContext } from '@primo-ai/sdk';

// Mock Agent
function createMockAgent(response: string, tokenUsage = { input: 10, output: 20 }): Agent {
  return {
    run: vi.fn(
      async (
        input: string,
        options?: { signal?: AbortSignal }
      ): Promise<AgentRunResult> => {
        if (options?.signal?.aborted) {
          throw new DOMException('Agent execution aborted', 'AbortError');
        }
        return {
          response,
          tokenUsage,
          sessionId: `session-${Date.now()}`,
          compatRetries: 0,
        };
      }
    ),
    stream: vi.fn(),
    streamEvents: vi.fn(),
    use: vi.fn(),
    reset: vi.fn(),
  } as unknown as Agent;
}

// Mock context
function createMockContext(): PipelineContext {
  return {} as PipelineContext;
}

describe('AgentRouter', () => {
  describe('constructor', () => {
    it('should create router with agent instances', () => {
      const codeAgent = createMockAgent('Code response');
      const researchAgent = createMockAgent('Research response');

      const config: RouterConfig = {
        routes: {
          code: codeAgent,
          research: researchAgent,
        },
        classifier: async () => 'code',
      };

      const router = new AgentRouter(config);
      expect(router.getRouteKeys()).toEqual(['code', 'research']);
    });

    it('should throw when AgentConfig provided without factory', () => {
      const config: RouterConfig = {
        routes: {
          code: { model: 'test-model' },
        },
        classifier: async () => 'code',
      };

      expect(() => new AgentRouter(config)).toThrow(
        'Route "code" is an AgentConfig but no agentFactory provided'
      );
    });

    it('should use agentFactory for AgentConfig routes', () => {
      const mockAgent = createMockAgent('Factory created');
      const factory = vi.fn(() => mockAgent);

      const config: RouterConfig = {
        routes: {
          code: { model: 'test-model' },
        },
        classifier: async () => 'code',
      };

      const router = new AgentRouter(config, factory);
      expect(factory).toHaveBeenCalledWith({ model: 'test-model' });
      expect(router.getRouteKeys()).toEqual(['code']);
    });

    it('should accept default agent', () => {
      const codeAgent = createMockAgent('Code response');
      const defaultAgent = createMockAgent('Default response');

      const config: RouterConfig = {
        routes: {
          code: codeAgent,
        },
        default: defaultAgent,
        classifier: async () => 'unknown',
      };

      const router = new AgentRouter(config);
      expect(router.hasRoute('code')).toBe(true);
      expect(router.hasRoute('unknown')).toBe(true);
    });
  });

  describe('route', () => {
    it('should route to correct agent based on classifier', async () => {
      const codeAgent = createMockAgent('Code response');
      const researchAgent = createMockAgent('Research response');
      const context = createMockContext();

      const config: RouterConfig = {
        routes: {
          code: codeAgent,
          research: researchAgent,
        },
        classifier: async (input) => (input.includes('code') ? 'code' : 'research'),
      };

      const router = new AgentRouter(config);

      const result1 = await router.route('Write some code', context);
      expect(result1).toBe(codeAgent);

      const result2 = await router.route('Research this topic', context);
      expect(result2).toBe(researchAgent);
    });

    it('should fall back to default agent for unknown route', async () => {
      const codeAgent = createMockAgent('Code response');
      const defaultAgent = createMockAgent('Default response');
      const context = createMockContext();

      const config: RouterConfig = {
        routes: {
          code: codeAgent,
        },
        default: defaultAgent,
        classifier: async () => 'unknown-route',
      };

      const router = new AgentRouter(config);
      const result = await router.route('Some input', context);
      expect(result).toBe(defaultAgent);
    });

    it('should throw when no route matches and no default', async () => {
      const codeAgent = createMockAgent('Code response');
      const context = createMockContext();

      const config: RouterConfig = {
        routes: {
          code: codeAgent,
        },
        classifier: async () => 'unknown-route',
      };

      const router = new AgentRouter(config);
      await expect(router.route('Some input', context)).rejects.toThrow(
        'No route found for key "unknown-route"'
      );
    });

    it('should pass context to classifier', async () => {
      const codeAgent = createMockAgent('Code response');
      const context = createMockContext();
      const classifier = vi.fn(async () => 'code');

      const config: RouterConfig = {
        routes: {
          code: codeAgent,
        },
        classifier,
      };

      const router = new AgentRouter(config);
      await router.route('test input', context);

      expect(classifier).toHaveBeenCalledWith('test input', context);
    });
  });

  describe('hasRoute', () => {
    it('should return true for existing routes', () => {
      const codeAgent = createMockAgent('Code response');

      const config: RouterConfig = {
        routes: {
          code: codeAgent,
        },
        classifier: async () => 'code',
      };

      const router = new AgentRouter(config);
      expect(router.hasRoute('code')).toBe(true);
      expect(router.hasRoute('unknown')).toBe(false);
    });

    it('should return true for any key when default exists', () => {
      const codeAgent = createMockAgent('Code response');
      const defaultAgent = createMockAgent('Default');

      const config: RouterConfig = {
        routes: {
          code: codeAgent,
        },
        default: defaultAgent,
        classifier: async () => 'code',
      };

      const router = new AgentRouter(config);
      expect(router.hasRoute('anything')).toBe(true);
    });
  });
});

describe('executeRouter', () => {
  it('should execute routed agent and return result', async () => {
    const codeAgent = createMockAgent('Code response', { input: 100, output: 50 });
    const context = createMockContext();

    const config: RouterConfig = {
      routes: {
        code: codeAgent,
      },
      classifier: async () => 'code',
    };

    const router = new AgentRouter(config);
    const result = await executeRouter(router, 'Write code', context);

    expect(result.stepName).toBe('routed');
    expect(result.response).toBe('Code response');
    expect(result.tokenUsage).toEqual({ input: 100, output: 50 });
    expect(result.error).toBeUndefined();
  });

  it('should handle routing errors', async () => {
    const codeAgent = createMockAgent('Code response');
    const context = createMockContext();

    const config: RouterConfig = {
      routes: {
        code: codeAgent,
      },
      classifier: async () => 'nonexistent',
    };

    const router = new AgentRouter(config);
    const result = await executeRouter(router, 'Test input', context);

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toContain('No route found');
  });

  it('should handle agent execution errors', async () => {
    const errorAgent = {
      run: vi.fn(async () => {
        throw new Error('Agent failed');
      }),
      stream: vi.fn(),
      streamEvents: vi.fn(),
      use: vi.fn(),
      reset: vi.fn(),
    } as unknown as Agent;
    const context = createMockContext();

    const config: RouterConfig = {
      routes: {
        error: errorAgent,
      },
      classifier: async () => 'error',
    };

    const router = new AgentRouter(config);
    const result = await executeRouter(router, 'Test input', context);

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('Agent failed');
  });

  it('should pass abort signal to agent', async () => {
    const codeAgent = createMockAgent('Code response');
    const context = createMockContext();
    const controller = new AbortController();
    controller.abort();

    const config: RouterConfig = {
      routes: {
        code: codeAgent,
      },
      classifier: async () => 'code',
    };

    const router = new AgentRouter(config);
    const result = await executeRouter(router, 'Test input', context, {
      signal: controller.signal,
    });

    expect(result.error).toBeInstanceOf(DOMException);
  });
});
