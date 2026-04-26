/**
 * Model Pricing Table
 *
 * Default pricing data for common LLM models.
 * Prices are per 1M tokens in USD.
 *
 * @module
 */

/**
 * Pricing entry for a model
 */
export interface ModelPricing {
  /** Model identifier */
  model: string;
  /** Cost per 1M prompt tokens (USD) */
  promptPricePer1M: number;
  /** Cost per 1M completion tokens (USD) */
  completionPricePer1M: number;
}

/**
 * Default pricing table for common models.
 * Prices as of 2024 — update as needed.
 */
export const DEFAULT_PRICING: ModelPricing[] = [
  // OpenAI
  { model: 'gpt-4o', promptPricePer1M: 2.5, completionPricePer1M: 10.0 },
  { model: 'gpt-4o-mini', promptPricePer1M: 0.15, completionPricePer1M: 0.6 },
  { model: 'gpt-4-turbo', promptPricePer1M: 10.0, completionPricePer1M: 30.0 },
  { model: 'gpt-4', promptPricePer1M: 30.0, completionPricePer1M: 60.0 },
  { model: 'gpt-3.5-turbo', promptPricePer1M: 0.5, completionPricePer1M: 1.5 },

  // Anthropic
  { model: 'claude-3-5-sonnet', promptPricePer1M: 3.0, completionPricePer1M: 15.0 },
  { model: 'claude-3-5-haiku', promptPricePer1M: 0.8, completionPricePer1M: 4.0 },
  { model: 'claude-3-opus', promptPricePer1M: 15.0, completionPricePer1M: 75.0 },
  { model: 'claude-3-sonnet', promptPricePer1M: 3.0, completionPricePer1M: 15.0 },
  { model: 'claude-3-haiku', promptPricePer1M: 0.25, completionPricePer1M: 1.25 },
];

/**
 * Look up pricing for a model.
 *
 * Performs exact match first, then falls back to prefix match
 * (e.g., "gpt-4o-2024-01" matches "gpt-4o").
 *
 * @param model - Model identifier
 * @returns Pricing entry or null if unknown
 */
export function lookupPricing(model: string): ModelPricing | null {
  // Exact match
  const exact = DEFAULT_PRICING.find(p => p.model === model);
  if (exact) return exact;

  // Prefix match (e.g., "gpt-4o-2024-05-13" → "gpt-4o")
  const prefix = DEFAULT_PRICING.find(
    p => model.startsWith(p.model + '-') || model.startsWith(p.model + ':')
  );
  return prefix ?? null;
}

/**
 * Calculate cost for token usage given a model.
 *
 * @param model - Model identifier
 * @param promptTokens - Number of prompt tokens
 * @param completionTokens - Number of completion tokens
 * @returns Cost in USD, or null if model pricing unknown
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number | null {
  const pricing = lookupPricing(model);
  if (!pricing) return null;

  const promptCost = (promptTokens / 1_000_000) * pricing.promptPricePer1M;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionPricePer1M;

  return promptCost + completionCost;
}
