import { describe, it, expect } from 'vitest';
import { ModelFactory } from '../src/model-factory.js';
import type { ModelGateway } from '@agentforge/sdk';

function mockGateway(name: string, models: string[]): ModelGateway {
  return {
    name,
    canResolve: (s: string) => models.includes(s),
    resolve: async (s: string) => ({ modelId: s, resolvedBy: name } as unknown as Record<string, unknown>),
  };
}

describe('ModelFactory', () => {
  it('resolves model through registered gateway', async () => {
    const factory = new ModelFactory();
    factory.registerGateway(mockGateway('gw1', ['provider-a/model-x']));

    const model = await factory.resolve('provider-a/model-x');
    expect((model as unknown as { resolvedBy: string }).resolvedBy).toBe('gw1');
  });

  it('tries gateways in registration order (first match wins)', async () => {
    const factory = new ModelFactory();
    factory.registerGateway(mockGateway('gw1', ['shared/model']));
    factory.registerGateway(mockGateway('gw2', ['shared/model']));

    const model = await factory.resolve('shared/model');
    expect((model as unknown as { resolvedBy: string }).resolvedBy).toBe('gw1');
  });

  it('throws when no gateway can resolve', async () => {
    const factory = new ModelFactory();
    await expect(factory.resolve('unknown/model')).rejects.toThrow(/no gateway/i);
  });

  it('instances are independent — no shared state', async () => {
    const factory1 = new ModelFactory();
    const factory2 = new ModelFactory();
    factory1.registerGateway(mockGateway('gw1', ['a/x']));

    await expect(factory1.resolve('a/x')).resolves.toBeDefined();
    await expect(factory2.resolve('a/x')).rejects.toThrow(/no gateway/i);
  });

  it('registerProvider adds gateway for custom providers', async () => {
    const factory = new ModelFactory();
    factory.registerProvider('my-custom', ((modelId: string) => ({
      modelId,
      specificationVersion: 'v2' as const,
      provider: 'my-custom',
      supportedUrls: {},
      doGenerate: async () => ({ text: `custom:${modelId}` } as unknown as Record<string, unknown>),
      doStream: async () => ({ stream: new ReadableStream() } as unknown as Record<string, unknown>),
    })) as any);

    const model = await factory.resolve('my-custom/test-model');
    expect((model as unknown as { modelId: string }).modelId).toBe('test-model');
  });

  it('can add built-in gateway after construction', async () => {
    const factory = new ModelFactory();
    factory.registerGateway(mockGateway('builtin', ['test/model']));

    const model = await factory.resolve('test/model');
    expect(model).toBeDefined();
  });
});
