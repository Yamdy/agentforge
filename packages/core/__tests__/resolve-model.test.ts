import { describe, it, expect, beforeEach } from 'vitest';
import { parseModel, resolveModel, registerProvider } from '../src/model-resolver.js';

describe('parseModel', () => {
  it('splits provider/model string on first slash', () => {
    expect(parseModel('openai/gpt-5')).toEqual({ provider: 'openai', modelId: 'gpt-5' });
  });

  it('handles model IDs with slashes (e.g. openrouter)', () => {
    expect(parseModel('openrouter/anthropic/claude-sonnet-4')).toEqual({
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4',
    });
  });

  it('throws on strings without a slash', () => {
    expect(() => parseModel('invalid')).toThrow(/invalid model string/i);
    expect(() => parseModel('')).toThrow(/invalid model string/i);
  });

  it('throws on empty provider or model', () => {
    expect(() => parseModel('/model')).toThrow(/invalid model string/i);
    expect(() => parseModel('provider/')).toThrow(/invalid model string/i);
  });
});

describe('resolveModel', () => {
  beforeEach(() => {
    // Register a test provider for unit tests (no real API calls)
    registerProvider('test', (modelId) => ({
      modelId,
      specificationVersion: 'v2' as const,
      provider: 'test',
      supportedUrls: {},
      doGenerate: async () => ({ text: `mock:${modelId}` } as any),
      doStream: async () => ({ stream: new ReadableStream() } as any),
    }));
  });

  it('resolves a manually registered provider', async () => {
    const model = await resolveModel('test/my-model');
    expect((model as any).modelId).toBe('my-model');
  });

  it('throws on unknown provider', async () => {
    await expect(resolveModel('unknown/model')).rejects.toThrow(/unknown provider/i);
  });

  it('throws on invalid model string', async () => {
    await expect(resolveModel('invalid')).rejects.toThrow(/invalid model string/i);
  });

  it('registered provider takes priority over built-in', async () => {
    registerProvider('openai', (modelId) => ({
      modelId,
      specificationVersion: 'v2' as const,
      provider: 'custom-openai',
      supportedUrls: {},
      doGenerate: async () => ({ text: 'custom' } as any),
      doStream: async () => ({ stream: new ReadableStream() } as any),
    }));

    const model = await resolveModel('openai/gpt-test');
    expect((model as any).provider).toBe('custom-openai');
  });
});
