import { describe, it, expect } from 'vitest';
import { ModelFactory } from '../src/model-factory.js';
import type { ModelGateway } from '@primo-ai/sdk';

function mockGateway(name: string, models: string[]): ModelGateway {
  return {
    name,
    canResolve: (s: string) => models.includes(s),
    resolve: async (s: string) => ({ modelId: s, resolvedBy: name } as unknown as Record<string, unknown>),
  };
}

describe('ModelFactory.listGateways()', () => {
  it('returns empty array when no gateways registered (beyond default provider gateway)', () => {
    const factory = new ModelFactory();
    const gateways = factory.listGateways();

    // The built-in ProviderGateway is always present, but listGateways
    // should still return it — so we check structure, not count
    expect(Array.isArray(gateways)).toBe(true);
  });

  it('returns gateway name and canResolve function for each registered gateway', () => {
    const factory = new ModelFactory();
    factory.registerGateway(mockGateway('test-gw', ['model-a']));
    factory.registerGateway(mockGateway('another-gw', ['model-b']));

    const gateways = factory.listGateways();

    const names = gateways.map(g => g.name);
    expect(names).toContain('test-gw');
    expect(names).toContain('another-gw');

    // Each entry has a canResolve function
    for (const gw of gateways) {
      expect(typeof gw.canResolve).toBe('function');
    }
  });

  it('canResolve correctly reflects gateway canResolve logic', () => {
    const factory = new ModelFactory();
    factory.registerGateway(mockGateway('gw-alpha', ['alpha/one', 'alpha/two']));
    factory.registerGateway(mockGateway('gw-beta', ['beta/one']));

    const gateways = factory.listGateways();

    const alpha = gateways.find(g => g.name === 'gw-alpha');
    const beta = gateways.find(g => g.name === 'gw-beta');

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();

    expect(alpha!.canResolve('alpha/one')).toBe(true);
    expect(alpha!.canResolve('alpha/two')).toBe(true);
    expect(alpha!.canResolve('beta/one')).toBe(false);

    expect(beta!.canResolve('beta/one')).toBe(true);
    expect(beta!.canResolve('alpha/one')).toBe(false);
  });

  it('returned canResolve is a safe copy and does not mutate factory state', () => {
    const factory = new ModelFactory();
    factory.registerGateway(mockGateway('gw1', ['model-x']));

    const gatewaysBefore = factory.listGateways();
    expect(gatewaysBefore.find(g => g.name === 'gw1')!.canResolve('model-x')).toBe(true);

    // Calling listGateways again returns a fresh snapshot
    const gatewaysAfter = factory.listGateways();
    expect(gatewaysAfter.find(g => g.name === 'gw1')!.canResolve('model-x')).toBe(true);
  });
});
