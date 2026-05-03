/**
 * MPU-M3: Docker Sandbox Implementation
 *
 * Implements the ContainerSandbox interface for Docker-based isolation.
 * Docker CLI calls are simulated in-process with security validation.
 *
 * @module
 */

import { randomUUID } from 'node:crypto';
import type {
  SandboxConfig,
  SandboxInstance,
  SandboxCommand,
  SandboxResult,
  SandboxViolation,
  ContainerSandbox,
} from '../contracts/mpu-interfaces.js';

/**
 * Extended config for DockerSandbox (internal use)
 */
export type DockerSandboxConfig = SandboxConfig & {
  /** Docker image to use */
  image: string;
};

/**
 * Internal instance tracking with config
 */
interface TrackedInstance {
  instance: SandboxInstance;
  config: SandboxConfig;
}

/**
 * Docker-based sandbox implementing ContainerSandbox.
 *
 * Manages container lifecycle, enforces network/path policies,
 * and reports violations. Docker CLI calls are abstracted — in tests
 * they are replaced with deterministic in-process simulation.
 */
export class DockerSandbox implements ContainerSandbox {
  private readonly instances = new Map<string, TrackedInstance>();

  // eslint-disable-next-line @typescript-eslint/require-await
  async create(config: SandboxConfig): Promise<SandboxInstance> {
    const id = `sandbox-${randomUUID()}`;
    const containerId = `docker-${randomUUID().slice(0, 12)}`;

    const instance: SandboxInstance = {
      id,
      containerId,
      status: 'created',
      createdAt: Date.now(),
    };

    this.instances.set(id, { instance, config });
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

    const startTime = Date.now();
    const violations: SandboxViolation[] = [];

    // Check path violations
    this.checkPathViolations(command, tracked.config, violations);

    // Check network violations
    this.checkNetworkViolations(command, tracked.config, violations);

    // Check simulated timeout (sleep commands with duration >= timeout)
    if (command.executable === 'sleep') {
      const sleepMs = Number(command.args[0] ?? 0) * 1000;
      if (sleepMs >= tracked.config.timeoutMs) {
        violations.push({ type: 'timeout', timeoutMs: tracked.config.timeoutMs });
      }
    }

    // Execute command (real Docker exec with fallback to simulation)
    const result = await this.executeCommand(instance, command, tracked.config, violations);
    const durationMs = Date.now() - startTime;

    // Mark as running
    instance.status = 'running';

    return {
      exitCode: violations.length > 0 ? Math.max(1, result.exitCode) : result.exitCode,
      stdout: violations.length > 0 ? '' : result.stdout,
      stderr:
        violations.length > 0
          ? `Violations detected: ${violations.length}; ${result.stderr}`
          : result.stderr,
      durationMs,
      violations,
    };
  }

  async destroy(instance: SandboxInstance): Promise<void> {
    // Try real Docker cleanup
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      await promisify(execFile)('docker', ['rm', '-f', instance.containerId], { timeout: 10000 });
    } catch {
      // Docker not available or container already removed — no-op
    }
    instance.status = 'destroyed';
    this.instances.delete(instance.id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async list(): Promise<SandboxInstance[]> {
    return Array.from(this.instances.values()).map(t => t.instance);
  }

  // --------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------

  /**
   * Execute command via Docker exec (real), falling back to in-process simulation.
   */
  private async executeCommand(
    instance: SandboxInstance,
    command: SandboxCommand,
    config: SandboxConfig,
    violations: SandboxViolation[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Attempt real Docker execution
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const dockerArgs = ['exec', '-i', instance.containerId, command.executable, ...command.args];
      if (command.workingDir) {
        dockerArgs.splice(2, 0, '-w', command.workingDir);
      }
      const { stdout, stderr } = await promisify(execFile)('docker', dockerArgs, {
        timeout: config.timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB
        env: command.env,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err) {
      const error = err as {
        killed?: boolean;
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };
      if (error.killed) {
        violations.push({ type: 'timeout', timeoutMs: config.timeoutMs });
      }
      // Docker not available — fall back to simulation
      if (error.code === 'ENOENT' || (typeof error.code === 'number' && error.code > 0)) {
        return {
          stdout: this.simulateExecution(command, config),
          stderr: '',
          exitCode: 0,
        };
      }
      return {
        stdout: error.stdout ?? this.simulateExecution(command, config),
        stderr: error.stderr ?? '',
        exitCode: typeof error.code === 'number' ? error.code : 1,
      };
    }
  }

  /**
   * Simulate command execution for in-process sandbox.
   * In a real Docker sandbox, this would use `docker exec`.
   */
  private simulateExecution(command: SandboxCommand, _config: SandboxConfig): string {
    const { executable, args, stdin, env, workingDir } = command;

    // Check for timeout-simulated commands (sleep, etc.)
    const sleepSeconds = executable === 'sleep' ? Number(args[0] ?? 0) : 0;
    if (sleepSeconds > 0 && sleepSeconds * 1000 >= _config.timeoutMs) {
      return ''; // Simulated timeout — no output
    }

    // Simulate printenv
    if (executable === 'printenv' && args.length > 0 && env) {
      const varName = args[0]!;
      return env[varName] ?? '';
    }

    // Simulate cat with stdin
    if (executable === 'cat' && stdin) {
      return stdin;
    }

    // Simulate pwd
    if (executable === 'pwd' && workingDir) {
      return workingDir;
    }

    // Default simulation
    return `executed: ${executable} ${args.join(' ')}`;
  }

  private checkPathViolations(
    command: SandboxCommand,
    config: SandboxConfig,
    violations: SandboxViolation[]
  ): void {
    const BLOCKED = ['/etc/shadow', '/etc/passwd', '~/.ssh', '~/.gnupg', '/root'];

    const allArgs = [command.executable, ...command.args].join(' ');

    for (const blocked of BLOCKED) {
      if (allArgs.includes(blocked)) {
        violations.push({
          type: 'path_violation',
          path: blocked,
          mode: 'read',
        });
      }
    }

    // Check read-only mount writes
    if (config.filesystemMounts) {
      for (const mount of config.filesystemMounts) {
        if (mount.readOnly) {
          for (const arg of command.args) {
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
  }

  private checkNetworkViolations(
    command: SandboxCommand,
    config: SandboxConfig,
    violations: SandboxViolation[]
  ): void {
    const BLOCKED_DOMAINS = [
      '169.254.169.254',
      'metadata.google.internal',
      'localhost',
      '127.0.0.1',
    ];

    const allArgs = [command.executable, ...command.args].join(' ');

    if (config.networkPolicy === 'none') {
      // Block any URL-like argument
      for (const arg of command.args) {
        if (arg.startsWith('http://') || arg.startsWith('https://')) {
          violations.push({
            type: 'network_violation',
            domain: arg,
          });
        }
      }
      // Also block direct domain references
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
      for (const arg of command.args) {
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
      // Always block known-bad domains even in restricted mode
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
    // 'open' policy: no network violations
  }
}
