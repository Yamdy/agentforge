import { describe, it, expect } from 'vitest';
import { GatewayChain, BuiltInGateway, OpenAICompatibleGateway } from '../src/model-resolver.js';
import type { ModelGateway } from '@primo-ai/sdk';

// ---------------------------------------------------------------------------
// GatewayChain
// ---------------------------------------------------------------------------

describe('GatewayChain', () => {
  it('throws when resolving with zero gateways', async () => {
    const chain = new GatewayChain();
    await expect(chain.resolve('any/model')).rejects.toThrow(/no gateway can resolve/i);
  });

  it('resolves via first matching gateway', async () => {
    const mockModel = { modelId: 'test', doGenerate: async () => ({}) };
    const gw: ModelGateway = {
      name: 'mock',
      canResolve: (s: string) => s.startsWith('mock/'),
      resolve: async () => mockModel,
    };
    const chain = new GatewayChain();
    chain.register(gw);
    const result = await chain.resolve('mock/test');
    expect(result).toBe(mockModel);
  });

  it('falls through to next gateway when first cannot resolve', async () => {
    const model2 = { modelId: 'second' };
    const gw1: ModelGateway = {
      name: 'gw1',
      canResolve: () => false,
      resolve: async () => ({}),
    };
    const gw2: ModelGateway = {
      name: 'gw2',
      canResolve: () => true,
      resolve: async () => model2,
    };
    const chain = new GatewayChain();
    chain.register(gw1);
    chain.register(gw2);
    const result = await chain.resolve('anything/model');
    expect(result).toBe(model2);
  });

  it('reports correct size', () => {
    const chain = new GatewayChain();
    expect(chain.size).toBe(0);
    chain.register({ name: 'a', canResolve: () => false, resolve: async () => ({}) });
    expect(chain.size).toBe(1);
  });

  it('throws when no gateway can resolve the model string', async () => {
    const gw: ModelGateway = {
      name: 'only-openai',
      canResolve: (s: string) => s.startsWith('openai/'),
      resolve: async () => ({}),
    };
    const chain = new GatewayChain();
    chain.register(gw);
    await expect(chain.resolve('anthropic/claude')).rejects.toThrow(/unknown provider/i);
  });
});

// ---------------------------------------------------------------------------
// BuiltInGateway
// ---------------------------------------------------------------------------

describe('BuiltInGateway', () => {
  it('canResolve returns true for known providers', () => {
    const gw = new BuiltInGateway();
    expect(gw.canResolve('openai/gpt-4o')).toBe(true);
    expect(gw.canResolve('anthropic/claude')).toBe(true);
    expect(gw.canResolve('google/gemini')).toBe(true);
    expect(gw.canResolve('deepseek/deepseek-v4')).toBe(true);
  });

  it('canResolve returns false for unknown providers', () => {
    const gw = new BuiltInGateway();
    expect(gw.canResolve('my-custom/model')).toBe(false);
    expect(gw.canResolve('unknown/thing')).toBe(false);
  });

  it('has name "builtin"', () => {
    expect(new BuiltInGateway().name).toBe('builtin');
  });

  it('instances have isolated custom providers', () => {
    const gw1 = new BuiltInGateway();
    const gw2 = new BuiltInGateway();

    const mockModel = {
      modelId: 'test',
      specificationVersion: 'v2' as const,
      provider: 'isolated',
      supportedUrls: {},
      doGenerate: async () => ({ text: 'ok' }),
      doStream: async () => ({ stream: new ReadableStream() }),
    };

    gw1.registerProvider('isolated-test', () => mockModel as any);

    expect(gw1.canResolve('isolated-test/model')).toBe(true);
    expect(gw2.canResolve('isolated-test/model')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpenAICompatibleGateway
// ---------------------------------------------------------------------------

describe('OpenAICompatibleGateway', () => {
  it('canResolve returns true when provider matches gateway name', () => {
    const gw = new OpenAICompatibleGateway({
      name: 'my-local',
      url: 'http://localhost:11434/v1',
    });
    expect(gw.canResolve('my-local/llama3')).toBe(true);
    expect(gw.canResolve('other/model')).toBe(false);
  });

  it('canResolve throws for invalid model string (no slash)', () => {
    const gw = new OpenAICompatibleGateway({
      name: 'my-local',
      url: 'http://localhost:11434/v1',
    });
    expect(() => gw.canResolve('noprovider')).toThrow(/invalid model string/i);
  });

  it('exposes name from config', () => {
    const gw = new OpenAICompatibleGateway({
      name: 'custom-endpoint',
      url: 'http://example.com/v1',
      apiKey: 'sk-test',
    });
    expect(gw.name).toBe('custom-endpoint');
  });

  it('handles gateway without apiKey', () => {
    const gw = new OpenAICompatibleGateway({
      name: 'no-key',
      url: 'http://localhost:9999/v1',
    });
    expect(gw.name).toBe('no-key');
  });
});
