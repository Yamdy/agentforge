/**
 * AgentForge In-Process Sandbox Executor
 */

import type { SandboxConfig, SandboxExecutor } from './sandbox-executor.js';
import { DEFAULT_SANDBOX_CONFIG } from './sandbox-executor.js';
import type {
  SandboxCommand,
  SandboxContext,
  SandboxResult,
  SandboxViolation,
} from './sandbox-executor.js';
import { serializeError } from '../../core/events.js';

export class InProcessSandboxExecutor implements SandboxExecutor {
  private readonly config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = config ? { ...DEFAULT_SANDBOX_CONFIG, ...config } : DEFAULT_SANDBOX_CONFIG;
  }

  async execute(command: SandboxCommand, context: SandboxContext): Promise<SandboxResult> {
    const tool = context.toolRegistry?.get(command.toolName);
    if (!tool) {
      return {
        success: false,
        error: {
          name: 'ToolNotFoundError',
          message: `Tool not found in sandbox: ${command.toolName}`,
        },
        durationMs: 0,
      };
    }

    const timeoutMs = context.timeoutMs ?? this.config.compute.timeoutMs;
    const startTime = Date.now();
    const violations: SandboxViolation[] = [];

    try {
      const result = await this.withTimeout(
        tool.execute(command.args, {
          toolCallId: `sandbox-${Date.now()}`,
          parentSessionId: context.sessionId,
          signal: context.signal!,
        }),
        timeoutMs,
        violations
      );
      const successResult: SandboxResult = {
        success: true,
        result,
        durationMs: Date.now() - startTime,
      };
      if (violations.length > 0) {
        successResult.violations = violations;
      }
      return successResult;
    } catch (error) {
      const failResult: SandboxResult = {
        success: false,
        error: serializeError(error),
        durationMs: Date.now() - startTime,
      };
      if (violations.length > 0) {
        failResult.violations = violations;
      }
      return failResult;
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    violations: SandboxViolation[]
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        violations.push({ type: 'timeout', timeoutMs });
        reject(new Error(`Sandbox timeout: ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
}
