/**
 * Memory-based Cost Tracker Implementation
 *
 * In-memory cost tracking for LLM usage with model-based pricing.
 * Supports per-session limits and cost breakdowns.
 *
 * @module
 */

import type { LLMUsage } from '../core/interfaces.js';
import type {
  CostTracker,
  CostBreakdown,
  CostLimit,
  LimitCheckResult,
  ModelCost,
} from '../contracts/mpu-interfaces.js';
import { calculateCost } from './pricing-table.js';

/**
 * Session usage record
 */
interface SessionUsage {
  totalCost: number;
  byModel: Map<string, ModelCostEntry>;
  byTool: Map<string, number>;
  startTime: string;
  endTime: string;
}

interface ModelCostEntry {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  requests: number;
}

/**
 * In-memory cost tracker for LLM usage.
 *
 * Features:
 * - Per-session cost tracking
 * - Model-based pricing lookup
 * - Configurable limits (tokens, cost, requests)
 * - Cost breakdown by model and tool
 *
 * @example
 * ```typescript
 * const tracker = new MemoryCostTracker();
 *
 * // Record usage
 * await tracker.record('session-1', 'gpt-4o', {
 *   promptTokens: 1000,
 *   completionTokens: 500,
 * });
 *
 * // Check limits
 * await tracker.setLimit('session-1', { maxTokens: 100000, maxCost: 10.0 });
 * const result = await tracker.checkLimit('session-1');
 * ```
 */
export class MemoryCostTracker implements CostTracker {
  private readonly MAX_SESSIONS = 1000;
  private readonly sessions: Map<string, SessionUsage> = new Map();
  private readonly limits: Map<string, CostLimit> = new Map();

  // eslint-disable-next-line @typescript-eslint/require-await
  async record(sessionId: string, model: string, usage: LLMUsage): Promise<void> {
    let session = this.sessions.get(sessionId);
    const now = new Date().toISOString();

    if (!session) {
      if (this.sessions.size >= this.MAX_SESSIONS) {
        const firstKey = this.sessions.keys().next().value;
        if (firstKey !== undefined) {
          this.sessions.delete(firstKey);
        }
      }
      session = {
        totalCost: 0,
        byModel: new Map(),
        byTool: new Map(),
        startTime: now,
        endTime: now,
      };
      this.sessions.set(sessionId, session);
    }

    // Calculate cost
    const cost = calculateCost(model, usage.promptTokens, usage.completionTokens) ?? 0;

    // Update model breakdown
    let modelEntry = session.byModel.get(model);
    if (!modelEntry) {
      modelEntry = {
        model,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        requests: 0,
      };
      session.byModel.set(model, modelEntry);
    }

    modelEntry.promptTokens += usage.promptTokens;
    modelEntry.completionTokens += usage.completionTokens;
    modelEntry.cost += cost;
    modelEntry.requests += 1;

    session.totalCost += cost;
    session.endTime = now;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getUsage(sessionId: string): Promise<CostBreakdown> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return {
        sessionId,
        totalCost: 0,
        byModel: {},
        byTool: {},
        timeRange: { start: '', end: '' },
      };
    }

    const byModel: Record<string, ModelCost> = {};
    for (const [model, entry] of session.byModel) {
      byModel[model] = {
        model: entry.model,
        tokens: {
          promptTokens: entry.promptTokens,
          completionTokens: entry.completionTokens,
        },
        cost: entry.cost,
        requests: entry.requests,
      };
    }

    const byTool: Record<string, number> = {};
    for (const [tool, cost] of session.byTool) {
      byTool[tool] = cost;
    }

    return {
      sessionId,
      totalCost: session.totalCost,
      byModel,
      byTool,
      timeRange: { start: session.startTime, end: session.endTime },
    };
  }

  async checkLimit(sessionId: string): Promise<LimitCheckResult> {
    const usage = await this.getUsage(sessionId);
    const limit = this.limits.get(sessionId);

    if (!limit) {
      return {
        withinLimit: true,
        current: usage,
        limit: {},
      };
    }

    const exceeded: string[] = [];

    // Check token limit
    if (limit.maxTokens !== undefined) {
      let totalTokens = 0;
      for (const modelCost of Object.values(usage.byModel)) {
        totalTokens += modelCost.tokens.promptTokens + modelCost.tokens.completionTokens;
      }
      if (totalTokens > limit.maxTokens) {
        exceeded.push(`tokens: ${totalTokens} > ${limit.maxTokens}`);
      }
    }

    // Check cost limit
    if (limit.maxCost !== undefined) {
      if (usage.totalCost > limit.maxCost) {
        exceeded.push(`cost: ${usage.totalCost.toFixed(6)} > ${limit.maxCost}`);
      }
    }

    // Check requests limit
    if (limit.maxRequests !== undefined) {
      let totalRequests = 0;
      for (const modelCost of Object.values(usage.byModel)) {
        totalRequests += modelCost.requests;
      }
      if (totalRequests > limit.maxRequests) {
        exceeded.push(`requests: ${totalRequests} > ${limit.maxRequests}`);
      }
    }

    const result: LimitCheckResult = {
      withinLimit: exceeded.length === 0,
      current: usage,
      limit,
    };

    if (exceeded.length > 0) {
      result.exceeded = exceeded;
    }

    return result;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async setLimit(sessionId: string, limit: CostLimit): Promise<void> {
    this.limits.set(sessionId, { ...limit });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getLimit(sessionId: string): Promise<CostLimit | null> {
    const limit = this.limits.get(sessionId);
    return limit ? { ...limit } : null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async reset(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
