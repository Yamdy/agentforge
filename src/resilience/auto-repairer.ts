/**
 * Auto Repairer - MPU-M4 异常熔断
 *
 * Attempts automatic error repair using registered strategies.
 * Strategies are matched by regex pattern against error name + message.
 *
 * @module
 */

import type { SerializedError } from '../core/events.js';
import type { AutoRepairer, RepairResult, RepairHandler } from '../contracts/mpu-interfaces.js';

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

  registerStrategy(errorPattern: RegExp, handler: RepairHandler): void {
    this.strategies.push({ pattern: errorPattern, handler });
  }

  async attemptRepair(error: SerializedError): Promise<RepairResult> {
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
      const success = await strategy.handler(error);
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
