/**
 * CostEstimationPlugin — Estimates and tracks LLM token costs.
 *
 * Subscribes to llm.request to remember the current model per session,
 * then calculates cost on llm.response using remembered model + pricing data.
 * Emits total cost gauge on agent.complete.
 *
 * @module plugins/cost-estimation-plugin
 */

import type { Plugin, PluginContext } from './plugin.js';
import type { AgentEvent } from '../core/events.js';
import type { Metrics } from '../core/interfaces.js';
import {
  getModelPricing,
  calculateCost,
  calculateCacheSavings,
} from '../observability/pricing/pricing-data.js';

// ============================================================
// Types
// ============================================================

export interface CostEstimationPluginOptions {
  /** Override pricing per model. Key: "provider:model", value: prices (per 1M tokens USD) */
  customPricing?: Record<
    string,
    { inputPrice: number; outputPrice: number; cacheReadPrice?: number; cacheWritePrice?: number }
  >;
  /** Default provider when model provider cannot be determined */
  defaultProvider?: string;
}

interface SessionCostState {
  model: { provider: string; model: string };
  cost: number;
}

// ============================================================
// Implementation
// ============================================================

export function createCostEstimationPlugin(options: CostEstimationPluginOptions = {}): Plugin {
  const { customPricing, defaultProvider = 'openai' } = options;

  let metrics: Metrics | undefined;
  let agentName = '';
  const sessionCosts = new Map<string, SessionCostState>();

  return {
    name: 'cost-estimation',
    enabled: true,

    init(ctx: PluginContext): void {
      metrics = ctx.metrics;
      agentName = ctx.agentName;
    },

    destroy(): void {
      metrics = undefined;
      sessionCosts.clear();
    },

    eventSubscriptions: [
      { event: 'llm.request', handler: handleLLMRequest },
      { event: 'llm.response', handler: handleLLMResponse },
      { event: 'agent.complete', handler: handleAgentComplete },
      { event: 'done', handler: handleDone },
    ],
  };

  function getSessionState(sessionId: string): SessionCostState | undefined {
    return sessionCosts.get(sessionId);
  }

  function handleLLMRequest(event: AgentEvent): void {
    if (event.type !== 'llm.request') return;
    // Remember model for this session so we can price it on response
    sessionCosts.set(event.sessionId, {
      model: event.model,
      cost: sessionCosts.get(event.sessionId)?.cost ?? 0,
    });
  }

  function handleLLMResponse(event: AgentEvent): void {
    if (event.type !== 'llm.response') return;
    if (!metrics || !event.usage) return;

    const state = getSessionState(event.sessionId);
    const provider = state?.model.provider ?? defaultProvider;
    const model = state?.model.model ?? 'unknown';

    // Resolve pricing: custom override > built-in lookup
    const customKey = `${provider}:${model}`;
    const override = customPricing?.[customKey];

    let cost: number;
    let cacheSavings = 0;
    const {
      promptTokens,
      completionTokens,
      cacheReadTokens = 0,
      cacheWriteTokens = 0,
    } = event.usage;

    if (override) {
      // Use custom pricing directly
      cost =
        (promptTokens / 1_000_000) * override.inputPrice +
        (completionTokens / 1_000_000) * override.outputPrice;
      if (cacheReadTokens > 0 && override.cacheReadPrice !== undefined) {
        cost += (cacheReadTokens / 1_000_000) * override.cacheReadPrice;
      }
      if (cacheWriteTokens > 0 && override.cacheWritePrice !== undefined) {
        cost += (cacheWriteTokens / 1_000_000) * override.cacheWritePrice;
      }
    } else {
      // Fall back to built-in pricing table
      const pricing = getModelPricing(provider, model);
      if (pricing) {
        cost = calculateCost(
          provider,
          model,
          promptTokens,
          completionTokens,
          cacheReadTokens,
          cacheWriteTokens
        );
        cacheSavings = calculateCacheSavings(provider, model, cacheReadTokens);
      } else {
        // Unknown model — cannot estimate cost accurately, return 0
        cost = 0;
        cacheSavings = 0;
      }
    }

    // Accumulate per-session cost
    if (state) {
      state.cost += cost;
    }

    if (cost > 0) {
      metrics.gauge('agent.cost.per_step', cost, { agent: agentName });
    }
    if (cacheSavings > 0) {
      metrics.gauge('agent.cost.cache_savings', cacheSavings, { agent: agentName });
    }
  }

  function handleAgentComplete(event: AgentEvent): void {
    if (event.type !== 'agent.complete') return;
    if (!metrics) return;

    const state = sessionCosts.get(event.sessionId);
    const totalCost = state?.cost ?? 0;

    metrics.gauge('agent.cost.total', totalCost, { agent: agentName });
  }

  function handleDone(event: AgentEvent): void {
    if (event.type !== 'done') return;
    // Clean up per-session state
    sessionCosts.delete(event.sessionId);
  }
}
