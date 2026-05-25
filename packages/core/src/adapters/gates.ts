import type { Processor, ProcessorContext, ProcessorResult, PipelineContext, TokenUsage } from '@primo-ai/sdk';
import { randomUUID } from 'node:crypto';

/**
 * Gate functions create processors that control pipeline flow (abort/suspend).
 * These provide an OpenCode-style API for permission and quota checks.
 */

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface PermissionGateConfig {
  /** Check function returning allow/deny/ask decision. */
  check: (toolName: string, args: unknown, ctx: PipelineContext) => PermissionDecision;
  /** Optional callback when denied. Return string to use as abort reason. */
  onDeny?: (toolName: string, args: unknown, ctx: PipelineContext) => string | void;
  /** Optional callback when asking for permission. Return reason for suspension. */
  onAsk?: (toolName: string, args: unknown, ctx: PipelineContext) => string;
}

export interface QuotaGateConfig {
  /** Check function returning true if quota is ok, false if exceeded. */
  check: (usage: TokenUsage | undefined, ctx: PipelineContext) => boolean;
  /** Optional callback when exceeded. Return string to use as abort reason. */
  onExceeded?: (usage: TokenUsage | undefined, ctx: PipelineContext) => string | void;
}

export interface CostGateConfig {
  /** Maximum cost allowed. */
  maxCost: number;
  /** Current cost calculation from usage. */
  calculateCost: (usage: TokenUsage, model: string) => number;
  /** Optional callback when exceeded. */
  onExceeded?: (cost: number, maxCost: number, ctx: PipelineContext) => string | void;
}

/**
 * Create a permission gate processor.
 * Checks each pending tool call and decides whether to allow/deny/ask.
 */
export function permission(config: PermissionGateConfig): Processor {
  return {
    stage: 'gateTool',
    async execute(ctx: ProcessorContext): Promise<ProcessorResult> {
      const toolCalls = ctx.state.iteration.pendingToolCalls ?? [];
      for (const tc of toolCalls) {
        const decision = config.check(tc.name, tc.args, ctx.state);
        if (decision === 'deny') {
          const reason = config.onDeny?.(tc.name, tc.args, ctx.state) ?? `Permission denied for tool: ${tc.name}`;
          ctx.control.abort(reason);
        }
        if (decision === 'ask') {
          const suspensionId = randomUUID();
          ctx.control.suspend(suspensionId);
        }
      }
      return {
        status: 'success',
        summary: `Permission check passed for ${toolCalls.length} tool call(s)`,
      };
    },
  };
}

/**
 * Create a token quota gate processor.
 * Checks token usage and aborts if quota is exceeded.
 */
export function quota(config: QuotaGateConfig): Processor {
  return {
    stage: 'gateLLM',
    async execute(ctx: ProcessorContext): Promise<ProcessorResult> {
      const usage = ctx.state.session.totalTokenUsage;
      if (!config.check(usage, ctx.state)) {
        const reason = config.onExceeded?.(usage, ctx.state) ?? 'Token quota exceeded';
        ctx.control.abort(reason);
      }
      return {
        status: 'success',
        summary: 'Token quota check passed',
      };
    },
  };
}

/**
 * Create a cost gate processor.
 * Calculates cost from usage and aborts if max cost is exceeded.
 */
export function cost(config: CostGateConfig): Processor {
  return {
    stage: 'gateLLM',
    async execute(ctx: ProcessorContext): Promise<ProcessorResult | void> {
      const usage = ctx.state.session.totalTokenUsage;
      if (!usage) return;

      const model = ctx.state.agent.config.model;
      const currentCost = config.calculateCost(usage, model);

      if (currentCost > config.maxCost) {
        const reason = config.onExceeded?.(currentCost, config.maxCost, ctx.state)
          ?? `Cost limit exceeded: $${currentCost.toFixed(4)} > $${config.maxCost.toFixed(4)}`;
        ctx.control.abort(reason);
      }

      return {
        status: 'success',
        summary: `Cost check passed: $${currentCost.toFixed(4)} <= $${config.maxCost.toFixed(4)}`,
      };
    },
  };
}

/**
 * Namespace export for convenient access.
 */
export const gates = {
  permission,
  quota,
  cost,
};
