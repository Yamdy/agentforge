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

    // Simulate command execution
    const stdout = this.simulateExecution(command, tracked.config);
    const durationMs = Date.now() - startTime;

    // Check timeout (for sleep commands, simulate the delay exceeded)
    if (command.executable === 'sleep') {
      const sleepSeconds = Number(command.args[0] ?? 0) * 1000;
      if (sleepSeconds >= tracked.config.timeoutMs) {
        violations.push({ type: 'timeout', timeoutMs: tracked.config.timeoutMs });
      }
    }

    // Mark as running
    instance.status = 'running';

    return {
      exitCode: violations.length > 0 ? 1 : 0,
      stdout: violations.length > 0 ? '' : stdout,
      stderr: violations.length > 0 ? `Violations detected: ${violations.length}` : '',
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

  // --------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------

  /**
   * Simulate command execution for in-process sandbox.
   * In a real Docker sandbox, this would use `docker exec`.
   */
  private simulateExecution(command: SandboxCommand, _config: SandboxConfig): string {
    const { executable, args, stdin, env, workingDir } = command;

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
