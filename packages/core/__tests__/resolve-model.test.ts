import { describe, it, expect, beforeEach } from 'vitest';
import type { LanguageModel } from 'ai';
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
    registerProvider('test', ((modelId: string) => ({
      modelId,
      specificationVersion: 'v2' as const,
      provider: 'test',
      supportedUrls: {},
      doGenerate: async () => ({ text: `mock:${modelId}` }),
      doStream: async () => ({ stream: new ReadableStream() }),
    })) as unknown as (modelId: string) => LanguageModel);
  });

  it('resolves a manually registered provider', async () => {
    const model = await resolveModel('test/my-model');
    expect((model as unknown as { modelId: string }).modelId).toBe('my-model');
  });

  it('throws on unknown provider', async () => {
    await expect(resolveModel('unknown/model')).rejects.toThrow(/unknown provider/i);
  });

  it('throws on invalid model string', async () => {
    await expect(resolveModel('invalid')).rejects.toThrow(/invalid model string/i);
  });

  it('registered provider takes priority over built-in', async () => {
    registerProvider('openai', ((modelId: string) => ({
      modelId,
      specificationVersion: 'v2' as const,
      provider: 'custom-openai',
      supportedUrls: {},
      doGenerate: async () => ({ text: 'custom' }),
      doStream: async () => ({ stream: new ReadableStream() }),
    })) as unknown as (modelId: string) => LanguageModel);

    const model = await resolveModel('openai/gpt-test');
    expect((model as unknown as { provider: string }).provider).toBe('custom-openai');
  });
});
