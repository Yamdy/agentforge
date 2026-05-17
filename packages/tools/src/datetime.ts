import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const datetimeTool: Tool<
  { format?: string; timezone?: string },
  { iso: string; formatted: string; timezone: string; unix: number }
> = {
  name: 'datetime',
  description:
    'Get the current date and time. Supports timezone and format options.',
  inputSchema: z.object({
    format: z
      .enum(['iso', 'locale', 'unix', 'date', 'time'])
      .optional()
      .default('iso')
      .describe('Output format'),
    timezone: z
      .string()
      .optional()
      .describe('IANA timezone (e.g. "Asia/Shanghai", "America/New_York")'),
  }),
  requireApproval: false,
  async execute(input) {
    const { format = 'iso', timezone } = input;

    const now = new Date();
    const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    const formatted =
      format === 'iso'
        ? now.toISOString()
        : format === 'unix'
          ? String(Math.floor(now.getTime() / 1000))
          : format === 'date'
            ? now.toLocaleDateString('en-US', { timeZone: tz })
            : format === 'time'
              ? now.toLocaleTimeString('en-US', { timeZone: tz })
              : now.toLocaleString('en-US', { timeZone: tz });

    return {
      iso: now.toISOString(),
      formatted,
      timezone: tz,
      unix: Math.floor(now.getTime() / 1000),
    };
  },
  renderCall(input) {
    return `datetime (${input.timezone ?? 'local'}, ${input.format ?? 'iso'})`;
  },
  renderResult(output) {
    return output.formatted;
  },
};
