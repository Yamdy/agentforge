/**
 * Bash Tool for AgentForge
 *
 * Provides a sandboxed shell command execution tool:
 * - bash: Execute shell commands with security blocking
 *
 * Security: Blocks dangerous commands (rm -rf, curl | sh, eval, sudo, etc.)
 * Supports timeout enforcement, output truncation, and background mode.
 */

import { z } from 'zod';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { randomBytes } from 'crypto';
import type { ToolDefinition } from '../core/interfaces.js';
import { taskRegistry } from './task-registry.js';

const execFileAsync = promisify(execFile);

// ============================================================
// Configuration
// ============================================================

/**
 * Configuration for the bash tool.
 *
 * @param blockedCommands - Additional command patterns to block (beyond defaults).
 * @param defaultTimeout - Maximum execution time in milliseconds (default: 30000).
 * @param maxOutputChars - Maximum output characters before truncation (default: 30000).
 * @param workingDirectory - Working directory for command execution.
 */
export interface BashToolConfig {
  blockedCommands?: string[];
  defaultTimeout?: number;
  maxOutputChars?: number;
  workingDirectory?: string;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 30_000;

// ============================================================
// Blocked Commands
// ============================================================

/**
 * Default blocked command patterns.
 *
 * Each entry is matched as a substring (case-insensitive) against the
 * full command string. Patterns use regex-like syntax internally.
 */
const DEFAULT_BLOCKED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brm\s+.*-(?:r|f|rf|fr)(?:\s|$)/i, label: 'rm -rf' },
  { pattern: /\|.*\b(?:sh|bash|zsh|dash|\/bin\/sh|\/bin\/bash)\b/i, label: 'curl | sh' },
  { pattern: /\beval\b/i, label: 'eval' },
  { pattern: /\bsudo\b/i, label: 'sudo' },
  { pattern: /chmod\s+(?:0?777|[47]77)/i, label: 'chmod 777' },
  { pattern: /\bdd\s+.*if=/i, label: 'dd if=' },
  { pattern: /\bmkfs\b/i, label: 'mkfs' },
  // Shell expansion / injection prevention
  { pattern: /\$\(/, label: 'command substitution $(...)' },
  { pattern: /`/, label: 'backtick command substitution' },
  { pattern: /\$\{/, label: 'parameter expansion ${...}' },
  { pattern: /\$[a-zA-Z_][a-zA-Z0-9_]*/, label: 'variable expansion $VAR' },
];

/**
 * Check whether a command is blocked by any pattern.
 * Returns the blocked label if found, or null if safe.
 */
function checkBlocked(
  command: string,
  extraPatterns: string[]
): { blocked: true; label: string } | { blocked: false } {
  // Check built-in patterns
  for (const { pattern, label } of DEFAULT_BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { blocked: true, label };
    }
  }

  // Check user-supplied patterns (substring match, case-insensitive)
  for (const pat of extraPatterns) {
    const escapedPattern = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedPattern, 'i');
    if (regex.test(command)) {
      return { blocked: true, label: pat };
    }
  }

  return { blocked: false };
}

// ============================================================
// Shell Detection
// ============================================================

/**
 * Get shell command and args based on platform.
 * Unix: /bin/sh -c
 * Windows: cmd /c
 */
function getShell(): { shell: string; shellArgs: string[] } {
  if (platform() === 'win32') {
    return { shell: 'cmd', shellArgs: ['/c'] };
  }
  return { shell: '/bin/sh', shellArgs: ['-c'] };
}

// ============================================================
// Zod Schema
// ============================================================

const BashSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum execution time in milliseconds'),
  background: z
    .boolean()
    .optional()
    .default(false)
    .describe('Run command in background and return a task handle'),
});

// ============================================================
// Command Execution Helpers
// ============================================================

/**
 * Execute a shell command with timeout and output capture.
 * Uses execFile with platform-specific shell.
 */
async function executeCommand(
  command: string,
  timeout: number,
  workingDirectory?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { shell, shellArgs } = getShell();
  const fullArgs = [...shellArgs, command];

  try {
    const result = await execFileAsync(shell, fullArgs, {
      timeout,
      cwd: workingDirectory,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      encoding: 'utf-8',
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (err: unknown) {
    // execFile throws on non-zero exit or timeout — use type guard
    if (typeof err !== 'object' || err === null) {
      return { stdout: '', stderr: '', exitCode: 1 };
    }
    const error = err as Record<string, unknown>;
    if (error.killed === true) {
      return {
        stdout: typeof error.stdout === 'string' ? error.stdout : '',
        stderr: typeof error.stderr === 'string' ? error.stderr : '',
        exitCode: -1,
      };
    }
    return {
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

/**
 * Truncate output to maxChars, adding a truncation notice.
 */
function truncateOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const truncated = output.slice(0, maxChars);
  return `${truncated}\n... [Output truncated at ${maxChars} characters. Total length: ${output.length} chars]`;
}

/**
 * Generate a random task ID for background mode.
 */
function generateTaskId(): string {
  return randomBytes(4).toString('hex');
}

// ============================================================
// Tool Implementation
// ============================================================

/**
 * Create the bash tool.
 *
 * Provides shell command execution with:
 * - Security: Blocked dangerous commands
 * - Timeout: Configurable execution timeout
 * - Output truncation: Large output truncated to maxOutputChars
 * - Background mode: Returns task handle for long-running commands
 */
function createBashToolInstance(config: BashToolConfig): ToolDefinition {
  const defaultTimeout = config.defaultTimeout ?? DEFAULT_TIMEOUT;
  const maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const workingDirectory = config.workingDirectory;
  const blockedCommands = config.blockedCommands ?? [];

  return {
    name: 'bash',
    description:
      'Execute a shell command and return its output. ' +
      'Supports timeout control and background execution. ' +
      'Dangerous commands (rm -rf, curl | sh, eval, sudo, chmod 777, dd, mkfs) and shell expansion syntax ($(...), backticks, ${...}, $VAR) are blocked.',
    parameters: BashSchema,
    execute: async (args: unknown): Promise<string> => {
      const parsed = BashSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { command, timeout, background } = parsed.data;
      const effectiveTimeout = timeout ?? defaultTimeout;

      // Check blocked commands
      const blocked = checkBlocked(command, blockedCommands);
      if (blocked.blocked) {
        return `Error: Command blocked for security: "${blocked.label}" pattern detected.`;
      }

      // Background mode: spawn process and return task handle immediately
      if (background) {
        const taskId = generateTaskId();
        const { shell, shellArgs } = getShell();
        const fullArgs = [...shellArgs, command];

        const child = spawn(shell, fullArgs, {
          cwd: workingDirectory,
          stdio: 'ignore',
          detached: false,
          timeout: effectiveTimeout,
        });

        // Attach cleanup listeners BEFORE registering — avoids race
        // where short-lived process exits before listener is attached,
        // leaving an orphaned registry entry.
        child.on('close', () => {
          taskRegistry.remove(taskId);
        });

        child.on('error', () => {
          taskRegistry.remove(taskId);
        });

        // Register with task registry so it can be killed/queried
        taskRegistry.register(taskId, child, command);

        return `[Task started: ${taskId}]`;
      }

      // Execute command
      const result = await executeCommand(command, effectiveTimeout, workingDirectory);

      // Handle timeout (killed process)
      if (result.exitCode === -1 && result.stderr === '' && result.stdout === '') {
        return `Error: Command timed out after ${effectiveTimeout}ms.`;
      }

      // Build output
      const parts: string[] = [];

      if (result.stdout) {
        parts.push(truncateOutput(result.stdout, maxOutputChars));
      }

      if (result.stderr) {
        parts.push(`[stderr]\n${truncateOutput(result.stderr, maxOutputChars)}`);
      }

      if (result.exitCode !== 0) {
        parts.push(`[Exit code: ${result.exitCode}]`);
      }

      const output = parts.join('\n') || '[No output]';

      return output;
    },
  };
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create bash tool with the given configuration.
 *
 * @param config - Configuration for the bash tool
 * @returns Array of ToolDefinition objects (currently just the bash tool)
 *
 * @example
 * ```typescript
 * import { createBashTool } from './tools/bash.js';
 *
 * const tools = createBashTool({
 *   defaultTimeout: 15000,
 *   maxOutputChars: 50000,
 * });
 *
 * // Register with tool registry
 * for (const tool of tools) {
 *   registry.register(tool);
 * }
 * ```
 */
export function createBashTool(config?: BashToolConfig): ToolDefinition[] {
  return [createBashToolInstance(config ?? {})];
}
