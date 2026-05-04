/**
 * AgentForge LLM Adapters
 *
 * Factory and implementations for LLM providers.
 * Full implementations use AI SDK packages (@ai-sdk/openai, @ai-sdk/anthropic).
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import type { LLMAdapter, LLMResponse } from '../core/interfaces.js';
import { ProviderRegistry, type ProviderFactory } from './adapter-system.js';

// ============================================================
// Re-export Adapter System (NEW)
// ============================================================

export {
  // Core adapter system
  ProviderRegistry,
  createHttpAdapter,
  createLLMAdapterFromSpec,

  // Error classification
  classifyError,
  type ClassifiedError,
  type ErrorCategory,

  // Retry policy
  calculateRetryDelay,
  type RetryConfig,

  // Types
  type ProviderFactory,
  type HttpAdapterOptions,
} from './adapter-system.js';

// ============================================================
// Re-export Adapter Implementations
// ============================================================

// OpenAI Adapter (AI SDK v6)
export {
  OpenAIAdapter,
  createOpenAIAdapter,
  openaiAdapterFactory,
  type OpenAIAdapterOptions,
} from './openai.js';

// OpenAI HTTP Adapter (direct HTTP, supports v1 models)
export { createOpenAIHttpAdapter, type OpenAIHttpAdapterOptions } from './openai-http.js';

// Anthropic Adapter
export {
  AnthropicAdapter,
  createAnthropicAdapter,
  anthropicAdapterFactory,
  type AnthropicAdapterOptions,
} from './anthropic.js';

// Google Adapter (AI SDK v6)
export {
  GoogleAdapter,
  createGoogleAdapter,
  googleAdapterFactory,
  type GoogleAdapterOptions,
} from './google.js';

// Ollama Adapter (AI SDK v6)
export {
  OllamaAdapter,
  createOllamaAdapter,
  ollamaAdapterFactory,
  type OllamaAdapterOptions,
} from './ollama.js';

// ============================================================
// Factory Types
// ============================================================

export interface ParsedModelSpec {
  provider: string;
  model: string;
}

export type AdapterFactoryFn = (model: string, options: Record<string, unknown>) => LLMAdapter;

// ============================================================
// Model Spec Parser
// ============================================================

export function parseModelSpec(spec: string): ParsedModelSpec {
  const slashIndex = spec.indexOf('/');
  if (slashIndex !== -1) {
    return {
      provider: spec.slice(0, slashIndex),
      model: spec.slice(slashIndex + 1),
    };
  }

  const detected = detectProviderFromModel(spec);
  return { provider: detected ?? 'openai-compatible', model: spec };
}

export function detectProviderFromModel(model: string): string | null {
  const patterns: [RegExp, string][] = [
    [/^gpt-/, 'openai'],
    [/^o1-/, 'openai'],
    [/^o3-/, 'openai'],
    [/^claude-/, 'anthropic'],
    [/^gemini-/, 'google'],
    [/^mistral-/, 'mistral'],
    [/^deepseek-/, 'deepseek'],
    [/^glm-/, 'zhipu'],
    [/^qwen-/, 'qwen'],
  ];

  for (const [pattern, provider] of patterns) {
    if (pattern.test(model)) {
      return provider;
    }
  }

  return null;
}

// ============================================================
// Provider Registry
// ============================================================

export const PROVIDER_API_KEY_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
};

export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
};

// ============================================================
// LLM Adapter Factory
// ============================================================

/**
 * LLM Adapter Factory
 *
 * Creates LLM adapter instances based on model specification.
 * Supports both built-in adapters (OpenAI, Anthropic) and custom registrations.
 *
 * @example
 * ```typescript
 * const factory = getLLMAdapterFactory();
 *
 * // Using provider/model format
 * const openaiAdapter = factory.create('openai/gpt-4o');
 * const anthropicAdapter = factory.create('anthropic/claude-3-5-sonnet');
 *
 * // Using auto-detection
 * const autoAdapter = factory.create('gpt-4o-mini'); // → OpenAI
 *
 * // With options
 * const customAdapter = factory.create('openai/gpt-4o', {
 *   apiKey: process.env.CUSTOM_KEY,
 *   baseURL: 'https://custom-endpoint.com/v1',
 * });
 * ```
 */
export class LLMAdapterFactoryImpl {
  private initialized = false;
  private _registry: ProviderRegistry;

  constructor() {
    this._registry = new ProviderRegistry();
  }

  private get registry(): ProviderRegistry {
    return this._registry;
  }

  /**
   * Initialize built-in adapter factories
   *
   * This is called lazily to allow the module to be imported
   * even when AI SDK packages are not installed.
   */
  private initializeBuiltins(): void {
    if (this.initialized) return;

    const require = createRequire(import.meta.url);

    // Try to register OpenAI adapter
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { openaiAdapterFactory } = require('./openai.js') as {
        openaiAdapterFactory: AdapterFactoryFn;
      };
      this.registry.register('openai', openaiAdapterFactory as ProviderFactory);
    } catch {
      // @ai-sdk/openai not installed
    }

    // Try to register Anthropic adapter
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { anthropicAdapterFactory } = require('./anthropic.js') as {
        anthropicAdapterFactory: AdapterFactoryFn;
      };
      this.registry.register('anthropic', anthropicAdapterFactory as ProviderFactory);
    } catch {
      // @ai-sdk/anthropic not installed
    }

    // Try to register Google adapter
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { googleAdapterFactory } = require('./google.js') as {
        googleAdapterFactory: AdapterFactoryFn;
      };
      this.registry.register('google', googleAdapterFactory as ProviderFactory);
    } catch {
      // @ai-sdk/google not installed
    }

    // Try to register Ollama adapter
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ollamaAdapterFactory } = require('./ollama.js') as {
        ollamaAdapterFactory: AdapterFactoryFn;
      };
      this.registry.register('ollama', ollamaAdapterFactory as ProviderFactory);
    } catch {
      // ai-sdk-ollama not installed
    }

    this.initialized = true;
  }

  /**
   * Create an LLM adapter from model specification
   */
  create(spec: string, options?: Record<string, unknown>): LLMAdapter {
    this.initializeBuiltins();

    const { provider, model } = parseModelSpec(spec);
    const factory = this.registry.get(provider);

    if (factory) {
      return factory(model, options);
    }

    return this.createStubAdapter(provider, model);
  }

  /**
   * Register a custom adapter factory (delegates to ProviderRegistry)
   */
  register(provider: string, factory: AdapterFactoryFn): void {
    this.registry.register(provider, factory as ProviderFactory);
  }

  /**
   * List available providers (known + registered)
   */
  listProviders(): string[] {
    const known = ['openai', 'anthropic', 'google', 'deepseek', 'zhipu', 'ollama'];
    const registered = this.registry.list();
    const merged = new Set([...known, ...registered]);
    return Array.from(merged);
  }

  /**
   * Check if a provider is registered
   */
  hasProvider(provider: string): boolean {
    return this.registry.has(provider);
  }

  /**
   * Create a stub adapter that throws on use
   */
  private createStubAdapter(provider: string, model: string): LLMAdapter {
    return {
      name: `${provider}-stub`,
      provider,
      chat: (): Promise<LLMResponse> => {
        throw new Error(
          `LLM adapter not implemented for ${provider}/${model}. ` +
            `Install @ai-sdk/${provider} and register a factory.`
        );
      },
      async *stream() {
        // No streaming support
      },
    };
  }
}

// ============================================================
// Factory Functions (no global singleton — each caller creates its own)
// ============================================================

export function getLLMAdapterFactory(): LLMAdapterFactoryImpl {
  return new LLMAdapterFactoryImpl();
}

export function createLLMAdapter(
  spec: string,
  options?: Record<string, unknown>,
  factory?: LLMAdapterFactoryImpl
): LLMAdapter {
  return (factory ?? getLLMAdapterFactory()).create(spec, options);
}

// ============================================================
// Convenience Adapter Creators
// ============================================================

/**
 * Create OpenAI adapter
 *
 * @param model - Model name (e.g., 'gpt-4o', 'gpt-4o-mini')
 * @param options - OpenAI-specific options
 */
export function createOpenAIAdapterFromFactory(
  model: string,
  options?: Record<string, unknown>,
  factory?: LLMAdapterFactoryImpl
): LLMAdapter {
  return (factory ?? getLLMAdapterFactory()).create(`openai/${model}`, options);
}

/**
 * Create Anthropic adapter
 *
 * @param model - Model name (e.g., 'claude-3-5-sonnet-20241022')
 * @param options - Anthropic-specific options
 */
export function createAnthropicAdapterFromFactory(
  model: string,
  options?: Record<string, unknown>,
  factory?: LLMAdapterFactoryImpl
): LLMAdapter {
  return (factory ?? getLLMAdapterFactory()).create(`anthropic/${model}`, options);
}

/**
 * Create OpenAI-compatible adapter for custom endpoints
 *
 * @param provider - Provider name for identification
 * @param model - Model name
 * @param options - Options including baseURL and apiKey
 */
export function createOpenAICompatibleAdapter(
  provider: string,
  model: string,
  options?: Record<string, unknown>,
  factory?: LLMAdapterFactoryImpl
): LLMAdapter {
  return (factory ?? getLLMAdapterFactory()).create(`${provider}/${model}`, options);
}
