import { Tool } from '../../types';
import { spawn } from 'child_process';

export const BashTool: Tool = {
  name: 'bash',
  description:
    'Executes a given bash command in a persistent shell session. This tool is for terminal operations like git, npm, docker, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
      timeout: {
        type: 'number',
        description:
          'Optional timeout in milliseconds. If not specified, commands will time out after 120000ms (2 minutes).',
        optional: true,
      },
      workdir: {
        type: 'string',
        description:
          'The working directory to run the command in. Defaults to the current working directory.',
        optional: true,
      },
      description: {
        type: 'string',
        description: 'Clear, concise description of what this command does in 5-10 words.',
      },
    },
    required: ['command', 'description'],
  },
  async execute(args: Record<string, unknown>) {
    const DEFAULT_TIMEOUT = 120000;
    const MAX_OUTPUT_LENGTH = 1024 * 1024;

    const cwd = (args.workdir as string) || process.cwd();
    const timeout = (args.timeout as number) ?? DEFAULT_TIMEOUT;
    const command = args.command as string;

    return new Promise<string>((resolve, reject) => {
      const shell = process.platform === 'win32' ? 'powershell' : 'bash';
      const proc = spawn(command, {
        shell,
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';

      const append = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > MAX_OUTPUT_LENGTH) {
          output =
            output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n[Output truncated: exceeded 1MB limit]';
          proc.kill();
        }
      };

      proc.stdout?.on('data', append);
      proc.stderr?.on('data', append);

      let timedOut = false;
      const aborted = false;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let exited = false;

      const kill = () => proc.kill();

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeout + 100);

      const cleanup = () => {
        clearTimeout(timeoutTimer);
      };

      proc.once('exit', () => {
        exited = true;
        cleanup();
        if (timedOut) {
          output += `\n\nbash tool terminated command after exceeding timeout ${timeout} ms`;
        }
        if (aborted) {
          output += '\n\nUser aborted the command';
        }
        resolve(output);
      });

      proc.once('error', (error) => {
        exited = true;
        cleanup();
        reject(error);
      });
    });
  },
};
