/**
 * Auto-Repair Helper — extracted from agent-loop.ts
 *
 * Attempts to repair fatal LLM errors via the AutoRepairer subsystem.
 * On success the caller retries the LLM call; on failure the error propagates.
 */

import type { AgentContext } from '../core/context.js';
import type { AgentState } from '../core/state.js';
import { serializeError } from '../core/events.js';
import type { AgentLoopConfig } from './agent-loop.js';

export const MAX_AUTO_REPAIR_ATTEMPTS = 3;

export interface AutoRepairDeps {
  ctx: AgentContext;
  config: AgentLoopConfig;
}

export async function attemptAutoRepair(
  deps: AutoRepairDeps,
  error: unknown,
  state: AgentState
): Promise<boolean> {
  const { ctx, config } = deps;

  if (!ctx.autoRepairer) return false;
  if (state.autoRepairAttempts >= MAX_AUTO_REPAIR_ATTEMPTS) return false;

  try {
    const err = serializeError(error);
    const repairCtx: import('../contracts/mpu-interfaces.js').RepairContext = {
      error: err,
      retryCount: state.autoRepairAttempts,
      sessionId: ctx.sessionId,
      llm: ctx.llm,
      ...(ctx.compactionManager ? { compactionManager: ctx.compactionManager } : {}),
      messages: state.messages,
      currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
      config: {
        ...(config.fallbackModel
          ? { fallbackModel: `${config.fallbackModel.provider}/${config.fallbackModel.model}` }
          : {}),
      },
    };
    const result = await ctx.autoRepairer.attemptRepair(repairCtx);
    if (result.success) {
      ctx.logger?.info('Auto-repair succeeded, retrying', {
        description: result.description,
        attempt: state.autoRepairAttempts + 1,
      });
      return true;
    }
    ctx.logger?.warn('Auto-repair failed', {
      description: result.description,
    });
    return false;
  } catch (repairErr) {
    ctx.logger?.warn('Auto-repair attempt error', {
      error: serializeError(repairErr),
    });
    return false;
  }
}
