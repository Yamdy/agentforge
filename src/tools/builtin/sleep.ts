import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';

// ========== Zod Parameter Schema ==========

const SleepParams = z.object({
  milliseconds: z
    .number()
    .int()
    .positive()
    .describe('Number of milliseconds to sleep'),
});

type SleepParamsType = z.infer<typeof SleepParams>;

// ========== Metadata Interface ==========

interface SleepMetadata {
  requestedMs: number;
  actualMs: number;
}

// ========== Tool Implementation ==========

const MAX_SLEEP = 300000; // 5 minutes max

export const SleepTool: Tool<SleepParamsType, SleepMetadata> = {
  name: 'sleep',
  description: 'Wait for a specified amount of time',
  parameters: SleepParams,

  async execute(
    args: SleepParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<SleepMetadata>> {
    const { milliseconds } = args;

    // Validate input
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error(
        `Invalid sleep duration: ${milliseconds}. Must be a non-negative finite number.`
      );
    }

    const duration = Math.min(milliseconds, MAX_SLEEP);

    ctx.metadata({ title: `Sleeping for ${duration}ms...`, progress: 0 });

    // Use AbortSignal for cancellable sleep
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, duration);

      ctx.abort.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Sleep cancelled'));
      });
    });

    return {
      title: `Slept for ${duration}ms`,
      output: `Slept for ${duration}ms`,
      metadata: {
        requestedMs: milliseconds,
        actualMs: duration,
      },
    };
  },
};

// ========== Legacy Export (for backward compatibility) ==========

export type SleepToolArgs = SleepParamsType;