import type { Tool } from '../../types.js';

export const CurrentTimeTool: Tool = {
  name: 'current_time',
  description: 'Get the current date and time in ISO format',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    const now = new Date();
    return JSON.stringify(
      {
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
      },
      null,
      2
    );
  },
};
