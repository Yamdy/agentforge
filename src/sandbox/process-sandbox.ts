/**
 * MPU-M3: Process Sandbox Implementation
 *
 * Implements the ContainerSandbox interface using child_process.execFile
 * for lightweight process-level isolation. No Docker dependency required.
 *
 * Securities enforced:
 * - cwd restriction (commands restricted to configured workDir)
 * - Env whitelist (secret env vars filtered out)
 * - Path violation checking (blocked paths: /etc/shadow, etc.)
 * - Network policy enforcement (block curl/wget/nc on 'none' policy)
 * - Timeout enforcement via execFile timeout option
 * - Output truncation (limit stdout/stderr to maxOutputChars)
 *
 * @module
 */

import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type {
  SandboxConfig,
  SandboxInstance,
  SandboxCommand,
  SandboxResult,
  SandboxViolation,
  ContainerSandbox,
} from '../contracts/mpu-interfaces.js';

// ============================================================
// Types
// ============================================================

/**
 * Extended config for ProcessSandbox.
 */
export interface ProcessSandboxConfig extends SandboxConfig {
  /** Working directory for sandboxed processes */
  workDir: string;
  /** Whitelist of environment variable names to pass through */
  envWhitelist?: string[];
  /** Maximum characters for stdout/stderr before truncation */
  maxOutputChars?: number;
}

/**
 * Internal instance tracking with normalized config.
 */
interface TrackedInstance {
  instance: SandboxInstance;
  config: ProcessSandboxConfig;
}

// ============================================================
// Constants
// ============================================================

/** Default env variables allowed through to subprocess */
const DEFAULT_ENV_WHITELIST = [
  'PATH',
  'HOME',
  'TEMP',
  'TMP',
  'USER',
  'USERNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'SYSTEMROOT',
  'ProgramFiles',
  'ComSpec',
] as const;

/** Default max output characters */
const DEFAULT_MAX_OUTPUT_CHARS = 100000;

/** Blocked filesystem paths */
const BLOCKED_PATHS = ['/etc/shadow', '/etc/passwd', '~/.ssh', '~/.gnupg', '/root'] as const;

/** Network-related executables blocked under networkPolicy='none' */
const NETWORK_EXECUTABLES = new Set([
  'curl',
  'curl.exe',
  'wget',
  'wget.exe',
  'nc',
  'nc.exe',
  'netcat',
  'netcat.exe',
  'ncat',
  'ncat.exe',
  'fetch',
  'fetch.exe',
]);

/** Metadata endpoints always blocked */
const BLOCKED_DOMAINS = [
  '169.254.169.254',
  'metadata.google.internal',
  'localhost',
  '127.0.0.1',
] as const;

/** Patterns in env var names that indicate secrets */
const SECRET_PATTERNS = ['API_KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'AUTH', 'CREDENTIAL'] as const;

/** Type for execFile promise result */
type ExecFilePromiseResult = { stdout: string; stderr: string };

/**
 * Extended error shape returned by execFile on failure.
 * Includes stdout/stderr buffers and kill signal info.
 */
interface ExecFileError extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Execute command via spawn (supports stdin, timeout).
 */
function spawnAsync(
  file: string,
  args: readonly string[],
  options: SpawnOptions & { stdin?: string }
): Promise<ExecFilePromiseResult> {
  return new Promise<ExecFilePromiseResult>((resolve, reject) => {
    const child = spawn(file, args as string[], {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', err => {
      reject(err);
    });

    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code === 0 && signal === null) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command failed: ${file} ${args.join(' ')}`) as ExecFileError;
        error.code = code ?? 1;
        error.killed = signal !== null;
        error.signal = signal;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });

    // Pipe stdin if provided
    if (options.stdin !== undefined) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    }
  });
}

/**
 * Normalize loose SandboxConfig into strict ProcessSandboxConfig with defaults.
 */
function normalizeConfig(config: SandboxConfig): ProcessSandboxConfig {
  return {
    workDir: process.cwd(),
    envWhitelist: [...DEFAULT_ENV_WHITELIST],
    maxOutputChars: DEFAULT_MAX_OUTPUT_CHARS,
    ...config,
  } as ProcessSandboxConfig;
}

/**
 * Check if a path is inside (or equal to) the base directory.
 * Cross-platform: resolves both paths and checks prefix.
 */
function isPathWithin(base: string, target: string): boolean {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  // Normalize to lowercase on Windows for comparison
  if (process.platform === 'win32') {
    return resolvedTarget.toLowerCase().startsWith(resolvedBase.toLowerCase());
  }
  return resolvedTarget.startsWith(resolvedBase);
}

/**
 * Build the sanitized environment for subprocess execution.
 * Includes whitelisted system vars + filtered command env (no secrets).
 */
function buildEnv(
  sysEnv: Record<string, string | undefined>,
  whitelist: readonly string[],
  commandEnv?: Record<string, string>
): Record<string, string> {
  const env: Record<string, string> = {};

  // Copy whitelisted system env vars
  for (const key of whitelist) {
    const val = sysEnv[key];
    if (val !== undefined) {
      env[key] = val;
    }
  }

  // Add command env vars, filtering out secrets
  if (commandEnv) {
    for (const [key, value] of Object.entries(commandEnv)) {
      if (!isSecretKey(key)) {
        env[key] = value;
      }
    }
  }

  return env;
}

/**
 * Check if an env var name looks like a secret.
 * Case-insensitive match against patterns (API_KEY, TOKEN, SECRET, PASSWORD, AUTH, CREDENTIAL).
 */
function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return SECRET_PATTERNS.some(p => upper.includes(p));
}

/**
 * Check all args (including executable) against blocked paths.
 */
function checkBlockedPaths(
  executable: string,
  args: readonly string[],
  violations: SandboxViolation[]
): void {
  const allStrings = [executable, ...args];

  for (const str of allStrings) {
    for (const blocked of BLOCKED_PATHS) {
      if (str.includes(blocked)) {
        violations.push({
          type: 'path_violation',
          path: blocked,
          mode: 'read',
        });
      }
    }
  }
}

/**
 * Check read-only mount writes.
 */
function checkReadOnlyMounts(
  args: readonly string[],
  config: ProcessSandboxConfig,
  violations: SandboxViolation[]
): void {
  if (!config.filesystemMounts) return;

  for (const mount of config.filesystemMounts) {
    if (mount.readOnly) {
      for (const arg of args) {
        if (arg.startsWith(mount.containerPath)) {
          violations.push({
            type: 'path_violation',
            path: arg,
            mode: 'write',
          });
        }
      }
    }
  }
}

/**
 * Check network policy violations.
 */
function checkNetworkPolicy(
  command: SandboxCommand,
  config: ProcessSandboxConfig,
  violations: SandboxViolation[]
): void {
  const { executable, args } = command;

  if (config.networkPolicy === 'none') {
    // Block network executables
    const execName = executable.toLowerCase();
    if (NETWORK_EXECUTABLES.has(execName)) {
      violations.push({
        type: 'network_violation',
        domain: executable,
      });
    }

    // Scan args for URLs and blocked domains
    const allArgs = args.join(' ');
    for (const arg of args) {
      if (arg.startsWith('http://') || arg.startsWith('https://')) {
        violations.push({
          type: 'network_violation',
          domain: arg,
        });
      }
    }
    for (const domain of BLOCKED_DOMAINS) {
      if (allArgs.includes(domain)) {
        violations.push({
          type: 'network_violation',
          domain,
        });
      }
    }
  } else if (config.networkPolicy === 'restricted') {
    const allowed = config.allowedDomains ?? [];
    const allArgs = args.join(' ');

    // Check URLs against allowed domains
    for (const arg of args) {
      if (arg.startsWith('http://') || arg.startsWith('https://')) {
        const isAllowed = allowed.some(d => arg.includes(d));
        if (!isAllowed) {
          violations.push({
            type: 'network_violation',
            domain: arg,
          });
        }
      }
    }

    // Always block known-bad domains in restricted mode
    for (const domain of BLOCKED_DOMAINS) {
      if (allArgs.includes(domain)) {
        const isAllowed = allowed.some(d => domain.includes(d));
        if (!isAllowed) {
          violations.push({
            type: 'network_violation',
            domain,
          });
        }
      }
    }
  }
  // 'open' policy: no blocking
}

/**
 * Truncate a string to maxChars, append marker if truncated.
 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

// ============================================================
// ProcessSandbox
// ============================================================

/**
 * Process-level sandbox implementing ContainerSandbox.
 *
 * Executes commands via child_process.execFile with security checks
 * for cwd restriction, env filtering, path/nw constraints.
 * No Docker dependency — lightweight, suitable for local dev/CI.
 */
export class ProcessSandbox implements ContainerSandbox {
  private readonly instances = new Map<string, TrackedInstance>();

  // eslint-disable-next-line @typescript-eslint/require-await
  async create(config: SandboxConfig): Promise<SandboxInstance> {
    const normalized = normalizeConfig(config);
    const id = `proc-sandbox-${randomUUID().slice(0, 8)}`;
    const containerId = `proc-${randomUUID().slice(0, 12)}`;

    const instance: SandboxInstance = {
      id,
      containerId,
      status: 'created',
      createdAt: Date.now(),
    };

    this.instances.set(id, { instance, config: normalized });
    return instance;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(instance: SandboxInstance, command: SandboxCommand): Promise<SandboxResult> {
    const tracked = this.instances.get(instance.id);
    if (!tracked) {
      throw new Error(`Sandbox instance ${instance.id} not found or has been destroyed`);
    }

    if (instance.status === 'destroyed') {
      throw new Error(`Cannot execute on destroyed sandbox instance ${instance.id}`);
    }

    const config = tracked.config;
    const maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const startTime = Date.now();
    const violations: SandboxViolation[] = [];

    // --- Pre-execution security checks ---

    // 1. cwd restriction
    const effectiveCwd = command.workingDir ?? config.workDir;
    if (!isPathWithin(config.workDir, effectiveCwd)) {
      violations.push({
        type: 'path_violation',
        path: effectiveCwd,
        mode: 'write',
      });
    }

    // 2. Blocked path checks
    checkBlockedPaths(command.executable, command.args, violations);

    // 3. Read-only mount checks
    checkReadOnlyMounts(command.args, config, violations);

    // 4. Network policy checks
    checkNetworkPolicy(command, config, violations);

    // --- If violations detected, skip execution and return early ---
    if (violations.length > 0) {
      const durationMs = Date.now() - startTime;
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Violations detected: ${violations.length}`,
        durationMs,
        violations,
      };
    }

    // --- Build execution environment ---
    const env = buildEnv(
      process.env as Record<string, string | undefined>,
      config.envWhitelist ?? DEFAULT_ENV_WHITELIST,
      command.env
    );

    // --- Execute command ---
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    try {
      const spawnOpts: SpawnOptions & { stdin?: string } = {
        cwd: effectiveCwd,
        env,
        timeout: config.timeoutMs,
      };
      if (command.stdin !== undefined) {
        spawnOpts.stdin = command.stdin;
      }
      const result = await spawnAsync(command.executable, command.args, spawnOpts);

      stdout = result.stdout;
      stderr = result.stderr;
    } catch (caught) {
      const err = caught as ExecFileError;
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? '';
      exitCode = typeof err.code === 'number' ? err.code : 1;

      // Detect timeout
      if (err.killed || (err.signal && err.signal !== null)) {
        violations.push({
          type: 'timeout',
          timeoutMs: config.timeoutMs,
        });
      }
    }

    const durationMs = Date.now() - startTime;

    // --- Truncate output ---
    return {
      exitCode,
      stdout: truncate(stdout, maxOutputChars),
      stderr: truncate(stderr, maxOutputChars),
      durationMs,
      violations,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async destroy(instance: SandboxInstance): Promise<void> {
    instance.status = 'destroyed';
    this.instances.delete(instance.id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async list(): Promise<SandboxInstance[]> {
    return Array.from(this.instances.values()).map(t => t.instance);
  }
}
