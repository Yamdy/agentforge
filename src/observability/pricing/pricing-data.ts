/**
 * Model Pricing Data
 *
 * Hardcoded pricing table for ~50 mainstream models.
 * Prices are per 1M tokens (USD). Cache read/write prices included where available.
 * Updated with framework releases.
 *
 * @module observability/pricing/pricing-data
 */

// ============================================================
// Types
// ============================================================

export interface ModelPricing {
  /** Price per 1M input/prompt tokens (USD) */
  inputPrice: number;
  /** Price per 1M output/completion tokens (USD) */
  outputPrice: number;
  /** Price per 1M cache read tokens (USD), if supported */
  cacheReadPrice?: number;
  /** Price per 1M cache write tokens (USD), if supported */
  cacheWritePrice?: number;
}

export interface PricingEntry {
  provider: string;
  model: string;
  pricing: ModelPricing;
}

// ============================================================
// Pricing Table
// ============================================================

const PRICING_TABLE: PricingEntry[] = [
  // ---- OpenAI ----
  {
    provider: 'openai',
    model: 'gpt-4o',
    pricing: { inputPrice: 2.5, outputPrice: 10, cacheReadPrice: 1.25 },
  },
  {
    provider: 'openai',
    model: 'gpt-4o-2024-08-06',
    pricing: { inputPrice: 2.5, outputPrice: 10, cacheReadPrice: 1.25 },
  },
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    pricing: { inputPrice: 0.15, outputPrice: 0.6, cacheReadPrice: 0.075 },
  },
  { provider: 'openai', model: 'gpt-4-turbo', pricing: { inputPrice: 10, outputPrice: 30 } },
  { provider: 'openai', model: 'gpt-4', pricing: { inputPrice: 30, outputPrice: 60 } },
  { provider: 'openai', model: 'gpt-4-32k', pricing: { inputPrice: 60, outputPrice: 120 } },
  { provider: 'openai', model: 'gpt-3.5-turbo', pricing: { inputPrice: 0.5, outputPrice: 1.5 } },
  {
    provider: 'openai',
    model: 'gpt-3.5-turbo-0125',
    pricing: { inputPrice: 0.5, outputPrice: 1.5 },
  },
  {
    provider: 'openai',
    model: 'gpt-4.1',
    pricing: { inputPrice: 2, outputPrice: 8, cacheReadPrice: 0.5 },
  },
  {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    pricing: { inputPrice: 0.4, outputPrice: 1.6, cacheReadPrice: 0.1 },
  },
  {
    provider: 'openai',
    model: 'gpt-4.1-nano',
    pricing: { inputPrice: 0.1, outputPrice: 0.4, cacheReadPrice: 0.025 },
  },
  {
    provider: 'openai',
    model: 'o1',
    pricing: { inputPrice: 15, outputPrice: 60, cacheReadPrice: 7.5 },
  },
  {
    provider: 'openai',
    model: 'o1-mini',
    pricing: { inputPrice: 1.1, outputPrice: 4.4, cacheReadPrice: 0.55 },
  },
  {
    provider: 'openai',
    model: 'o3',
    pricing: { inputPrice: 10, outputPrice: 40, cacheReadPrice: 2.5 },
  },
  {
    provider: 'openai',
    model: 'o3-mini',
    pricing: { inputPrice: 1.1, outputPrice: 4.4, cacheReadPrice: 0.55 },
  },
  {
    provider: 'openai',
    model: 'o4-mini',
    pricing: { inputPrice: 1.1, outputPrice: 4.4, cacheReadPrice: 0.275 },
  },

  // ---- Anthropic ----
  {
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
    pricing: { inputPrice: 15, outputPrice: 75, cacheReadPrice: 3.75, cacheWritePrice: 7.5 },
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    pricing: { inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.75, cacheWritePrice: 1.5 },
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    pricing: { inputPrice: 0.8, outputPrice: 4, cacheReadPrice: 0.08, cacheWritePrice: 0.4 },
  },
  {
    provider: 'anthropic',
    model: 'claude-opus-4',
    pricing: { inputPrice: 15, outputPrice: 75, cacheReadPrice: 3.75, cacheWritePrice: 7.5 },
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    pricing: { inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.75, cacheWritePrice: 1.5 },
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    pricing: { inputPrice: 0.8, outputPrice: 4, cacheReadPrice: 0.08, cacheWritePrice: 0.4 },
  },
  {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    pricing: { inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.75, cacheWritePrice: 1.5 },
  },
  {
    provider: 'anthropic',
    model: 'claude-3-5-haiku',
    pricing: { inputPrice: 0.8, outputPrice: 4, cacheReadPrice: 0.08, cacheWritePrice: 0.4 },
  },

  // ---- Google ----
  { provider: 'google', model: 'gemini-2.5-pro', pricing: { inputPrice: 1.25, outputPrice: 10 } },
  {
    provider: 'google',
    model: 'gemini-2.5-flash',
    pricing: { inputPrice: 0.15, outputPrice: 0.6 },
  },
  { provider: 'google', model: 'gemini-2.0-flash', pricing: { inputPrice: 0.1, outputPrice: 0.4 } },
  {
    provider: 'google',
    model: 'gemini-2.0-flash-lite',
    pricing: { inputPrice: 0.075, outputPrice: 0.3 },
  },
  { provider: 'google', model: 'gemini-1.5-pro', pricing: { inputPrice: 1.25, outputPrice: 5 } },
  {
    provider: 'google',
    model: 'gemini-1.5-flash',
    pricing: { inputPrice: 0.075, outputPrice: 0.3 },
  },

  // ---- DeepSeek ----
  { provider: 'deepseek', model: 'deepseek-chat', pricing: { inputPrice: 0.27, outputPrice: 1.1 } },
  {
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    pricing: { inputPrice: 0.55, outputPrice: 2.19, cacheReadPrice: 0.14 },
  },

  // ---- xAI / Grok ----
  { provider: 'xai', model: 'grok-3', pricing: { inputPrice: 5, outputPrice: 15 } },
  { provider: 'xai', model: 'grok-3-mini', pricing: { inputPrice: 0.3, outputPrice: 0.5 } },

  // ---- Meta / Llama (via providers) ----
  { provider: 'groq', model: 'llama-3.3-70b', pricing: { inputPrice: 0.59, outputPrice: 0.79 } },
  { provider: 'groq', model: 'llama-3.1-8b', pricing: { inputPrice: 0.05, outputPrice: 0.08 } },
  { provider: 'groq', model: 'mixtral-8x7b', pricing: { inputPrice: 0.24, outputPrice: 0.24 } },
  { provider: 'groq', model: 'gemma2-9b-it', pricing: { inputPrice: 0.2, outputPrice: 0.2 } },

  // ---- Mistral ----
  { provider: 'mistral', model: 'mistral-large', pricing: { inputPrice: 2, outputPrice: 6 } },
  { provider: 'mistral', model: 'mistral-medium', pricing: { inputPrice: 2.7, outputPrice: 8.1 } },
  { provider: 'mistral', model: 'mistral-small', pricing: { inputPrice: 1, outputPrice: 3 } },
  { provider: 'mistral', model: 'codestral', pricing: { inputPrice: 0.3, outputPrice: 0.9 } },

  // ---- Cohere ----
  { provider: 'cohere', model: 'command-r-plus', pricing: { inputPrice: 2.5, outputPrice: 10 } },
  { provider: 'cohere', model: 'command-r', pricing: { inputPrice: 0.5, outputPrice: 1.5 } },

  // ---- AI21 ----
  { provider: 'ai21', model: 'jamba-1.5-large', pricing: { inputPrice: 2, outputPrice: 8 } },
  { provider: 'ai21', model: 'jamba-1.5-mini', pricing: { inputPrice: 0.2, outputPrice: 0.4 } },
];

// ============================================================
// Lookup
// ============================================================

const pricingMap = new Map<string, ModelPricing>();

function buildKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

// Build index on first import
for (const entry of PRICING_TABLE) {
  pricingMap.set(buildKey(entry.provider, entry.model), entry.pricing);
}

/**
 * Get pricing information for a model.
 * Returns undefined when pricing data is not available for this model.
 *
 * @param provider - Provider identifier (e.g., 'openai', 'anthropic')
 * @param model - Model name (e.g., 'gpt-4o', 'claude-sonnet-4')
 */
export function getModelPricing(provider: string, model: string): ModelPricing | undefined {
  return pricingMap.get(buildKey(provider, model));
}

/**
 * Calculate cost for a given token usage.
 * Returns 0 when pricing is unavailable.
 */
export function calculateCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const pricing = getModelPricing(provider, model);
  if (!pricing) return 0;

  let cost = 0;
  cost += (promptTokens / 1_000_000) * pricing.inputPrice;
  cost += (completionTokens / 1_000_000) * pricing.outputPrice;
  if (cacheReadTokens > 0 && pricing.cacheReadPrice !== undefined) {
    cost += (cacheReadTokens / 1_000_000) * pricing.cacheReadPrice;
  }
  if (cacheWriteTokens > 0 && pricing.cacheWritePrice !== undefined) {
    cost += (cacheWriteTokens / 1_000_000) * pricing.cacheWritePrice;
  }
  return cost;
}

/**
 * Cache savings: what would have been spent on full-price input tokens,
 * minus what was actually spent on cache reads.
 */
export function calculateCacheSavings(
  provider: string,
  model: string,
  cacheReadTokens: number
): number {
  const pricing = getModelPricing(provider, model);
  if (!pricing || pricing.cacheReadPrice === undefined) return 0;

  const fullPrice = (cacheReadTokens / 1_000_000) * pricing.inputPrice;
  const cachePrice = (cacheReadTokens / 1_000_000) * pricing.cacheReadPrice;
  return fullPrice - cachePrice;
}
