import { Tool } from '../../types';
import { createSandbox, type Sandbox } from '../../sandbox/index.js';
import type { PolicyOptions } from '../../sandbox/policy.js';
import type { AgentConfig } from '../../config/index.js';

export class BashToolExecutor {
  private sandbox: Sandbox | null;

  constructor(sandboxConfig?: AgentConfig['sandbox']) {
    if (sandboxConfig?.enabled) {
      const options: PolicyOptions = {
        allowedPaths: sandboxConfig.allowedPaths,
        deniedPaths: sandboxConfig.deniedPaths,
        timeout: sandboxConfig.timeout,
        maxOutputSize: sandboxConfig.maxOutputSize,
      };
      this.sandbox = createSandbox(options);
    } else {
      this.sandbox = null;
    }
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const DEFAULT_TIMEOUT = 120000;
    const DEFAULT_MAX_OUTPUT = 1024 * 1024;

    const cwd = (args.workdir as string) || process.cwd();
    const userTimeout = args.timeout as number;
    const command = args.command as string;

    // If sandbox is enabled, perform path validation first
    if (this.sandbox) {
      // Check all paths extracted from command
      const validationResult = this.validateCommand(command);
      if (validationResult !== true) {
        return validationResult;
      }
    }

    const timeout = userTimeout ?? DEFAULT_TIMEOUT;
    const maxOutput = DEFAULT_MAX_OUTPUT;

    return new Promise<string>((resolve, reject) => {
      const shell = process.platform === 'win32' ? 'powershell' : 'bash';
      const { spawn } = require('child_process');
      const proc = spawn(command, {
        shell,
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';

      const append = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > maxOutput) {
          output = output.slice(0, maxOutput) + '\n\n[Output truncated: exceeded size limit]';
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

      proc.once('exit', (code: number | null) => {
        exited = true;
        cleanup();
        if (timedOut) {
          output += `\n\nbash tool terminated command after exceeding timeout ${timeout} ms`;
        }
        if (aborted) {
          output += '\n\nUser aborted the command';
        }
        if (this.sandbox && code !== 0) {
          output += `\n\nExit code: ${code}`;
        }
        resolve(output);
      });

      proc.once('error', (error: Error) => {
        exited = true;
        cleanup();
        reject(error);
      });
    });
  }

  private validateCommand(command: string): true | string {
    if (!this.sandbox) return true;

    // Extract paths from command (copied from Sandbox implementation)
    const paths: string[] = [];

    // Match quoted content
    const quotedPattern = /["']([^"']+)["']/g;
    let match;
    while ((match = quotedPattern.exec(command)) !== null) {
      paths.push(match[1]);
    }

    // Match paths starting with /, ./, \, .\, or drive letter
    const pathPattern = /(?<=\s)(\/[^ ]+|\.[/\\][^ ]+|[A-Za-z]:[\\/][^ ]+)/g;
    while ((match = pathPattern.exec(command)) !== null) {
      paths.push(match[0]);
    }

    // Check each path
    for (const p of paths) {
      if (!this.sandbox.isPathAllowed(p)) {
        return `Error: Sandbox policy violation - Path not allowed: ${p}\n\nSandbox is currently enabled. Only access to configured allowed paths is permitted.`;
      }
    }

    return true;
  }

  dispose(): void {
    if (this.sandbox) {
      this.sandbox.dispose();
    }
  }
}

// Default instance with sandbox disabled
const defaultExecutor = new BashToolExecutor({ enabled: false });

export const BashTool: Tool = {
  name: 'bash',
  description:
    'Executes a given bash command in a shell session. When sandbox is enabled, access is restricted to allowed paths. This tool is for terminal operations like git, npm, docker, etc.',
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
  execute: (args: Record<string, unknown>) => defaultExecutor.execute(args),
};
