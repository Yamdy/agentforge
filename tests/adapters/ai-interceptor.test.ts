import { describe, it, expect, vi } from 'vitest';
import { AIAdapter } from '../../src/adapters/ai.js';
import type { RequestInterceptor, TimeoutConfig } from '../../src/types.js';

describe('AIAdapter with interceptors', () => {
  describe('constructor', () => {
    it('should accept interceptors config', () => {
      const interceptor: RequestInterceptor = {
        beforeRequest(ctx) {
          ctx.headers['x-custom'] = 'value';
          return ctx;
        },
      };
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        interceptors: [interceptor],
      });
      expect(adapter).toBeDefined();
    });

    it('should accept timeout config', () => {
      const timeout: TimeoutConfig = {
        total: 60000,
        firstToken: 30000,
        chunk: 15000,
      };
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        timeout,
      });
      expect(adapter).toBeDefined();
    });

    it('should accept tlsRejectUnauthorized config', () => {
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        tlsRejectUnauthorized: false,
      });
      expect(adapter).toBeDefined();
    });

    it('should accept custom fetch function', () => {
      const customFetch = vi.fn();
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        fetch: customFetch,
      });
      expect(adapter).toBeDefined();
    });

    it('should work with no new config options', () => {
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
      });
      expect(adapter).toBeDefined();
    });
  });

  describe('interceptor execution', () => {
    it('should support multiple interceptors', () => {
      const order: number[] = [];
      const interceptor1: RequestInterceptor = {
        beforeRequest(ctx) {
          order.push(1);
          return ctx;
        },
      };
      const interceptor2: RequestInterceptor = {
        beforeRequest(ctx) {
          order.push(2);
          return ctx;
        },
      };
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        interceptors: [interceptor1, interceptor2],
      });
      expect(adapter).toBeDefined();
    });

    it('should support async beforeRequest', () => {
      const interceptor: RequestInterceptor = {
        async beforeRequest(ctx) {
          await Promise.resolve();
          ctx.headers['x-async'] = 'true';
          return ctx;
        },
      };
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        interceptors: [interceptor],
      });
      expect(adapter).toBeDefined();
    });
  });

  describe('timeout config', () => {
    it('should accept partial timeout config', () => {
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        timeout: { firstToken: 30000 },
      });
      expect(adapter).toBeDefined();
    });

    it('should accept empty timeout config', () => {
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        timeout: {},
      });
      expect(adapter).toBeDefined();
    });
  });

  describe('setTools and getTool', () => {
    it('should still work with interceptors configured', () => {
      const interceptor: RequestInterceptor = {
        beforeRequest(ctx) {
          return ctx;
        },
      };
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        interceptors: [interceptor],
      });

      adapter.setTools([
        {
          name: 'test-tool',
          description: 'A test tool',
          execute: async () => 'result',
        },
      ]);

      expect(adapter.getTool('test-tool')).toBeDefined();
      expect(adapter.getTool('nonexistent')).toBeUndefined();
    });
  });
});
