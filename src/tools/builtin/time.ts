import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';

// ========== Zod Parameter Schema ==========

const TimeParams = z.object({});

type TimeParamsType = z.infer<typeof TimeParams>;

// ========== Metadata Interface ==========

interface TimeMetadata {
  iso: string;
  local: string;
  timestamp: number;
  date: string;
  time: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// ========== Tool Implementation ==========

export const CurrentTimeTool: Tool<TimeParamsType, TimeMetadata> = {
  name: 'current_time',
  description: 'Get the current date and time in ISO format',
  parameters: TimeParams,

  async execute(
    _args: TimeParamsType,
    _ctx: ToolContext
  ): Promise<ToolResult<TimeMetadata>> {
    const now = new Date();

    const metadata: TimeMetadata = {
      iso: now.toISOString(),
      local: now.toString(),
      timestamp: now.getTime(),
      date: now.toDateString(),
      time: now.toTimeString(),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds(),
    };

    const output = JSON.stringify(metadata, null, 2);

    return {
      title: `Current time: ${metadata.iso}`,
      output,
      metadata,
    };
  },
};