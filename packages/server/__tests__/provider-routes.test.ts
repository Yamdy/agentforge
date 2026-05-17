import { describe, it, expect, vi } from 'vitest';
import { providerRoutes } from '../src/routes/providers.js';
import type { ModelFactory } from '@primo-ai/core';

function createMockModelFactory(overrides?: Partial<ModelFactory>): ModelFactory {
  return {
    resolve: vi.fn(),
    registerGateway: vi.fn(),
    registerProvider: vi.fn(),
    listGateways: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as ModelFactory;
}

describe('providerRoutes', () => {
  describe('GET /', () => {
    it('returns empty array when no model factory', async () => {
      const app = providerRoutes(undefined);
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('returns empty array when no gateways registered', async () => {
      const mf = createMockModelFactory();
      const app = providerRoutes(mf);
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('returns gateway names', async () => {
      const mf = createMockModelFactory({
        listGateways: vi.fn().mockReturnValue([
          { name: 'openai', canResolve: vi.fn() },
          { name: 'anthropic', canResolve: vi.fn() },
        ]),
      });
      const app = providerRoutes(mf);
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([{ name: 'openai' }, { name: 'anthropic' }]);
    });

    it('calls listGateways on the model factory', async () => {
      const listGateways = vi.fn().mockReturnValue([]);
      const mf = createMockModelFactory({ listGateways });
      const app = providerRoutes(mf);
      await app.request('/');
      expect(listGateways).toHaveBeenCalledOnce();
    });
  });
});
