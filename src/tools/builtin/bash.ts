import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';
import { createSandbox, type Sandbox } from '../../sandbox/index.js';
import type { PolicyOptions } from '../../sandbox/policy.js';
import type { AgentConfig } from '../../config/index.js';
import { spawn } from 'child_process';
import { truncateIfNeededAsync } from '../../truncate/index.js';

// ========== Zod Parameter Schema ==========

const BashParams = z.object({
  command: z.string().describe('The command to execute'),
  timeout: z
    .number()
    .optional()
    .describe('Optional timeout in milliseconds. Default: 120000ms (2 minutes)'),
  workdir: z
    .string()
    .optional()
    .describe('The working directory. Defaults to current working directory.'),
  description: z
    .string()
    .describe('Clear, concise description of what this command does in 5-10 words'),
});

type BashParamsType = z.infer<typeof BashParams>;

// ========== Metadata Interface ==========

interface BashMetadata {
  exitCode: number | null;
  duration: number;
  truncated: boolean;
}

// ========== BashToolExecutor Class ==========

/**
 * BashToolExecutor handles the actual command execution with sandbox support.
 */
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

  async execute(
    args: BashParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<BashMetadata>> {
    const DEFAULT_TIMEOUT = 120000;
    const DEFAULT_MAX_OUTPUT = 1024 * 1024;

    const cwd = args.workdir || process.cwd();
    const userTimeout = args.timeout;
    const command = args.command;

    const start = Date.now();

    ctx.metadata({ title: `Running: ${command.slice(0, 30)}...`, progress: 0 });

    // If sandbox is enabled, perform path validation first
    if (this.sandbox) {
      const validationResult = this.validateCommand(command);
      if (validationResult !== true) {
        return {
          title: 'Sandbox violation',
          output: validationResult,
          metadata: { exitCode: 1, duration: 0, truncated: false },
        };
      }
    }

    const timeout = userTimeout ?? DEFAULT_TIMEOUT;
    const maxOutput = DEFAULT_MAX_OUTPUT;

    return new Promise<ToolResult<BashMetadata>>((resolve) => {
      const shell = process.platform === 'win32' ? 'powershell' : 'bash';
      const proc = spawn(command, {
        shell,
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      let outputTruncated = false;

      const append = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > maxOutput) {
          output = output.slice(0, maxOutput) + '\n\n[Output truncated: exceeded size limit]';
          outputTruncated = true;
          proc.kill();
        }
      };

      proc.stdout?.on('data', append);
      proc.stderr?.on('data', append);

      let timedOut = false;
      let aborted = false;

      const kill = () => proc.kill();

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeout + 100);

      // Handle abort signal
      const abortHandler = () => {
        aborted = true;
        kill();
      };
      ctx.abort.addEventListener('abort', abortHandler);

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        ctx.abort.removeEventListener('abort', abortHandler);
      };

      proc.once('exit', async (code: number | null) => {
        cleanup();
        const duration = Date.now() - start;

        if (timedOut) {
          output += `\n\nbash tool terminated command after exceeding timeout ${timeout} ms`;
        }
        if (aborted) {
          output += '\n\nUser aborted the command';
        }
        if (this.sandbox && code !== 0) {
          output += `\n\nExit code: ${code}`;
        }

        // Apply truncate system for large outputs
        const truncatedResult = await truncateIfNeededAsync(output, {
          maxLines: 2000,
          maxBytes: 50000,
          prefix: `bash_${ctx.callId}`,
        });

        resolve({
          title: `Exit ${code ?? 'killed'}`,
          output: truncatedResult.output,
          truncated: truncatedResult.truncated || outputTruncated,
          outputPath: truncatedResult.outputPath,
          metadata: {
            exitCode: code,
            duration,
            truncated: truncatedResult.truncated || outputTruncated,
          },
        });
      });

      proc.once('error', (error: Error) => {
        cleanup();
        const duration = Date.now() - start;
        resolve({
          title: 'Error',
          output: `Error executing command: ${error.message}`,
          metadata: { exitCode: 1, duration, truncated: false },
        });
      });
    });
  }

  private validateCommand(command: string): true | string {
    if (!this.sandbox) return true;

    // Extract paths from command
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

// ========== Tool Implementation ==========

// Default executor with sandbox disabled
const defaultExecutor = new BashToolExecutor({ enabled: false });

export const BashTool: Tool<BashParamsType, BashMetadata> = {
  name: 'bash',
  description:
    'Executes a given bash command in a shell session. When sandbox is enabled, access is restricted to allowed paths. This tool is for terminal operations like git, npm, docker, etc.',
  parameters: BashParams,

  async execute(
    args: BashParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<BashMetadata>> {
    // Use default executor (sandbox disabled)
    // For sandbox-enabled execution, create a new executor with config
    return defaultExecutor.execute(args, ctx);
  },
};