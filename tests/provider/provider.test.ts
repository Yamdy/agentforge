import { describe, it, expect } from 'vitest';
import { Provider as ProviderAPI, providerRegistry } from '../../src/provider/index.js';
import { anthropicProvider } from '../../src/provider/providers/anthropic.js';
import { openaiProvider } from '../../src/provider/providers/openai.js';
import { ollamaProvider } from '../../src/provider/providers/ollama.js';

describe('Provider System', () => {
  describe('Provider Registry', () => {
    it('should list available providers', () => {
      const providers = ProviderAPI.list();
      expect(providers.length).toBeGreaterThan(5);
      expect(providers.find((p) => p.id === 'anthropic')).toBeDefined();
      expect(providers.find((p) => p.id === 'openai')).toBeDefined();
      expect(providers.find((p) => p.id === 'ollama')).toBeDefined();
    });

    it('should get specific provider', () => {
      const anthropic = ProviderAPI.get('anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic?.name).toBe('Anthropic');

      const openai = ProviderAPI.get('openai');
      expect(openai).toBeDefined();
      expect(openai?.name).toBe('OpenAI');
    });

    it('should return undefined for unknown provider', () => {
      const unknown = ProviderAPI.get('unknown-provider');
      expect(unknown).toBeUndefined();
    });
  });

  describe('Model Creation', () => {
    it('should throw for unknown provider', () => {
      expect(() => {
        ProviderAPI.model('unknown-provider', 'some-model');
      }).toThrow('Provider not found');
    });
  });

  describe('Anthropic Provider', () => {
    it('should have correct provider id and name', () => {
      expect(anthropicProvider.id).toBe('anthropic');
      expect(anthropicProvider.name).toBe('Anthropic');
    });

    it('should list available models', async () => {
      const models = await anthropicProvider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.find((m) => m.id === 'claude-sonnet-4-20250514')).toBeDefined();
    });

    it('should get specific model info', async () => {
      const model = await anthropicProvider.getModel('claude-sonnet-4-20250514');
      expect(model).toBeDefined();
      expect(model?.displayName).toBe('Claude Sonnet 4');
      expect(model?.capabilities.toolCall).toBe(true);
      expect(model?.capabilities.reasoning).toBe(true);
    });

    it('should return null for unknown model', async () => {
      const model = await anthropicProvider.getModel('unknown-model');
      expect(model).toBeNull();
    });

    it('should validate config correctly', () => {
      // Without API key, should return false (unless ANTHROPIC_API_KEY is set)
      const result = anthropicProvider.validateConfig();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('OpenAI Provider', () => {
    it('should have correct provider id and name', () => {
      expect(openaiProvider.id).toBe('openai');
      expect(openaiProvider.name).toBe('OpenAI');
    });

    it('should list available models', async () => {
      const models = await openaiProvider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.find((m) => m.id === 'gpt-4o')).toBeDefined();
      expect(models.find((m) => m.id === 'gpt-4o-mini')).toBeDefined();
    });

    it('should return model capabilities', async () => {
      const model = await openaiProvider.getModel('gpt-4o');
      expect(model).toBeDefined();
      expect(model?.capabilities.toolCall).toBe(true);
      expect(model?.capabilities.vision).toBe(true);
    });
  });

  describe('Ollama Provider', () => {
    it('should have correct provider id and name', () => {
      expect(ollamaProvider.id).toBe('ollama');
      expect(ollamaProvider.name).toBe('Ollama');
    });

    it('should always be valid (local)', () => {
      expect(ollamaProvider.validateConfig()).toBe(true);
    });

    it('should list available models', async () => {
      const models = await ollamaProvider.listModels();
      expect(models.length).toBeGreaterThan(0);
    });

    it('should have zero pricing (local)', async () => {
      const model = await ollamaProvider.getModel('llama3.2');
      expect(model?.pricing.input).toBe(0);
      expect(model?.pricing.output).toBe(0);
    });
  });

  describe('Model Search', () => {
    it('should find model by query', async () => {
      const model = await ProviderAPI.findModel('claude sonnet');
      expect(model).toBeDefined();
      expect(model?.providerId).toBe('anthropic');
    });

    it('should find model by exact ID', async () => {
      const model = await ProviderAPI.findModel('gpt-4o');
      expect(model).toBeDefined();
      expect(model?.id).toBe('gpt-4o');
    });

    it('should return null for unknown model', async () => {
      const model = await ProviderAPI.findModel('totally-unknown-model-xyz');
      expect(model).toBeNull();
    });
  });

  describe('List All Models', () => {
    it('should list models from all providers', async () => {
      const models = await ProviderAPI.listModels();
      expect(models.length).toBeGreaterThan(10);

      // Should have models from multiple providers
      const providerIds = new Set(models.map((m) => m.providerId));
      expect(providerIds.size).toBeGreaterThan(1);
    });
  });
});
