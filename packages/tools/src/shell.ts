import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const shellTool: Tool<
  { command: string; cwd?: string; timeout?: number },
  { exitCode: number | null; stdout: string; stderr: string }
> = {
  name: 'shell',
  description:
    'Execute a shell command. Returns stdout, stderr, and exit code. Supports timeout.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
    cwd: z.string().optional().describe('Working directory'),
    timeout: z
      .number()
      .optional()
      .default(30_000)
      .describe('Timeout in milliseconds (default 30s)'),
  }),
  requireApproval: true,
  async execute(input) {
    const { exec } = await import('node:child_process');
    const { command, cwd, timeout = 30_000 } = input;

    return new Promise((resolve) => {
      const child = exec(
        command,
        { cwd, timeout, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            exitCode: error ? 1 : 0,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
          });
        },
      );
      child.on('error', (err) => {
        resolve({ exitCode: 1, stdout: '', stderr: err.message });
      });
    });
  },
  renderCall(input) {
    return `$ ${input.command}`;
  },
  renderResult(output) {
    const out = output.stdout.slice(0, 200);
    return `[exit ${output.exitCode}] ${out}`;
  },
};
