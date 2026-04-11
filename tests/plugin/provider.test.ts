import { describe, it, expect, vi } from 'vitest';
import { PluginManager } from '../../src/plugin/manager.js';
import type { Plugin, ProviderContext, ProviderResult } from '../../src/plugin/types.js';
import { AIAdapter } from '../../src/adapters/ai.js';

describe('Plugin Provider', () => {
  describe('collectProviders', () => {
    it('should collect provider results from plugins', async () => {
      const providerResult: ProviderResult = {
        baseURL: 'https://api.example.com/v1',
        headers: { 'x-auth-token': 'test-token' },
        timeout: { total: 60000 },
        tlsRejectUnauthorized: false,
      };

      const plugin: Plugin = {
        name: 'test-provider',
        version: '1.0.0',
        async provider(_ctx) {
          return providerResult;
        },
      };

      const manager = new PluginManager({ plugins: [plugin] });
      const results = await manager.collectProviders({
        model: 'gpt-4o',
        apiKey: 'key',
      });

      expect(results).toHaveLength(1);
      expect(results[0].baseURL).toBe('https://api.example.com/v1');
      expect(results[0].headers?.['x-auth-token']).toBe('test-token');
    });

    it('should skip plugins without provider', async () => {
      const plugin: Plugin = {
        name: 'no-provider',
        hooks: {},
      };

      const manager = new PluginManager({ plugins: [plugin] });
      const results = await manager.collectProviders({
        model: 'gpt-4o',
      });

      expect(results).toHaveLength(0);
    });

    it('should handle provider errors gracefully', async () => {
      const plugin: Plugin = {
        name: 'failing-provider',
        async provider() {
          throw new Error('Provider failed');
        },
      };

      const manager = new PluginManager({ plugins: [plugin] });
      const results = await manager.collectProviders({
        model: 'gpt-4o',
      });

      expect(results).toHaveLength(0);
    });

    it('should collect from multiple plugins', async () => {
      const plugin1: Plugin = {
        name: 'provider-1',
        async provider() {
          return { baseURL: 'https://api1.example.com' };
        },
      };
      const plugin2: Plugin = {
        name: 'provider-2',
        async provider() {
          return { headers: { 'x-custom': 'value' } };
        },
      };

      const manager = new PluginManager({ plugins: [plugin1, plugin2] });
      const results = await manager.collectProviders({ model: 'gpt-4o' });

      expect(results).toHaveLength(2);
    });

    it('should pass ProviderContext to provider function', async () => {
      let receivedCtx: ProviderContext | undefined;
      const plugin: Plugin = {
        name: 'context-check',
        async provider(ctx) {
          receivedCtx = ctx;
          return {};
        },
      };

      const manager = new PluginManager({ plugins: [plugin] });
      await manager.collectProviders({
        model: 'gpt-4o',
        apiKey: 'test-key',
        baseURL: 'https://default.example.com',
      });

      expect(receivedCtx?.model).toBe('gpt-4o');
      expect(receivedCtx?.apiKey).toBe('test-key');
      expect(receivedCtx?.baseURL).toBe('https://default.example.com');
    });
  });

  describe('AIAdapter with provider results', () => {
    it('should accept interceptors from setInterceptors', () => {
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
      });

      adapter.setInterceptors([
        {
          beforeRequest(ctx) {
            ctx.headers['x-injected'] = 'from-interceptor';
            return ctx;
          },
        },
      ]);

      expect(adapter).toBeDefined();
    });

    it('should accept fetch from provider result', () => {
      const customFetch = vi.fn();
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        fetch: customFetch,
      });

      expect(adapter).toBeDefined();
    });
  });
});
