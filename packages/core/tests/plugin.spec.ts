import { describe, it, expect, vi } from 'vitest';
import { executePluginHook } from '../src/plugin.js';
import type { Plugin } from '../src/types.js';

describe('executePluginHook', () => {
  it('executes plugins in registration order', async () => {
    const order: number[] = [];
    const plugins: Plugin[] = [
      {
        name: 'a',
        transformRequest: async (req) => {
          order.push(1);
          return req;
        },
      },
      {
        name: 'b',
        transformRequest: async (req) => {
          order.push(2);
          return req;
        },
      },
    ];

    await executePluginHook(plugins, 'transformRequest', { messages: [] });
    expect(order).toEqual([1, 2]);
  });

  it('return value flows through plugins', async () => {
    const plugins: Plugin[] = [
      {
        name: 'a',
        transformRequest: async (req) => ({ ...req, a: 1 }),
      },
      {
        name: 'b',
        transformRequest: async (req) => ({ ...req, b: 2 }),
      },
    ];

    const result = await executePluginHook(plugins, 'transformRequest', {
      messages: [],
    });
    expect(result).toEqual({ messages: [], a: 1, b: 2 });
  });

  it('plugin without a specific hook is skipped', async () => {
    const plugins: Plugin[] = [
      {
        name: 'a',
        transformRequest: async (req) => ({ ...req, a: 1 }),
      },
      { name: 'b' },
      {
        name: 'c',
        transformRequest: async (req) => ({ ...req, c: 3 }),
      },
    ];

    const result = await executePluginHook(plugins, 'transformRequest', {
      messages: [],
    });
    expect(result).toEqual({ messages: [], a: 1, c: 3 });
  });

  it('if a plugin throws, continues with value before the failing plugin', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const plugins: Plugin[] = [
      {
        name: 'a',
        transformRequest: async (req) => ({ ...req, a: 1 }),
      },
      {
        name: 'b',
        transformRequest: async (_req) => {
          throw new Error('fail');
        },
      },
      {
        name: 'c',
        transformRequest: async (req) => ({ ...req, c: 3 }),
      },
    ];

    const result = await executePluginHook(plugins, 'transformRequest', {
      messages: [],
    });
    // Plugin B throws, so plugin C still sees plugin A's output
    expect(result).toEqual({ messages: [], a: 1, c: 3 });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('transformRequest that returns invalid value (missing messages) gets reverted to original', async () => {
    const plugins: Plugin[] = [
      {
        name: 'a',
        transformRequest: async (req) => ({ ...req, a: 1 }),
      },
      {
        name: 'b',
        transformRequest: async (_req) => ({ noMessages: true }),
      },
      {
        name: 'c',
        transformRequest: async (req) => ({ ...req, c: 3 }),
      },
    ];

    // Plugin B returns invalid (no `messages`), so plugin C should see plugin A's output
    const result = await executePluginHook(plugins, 'transformRequest', {
      messages: [],
    });
    expect(result).toEqual({ messages: [], a: 1, c: 3 });
  });

  it('null and false pass through as raw values', async () => {
    const plugins: Plugin[] = [
      {
        name: 'return-null',
        transformRequest: async () => null,
      },
    ];

    const result = await executePluginHook(plugins, 'transformRequest', {
      messages: [],
    });
    expect(result).toBeNull();
  });
});
