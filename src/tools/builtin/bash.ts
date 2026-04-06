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
  async execute(args: any) {
    const DEFAULT_TIMEOUT = 120000;
    const MAX_METADATA_LENGTH = 30000;

    const cwd = args.workdir || process.cwd();
    const timeout = args.timeout ?? DEFAULT_TIMEOUT;

    return new Promise<string>((resolve, reject) => {
      const shell = process.platform === 'win32' ? 'powershell' : 'bash';
      const proc = spawn(args.command, {
        shell,
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';

      const append = (chunk: Buffer) => {
        output += chunk.toString();
      };

      proc.stdout?.on('data', append);
      proc.stderr?.on('data', append);

      let timedOut = false;
      let aborted = false;
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
