/**
 * Sandbox Factory — Sandbox Selection Strategy
 *
 * Provides a unified factory for creating sandbox instances based on
 * configuration mode. Supports Docker, process-level, and none modes
 * with automatic fallback when Docker is unavailable.
 *
 * @module
 */

import type { ContainerSandbox, SandboxConfig } from '../contracts/mpu-interfaces.js';
import { DockerSandbox } from './docker-sandbox.js';

// Lazy import to avoid loading process-sandbox when unused
let _ProcessSandbox: typeof import('./process-sandbox.js').ProcessSandbox | null = null;
async function getProcessSandbox(): Promise<typeof import('./process-sandbox.js').ProcessSandbox> {
  if (!_ProcessSandbox) {
    const mod = await import('./process-sandbox.js');
    _ProcessSandbox = mod.ProcessSandbox;
  }
  return _ProcessSandbox;
}

// ============================================================
// Types
// ============================================================

/**
 * Sandbox execution mode.
 * - 'docker': Docker container isolation (requires Docker)
 * - 'process': Lightweight child_process isolation
 * - 'none': No sandbox (passthrough)
 */
export type SandboxMode = 'docker' | 'process' | 'none';

/**
 * Configuration for sandbox factory.
 */
export interface SandboxFactoryConfig {
  /** Preferred sandbox mode */
  mode: SandboxMode;
  /** Fallback to process sandbox if Docker unavailable (default: true) */
  fallbackToProcess?: boolean;
  /** Docker-specific config (used when mode='docker') */
  dockerConfig?: { image: string };
}

// ============================================================
// No-op Sandbox (mode='none')
// ============================================================

class NoopSandbox implements ContainerSandbox {
  private instances = new Map<string, SandboxConfig>();
  private counter = 0;

  // eslint-disable-next-line @typescript-eslint/require-await
  async create(config: SandboxConfig) {
    const id = `noop-${Date.now()}-${++this.counter}`;
    this.instances.set(id, config);
    return { id, containerId: id, status: 'created' as const, createdAt: Date.now() };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute() {
    return {
      exitCode: 0,
      stdout: '[NoopSandbox] execution bypassed',
      stderr: '',
      durationMs: 0,
      violations: [],
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async destroy(instance: { id: string }) {
    this.instances.delete(instance.id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async list() {
    return Array.from(this.instances.keys()).map(id => ({
      id,
      containerId: id,
      status: 'created' as const,
      createdAt: 0,
    }));
  }
}

// ============================================================
// Docker availability check
// ============================================================

let dockerAvailable: boolean | null = null;

/**
 * Check if Docker is available on the system.
 * Cached after first call.
 */
export async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailable !== null) return dockerAvailable;
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    await promisify(execFile)('docker', ['--version'], { timeout: 5000 });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

// ============================================================
// Factory
// ============================================================

/**
 * Create a sandbox instance based on configuration.
 *
 * Mode resolution:
 * 1. 'docker' → DockerSandbox (with fallback to process if configured)
 * 2. 'process' → ProcessSandbox
 * 3. 'none' → NoopSandbox
 *
 * @param config — Sandbox mode and fallback settings
 * @returns ContainerSandbox instance ready for use
 */
export async function createSandbox(
  config: SandboxFactoryConfig = { mode: 'process' }
): Promise<ContainerSandbox> {
  if (config.mode === 'docker') {
    const available = await isDockerAvailable();
    if (available) {
      return new DockerSandbox();
    }
    if (config.fallbackToProcess !== false) {
      const PS = await getProcessSandbox();
      return new PS();
    }
    throw new Error(
      'Docker sandbox requested but Docker is not available, and fallbackToProcess is disabled'
    );
  }

  if (config.mode === 'process') {
    const PS = await getProcessSandbox();
    return new PS();
  }

  return new NoopSandbox();
}

/**
 * Synchronous factory that uses process sandbox by default.
 * Does NOT attempt Docker (useful when Docker availability is known).
 */
export async function createProcessSandbox(): Promise<ContainerSandbox> {
  const PS = await getProcessSandbox();
  return new PS();
}

/**
 * Synchronous factory for no-op sandbox.
 */
export function createNoopSandbox(): ContainerSandbox {
  return new NoopSandbox();
}
