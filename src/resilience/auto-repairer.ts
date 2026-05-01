/**
 * Auto Repairer - MPU-M4 异常熔断
 *
 * Attempts automatic error repair using registered strategies.
 * Strategies are matched by regex pattern against error name + message.
 *
 * @module
 */

import type { SerializedError } from '../core/events.js';
import type {
  AutoRepairer,
  RepairResult,
  RepairHandler,
  RepairContext,
} from '../contracts/mpu-interfaces.js';

interface RepairStrategy {
  pattern: RegExp;
  handler: RepairHandler;
}

/**
 * Default auto repairer implementation.
 *
 * Strategies are matched in registration order.
 * First matching strategy is used for repair attempt.
 */
export class DefaultAutoRepairer implements AutoRepairer {
  private readonly strategies: RepairStrategy[] = [];

  constructor() {
    // Strategy 1: output_token_escalation
    // Matches token limit errors, signals retry with higher maxTokens.
    this.registerStrategy(
      /output.*token|max.*token|token.*limit/i,
      // eslint-disable-next-line @typescript-eslint/require-await
      async ctx => {
        if (ctx.config?.maxTokens) {
          // eslint-disable-next-line no-console
          console.log(
            `[AutoRepairer] Token limit escalation: current maxTokens=${ctx.config.maxTokens}`
          );
        }
        return true;
      }
    );

    // Strategy 2: context_compaction
    // Matches context window overflow, triggers compaction if manager available.
    this.registerStrategy(/context.*(?:length|window|overflow)|maximum.*context/i, async ctx => {
      if (ctx.compactionManager) {
        try {
          await ctx.compactionManager.compact({
            sessionId: ctx.sessionId,
            messages: ctx.messages ?? [],
            currentTokenEstimate: ctx.currentTokenEstimate ?? 0,
            maxTokens: ctx.config?.maxTokens ?? 100000,
          });
        } catch {
          // compaction is best-effort
        }
      }
      return true;
    });

    // Strategy 3: rate_limit_backoff
    // Matches rate limit / 429 errors, implements exponential backoff.
    this.registerStrategy(/rate.?limit|429|too many requests|throttl/i, async ctx => {
      const delay = Math.min(1000 * Math.pow(2, ctx.retryCount), 60000);
      await new Promise(resolve => setTimeout(resolve, delay));
      return true;
    });

    // Strategy 4: fallback_model
    // Matches model unavailable / 503 errors, signals fallback model switch.
    this.registerStrategy(
      /model.*(?:unavailable|overloaded|error)|service.*unavailable|503/i,
      // eslint-disable-next-line @typescript-eslint/require-await
      async ctx => {
        return !!ctx.config?.fallbackModel;
      }
    );

    // Strategy 5: empty_response_recovery
    // Matches empty response errors, signals retry with modified prompt.
    this.registerStrategy(
      /empty.*response|no.*output|blank.*response|empty.*content/i,
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => {
        return true;
      }
    );
  }

  registerStrategy(errorPattern: RegExp, handler: RepairHandler): void {
    this.strategies.push({ pattern: errorPattern, handler });
  }

  // ── Overloaded signatures matching AutoRepairer interface ──
  async attemptRepair(ctx: RepairContext): Promise<RepairResult>;
  async attemptRepair(error: SerializedError): Promise<RepairResult>;
  async attemptRepair(errorOrCtx: SerializedError | RepairContext): Promise<RepairResult> {
    // Normalize: wrap raw SerializedError into a minimal RepairContext
    const ctx: RepairContext =
      'error' in errorOrCtx
        ? errorOrCtx
        : { error: errorOrCtx, retryCount: 0, sessionId: 'unknown' };

    const { error } = ctx;
    const nameText = error.name;
    const messageText = error.message;
    const fullText = `${error.name} ${error.message}`;

    // Find first matching strategy (match against name, message, or combined)
    const strategy = this.strategies.find(
      s => s.pattern.test(nameText) || s.pattern.test(messageText) || s.pattern.test(fullText)
    );

    if (!strategy) {
      return {
        success: false,
        description: `No matching repair strategy for error: ${error.name}: ${error.message}`,
        retryCount: 0,
      };
    }

    try {
      const success = await strategy.handler(ctx);
      return {
        success,
        description: success
          ? `Repair succeeded using pattern: ${strategy.pattern.source}`
          : `Repair handler returned false for: ${error.name}`,
        retryCount: 1,
      };
    } catch (repairError) {
      return {
        success: false,
        description: `Repair handler failed: ${repairError instanceof Error ? repairError.message : String(repairError)}`,
        retryCount: 1,
      };
    }
  }
}
