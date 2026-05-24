// ========== Tool Lifecycle Middleware Tests ==========

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ToolLifecycleManager,
  loggingMiddleware,
  timingMiddleware,
  retryMiddleware,
  errorMiddleware,
} from '../../src/lifecycle/index.js';
import type { ToolLifecycleContext } from '../../src/lifecycle/types.js';
import { textResult } from '../../src/tool/result.js';
import { createMockToolContext } from '../../src/tool/context.js';

describe('ToolLifecycleManager', () => {
  let manager: ToolLifecycleManager;
  let mockContext: ToolLifecycleContext;

  beforeEach(() => {
    manager = new ToolLifecycleManager();
    mockContext = {
      tool: { name: 'test-tool', description: 'Test tool' },
      args: { input: 'test' },
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };
  });

  describe('middleware registration', () => {
    it('should register a single middleware', () => {
      const middleware = vi.fn();
      manager.use(middleware);
      expect(manager.getMiddlewares()).toHaveLength(1);
    });

    it('should register multiple middlewares', () => {
      const m1 = vi.fn();
      const m2 = vi.fn();
      manager.useAll([m1, m2]);
      expect(manager.getMiddlewares()).toHaveLength(2);
    });

    it('should support chaining', () => {
      const m1 = vi.fn();
      const m2 = vi.fn();
      manager.use(m1).use(m2);
      expect(manager.getMiddlewares()).toHaveLength(2);
    });

    it('should clear all middlewares', () => {
      manager.use(vi.fn()).use(vi.fn());
      manager.clear();
      expect(manager.getMiddlewares()).toHaveLength(0);
    });
  });

  describe('execution without middleware', () => {
    it('should execute base handler directly', async () => {
      const executor = vi.fn().mockResolvedValue(textResult('success'));
      const result = await manager.execute(
        { name: 'test', description: 'Test' },
        { input: 'test' },
        mockContext.ctx,
        executor
      );

      expect(executor).toHaveBeenCalled();
      expect(result.output).toBe('success');
    });
  });

  describe('execution with middleware', () => {
    it('should execute middleware in correct order (onion model)', async () => {
      const order: string[] = [];

      const middleware1: ToolLifecycleMiddleware = async (ctx, next) => {
        order.push('m1-before');
        const result = await next();
        order.push('m1-after');
        return result;
      };

      const middleware2: ToolLifecycleMiddleware = async (ctx, next) => {
        order.push('m2-before');
        const result = await next();
        order.push('m2-after');
        return result;
      };

      manager.use(middleware1).use(middleware2);

      const executor = vi.fn().mockResolvedValue(textResult('done'));
      await manager.execute(
        { name: 'test', description: 'Test' },
        {},
        mockContext.ctx,
        executor
      );

      // First registered = outermost
      expect(order).toEqual([
        'm1-before',
        'm2-before',
        'm2-after',
        'm1-after',
      ]);
    });

    it('should allow middleware to modify args', async () => {
      const modifyMiddleware: ToolLifecycleMiddleware = async (ctx, next) => {
        ctx.args = { ...ctx.args, modified: true };
        return next();
      };

      let receivedArgs: Record<string, unknown> = {};
      const executor = vi.fn().mockImplementation((args) => {
        receivedArgs = args;
        return textResult('done');
      });

      manager.use(modifyMiddleware);
      await manager.execute(
        { name: 'test', description: 'Test' },
        { original: true },
        mockContext.ctx,
        executor
      );

      expect(receivedArgs).toHaveProperty('modified', true);
      expect(receivedArgs).toHaveProperty('original', true);
    });

    it('should allow middleware to modify result', async () => {
      const modifyMiddleware: ToolLifecycleMiddleware = async (ctx, next) => {
        const result = await next();
        result.result.title = 'Modified Title';
        return result;
      };

      manager.use(modifyMiddleware);
      const executor = vi.fn().mockResolvedValue(textResult('output', 'Original Title'));
      const result = await manager.execute(
        { name: 'test', description: 'Test' },
        {},
        mockContext.ctx,
        executor
      );

      expect(result.title).toBe('Modified Title');
    });

    it('should allow middleware to skip execution', async () => {
      const skipMiddleware: ToolLifecycleMiddleware = async (ctx, next) => {
        return {
          result: textResult('skipped'),
          skipped: true,
        };
      };

      const executor = vi.fn().mockResolvedValue(textResult('not skipped'));
      manager.use(skipMiddleware);
      const result = await manager.execute(
        { name: 'test', description: 'Test' },
        {},
        mockContext.ctx,
        executor
      );

      expect(executor).not.toHaveBeenCalled();
      expect(result.output).toBe('skipped');
    });
  });
});

describe('loggingMiddleware', () => {
  it('should log before and after execution', async () => {
    const logs: string[] = [];
    const logger = {
      debug: (...args: unknown[]) => logs.push(`debug: ${args[0]}`),
      info: (...args: unknown[]) => logs.push(`info: ${args[0]}`),
    };

    const middleware = loggingMiddleware(logger);
    const context: ToolLifecycleContext = {
      tool: { name: 'test-tool', description: 'Test' },
      args: { input: 'test' },
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    await middleware(context, async () => ({
      result: textResult('done'),
    }));

    expect(logs.some((l) => l.includes('starting'))).toBe(true);
    expect(logs.some((l) => l.includes('completed'))).toBe(true);
  });

  it('should log errors', async () => {
    const logs: string[] = [];
    const logger = {
      warn: (...args: unknown[]) => logs.push(`warn: ${args[0]}`),
    };

    const middleware = loggingMiddleware(logger);
    const context: ToolLifecycleContext = {
      tool: { name: 'test-tool', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    await middleware(context, async () => ({
      result: textResult('failed'),
      error: new Error('Test error'),
    }));

    expect(logs.some((l) => l.includes('failed'))).toBe(true);
  });
});

describe('timingMiddleware', () => {
  it('should add timing metadata to result', async () => {
    const middleware = timingMiddleware();
    const context: ToolLifecycleContext = {
      tool: { name: 'test', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    const result = await middleware(context, async () => ({
      result: textResult('done'),
    }));

    expect(result.metadata?.timing).toBeDefined();
    expect(result.metadata?.timing).toHaveProperty('startTime');
    expect(result.metadata?.timing).toHaveProperty('duration');
    expect(typeof result.metadata?.timing.duration).toBe('number');
  });
});

describe('retryMiddleware', () => {
  it('should not retry when maxRetries is 0', async () => {
    const middleware = retryMiddleware({ maxRetries: 0 });
    const context: ToolLifecycleContext = {
      tool: { name: 'test', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    let callCount = 0;
    // When maxRetries=0, retry middleware is a passthrough
    // Errors propagate to error middleware (not handled here)
    await expect(
      middleware(context, async () => {
        callCount++;
        throw new Error('First error');
      })
    ).rejects.toThrow('First error');

    expect(callCount).toBe(1);
  });

  it('should retry on error and succeed', async () => {
    const middleware = retryMiddleware({
      maxRetries: 2,
      initialDelay: 10, // Fast for testing
      backoffFactor: 1,
    });
    const context: ToolLifecycleContext = {
      tool: { name: 'test', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    let callCount = 0;
    const result = await middleware(context, async () => {
      callCount++;
      if (callCount < 2) throw new Error(`Error ${callCount}`);
      return { result: textResult('success') };
    });

    expect(callCount).toBe(2);
    expect(result.result.output).toBe('success');
    expect(result.metadata?.retry?.retries).toBe(1);
  });

  it('should exhaust retries and return error result', async () => {
    const middleware = retryMiddleware({
      maxRetries: 2,
      initialDelay: 10,
      backoffFactor: 1,
    });
    const context: ToolLifecycleContext = {
      tool: { name: 'test', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    let callCount = 0;
    const result = await middleware(context, async () => {
      callCount++;
      throw new Error('Always fails');
    });

    expect(callCount).toBe(3); // Initial + 2 retries
    expect(result.error).toBeDefined();
    expect(result.metadata?.retry?.retries).toBe(2);
  });

  it('should respect retryIf predicate', async () => {
    const middleware = retryMiddleware({
      maxRetries: 2,
      initialDelay: 10,
      backoffFactor: 1,
      retryIf: (error) => error.message.includes('retryable'),
    });
    const context: ToolLifecycleContext = {
      tool: { name: 'test', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    let callCount = 0;
    const result = await middleware(context, async () => {
      callCount++;
      throw new Error('permanent failure'); // Does NOT contain 'retryable'
    });

    expect(callCount).toBe(1); // No retry because error doesn't match predicate
    expect(result.error).toBeDefined();
  });
});

describe('errorMiddleware', () => {
  it('should catch errors and return error result', async () => {
    const middleware = errorMiddleware();
    const context: ToolLifecycleContext = {
      tool: { name: 'test', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    const result = await middleware(context, async () => {
      throw new Error('Test error');
    });

    expect(result.error).toBeDefined();
    expect(result.result.title).toBe('Error');
    expect(result.result.output).toContain('Test error');
  });

  it('should include stack trace when configured', async () => {
    const middleware = errorMiddleware({ includeStack: true });
    const context: ToolLifecycleContext = {
      tool: { name: 'test', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    const result = await middleware(context, async () => {
      throw new Error('Test error');
    });

    expect(result.result.output).toContain('Stack trace');
  });

  it('should use custom transform function', async () => {
    const middleware = errorMiddleware({
      transform: (error) => ({
        title: 'Custom Error',
        output: `Custom: ${error.message}`,
      }),
    });
    const context: ToolLifecycleContext = {
      tool: { name: 'test', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    const result = await middleware(context, async () => {
      throw new Error('Test error');
    });

    expect(result.result.title).toBe('Custom Error');
    expect(result.result.output).toBe('Custom: Test error');
  });

  it('should pass through successful results', async () => {
    const middleware = errorMiddleware();
    const context: ToolLifecycleContext = {
      tool: { name: 'test', description: 'Test' },
      args: {},
      ctx: createMockToolContext(),
      startTime: Date.now(),
      attempt: 0,
    };

    const result = await middleware(context, async () => ({
      result: textResult('success'),
    }));

    expect(result.result.output).toBe('success');
    expect(result.error).toBeUndefined();
  });
});

describe('Integration: Manager with multiple middlewares', () => {
  it('should execute all middlewares in correct order', async () => {
    const events: string[] = [];

    const manager = new ToolLifecycleManager()
      .use(loggingMiddleware({
        debug: (...args) => events.push(`log: ${args[0]}`),
        info: (...args) => events.push(`log: ${args[0]}`),
      }))
      .use(timingMiddleware())
      .use(errorMiddleware());

    const executor = vi.fn().mockResolvedValue(textResult('done'));
    const result = await manager.execute(
      { name: 'test', description: 'Test' },
      { input: 'test' },
      createMockToolContext(),
      executor
    );

    expect(result.output).toBe('done');
    expect(result.metadata?._lifecycle?.timing).toBeDefined();
    expect(events.length).toBeGreaterThan(0);
  });

  it('should handle errors through the chain', async () => {
    const events: string[] = [];

    const manager = new ToolLifecycleManager()
      .use(loggingMiddleware({
        warn: (...args) => events.push(`warn: ${args[0]}`),
        error: (...args) => events.push(`error: ${args[0]}`),
      }))
      .use(errorMiddleware());

    const executor = vi.fn().mockRejectedValue(new Error('Executor failed'));
    const result = await manager.execute(
      { name: 'test', description: 'Test' },
      {},
      createMockToolContext(),
      executor
    );

    expect(result.title).toBe('Error');
    expect(result.output).toContain('Executor failed');
  });
});
