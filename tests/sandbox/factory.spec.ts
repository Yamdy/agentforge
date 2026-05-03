/**
 * Sandbox Factory Tests
 *
 * Tests for sandbox selection strategy, factory functions,
 * mode routing, fallback logic, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNoopSandbox,
  createProcessSandbox,
  createSandbox,
  isDockerAvailable,
} from '../../src/sandbox/factory.js';
import { DockerSandbox } from '../../src/sandbox/docker-sandbox.js';
import { ProcessSandbox } from '../../src/sandbox/process-sandbox.js';
import type { ContainerSandbox } from '../../src/contracts/mpu-interfaces.js';

// ============================================================
// Mock child_process — control Docker availability
// ============================================================

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>(
    'node:child_process'
  );
  return {
    ...actual,
    execFile: vi.fn((_file: string, _args: string[], _opts: unknown, callback?: (err: Error | null, stdout?: string, stderr?: string) => void) => {
      // Default: Docker is NOT available (callback with error)
      const cb = typeof callback === 'function' ? callback : (_args as unknown as (err: Error | null) => void);
      if (typeof cb === 'function') {
        cb(new Error('Docker not available'));
      }
    }),
  };
});

// ============================================================
// Helpers
// ============================================================

const sandboxConfig = {
  image: 'test-image',
  cpuLimit: '1.0',
  memoryLimit: '256m',
  timeoutMs: 30000,
  networkPolicy: 'open' as const,
};

// ============================================================
// NoopSandbox
// ============================================================

describe('NoopSandbox', () => {
  let sandbox: ContainerSandbox;

  beforeEach(async () => {
    sandbox = createNoopSandbox();
  });

  it('should create an instance', async () => {
    const instance = await sandbox.create(sandboxConfig);
    expect(instance.id).toBeDefined();
    expect(instance.status).toBe('created');
  });

  it('should execute command (passthrough)', async () => {
    const instance = await sandbox.create(sandboxConfig);
    const result = await sandbox.execute(instance, { executable: 'echo', args: ['hello'] });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toEqual([]);
  });

  it('should return passthrough stdout message on execute', async () => {
    const instance = await sandbox.create(sandboxConfig);
    const result = await sandbox.execute(instance, { executable: 'echo', args: ['hello'] });
    expect(result.stdout).toBe('[NoopSandbox] execution bypassed');
  });

  it('should destroy instance', async () => {
    const instance = await sandbox.create(sandboxConfig);
    await sandbox.destroy(instance);
    const list = await sandbox.list();
    expect(list).toHaveLength(0);
  });

  it('should list created instances', async () => {
    await sandbox.create(sandboxConfig);
    await sandbox.create(sandboxConfig);
    const list = await sandbox.list();
    expect(list).toHaveLength(2);
  });
});

// ============================================================
// createProcessSandbox
// ============================================================

describe('createProcessSandbox', () => {
  it('should return a ContainerSandbox instance', async () => {
    const sandbox = await createProcessSandbox();
    expect(sandbox).toBeDefined();
    expect(typeof sandbox.create).toBe('function');
    expect(typeof sandbox.execute).toBe('function');
    expect(typeof sandbox.destroy).toBe('function');
    expect(typeof sandbox.list).toBe('function');
  });

  it('should be a ProcessSandbox instance', async () => {
    const sandbox = await createProcessSandbox();
    expect(sandbox).toBeInstanceOf(ProcessSandbox);
  });
});

// ============================================================
// createSandbox — Mode Routing
// ============================================================

describe('createSandbox mode routing', () => {
  it('should return NoopSandbox when mode="none"', async () => {
    const sandbox = await createSandbox({ mode: 'none' });
    const instance = await sandbox.create(sandboxConfig);
    expect(instance.status).toBe('created');
    const result = await sandbox.execute(instance, { executable: 'echo', args: ['hello'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('NoopSandbox');
  });

  it('should return ProcessSandbox when mode="process"', async () => {
    const sandbox = await createSandbox({ mode: 'process' });
    expect(sandbox).toBeInstanceOf(ProcessSandbox);
  });

  it('should default to mode="process" when no config provided', async () => {
    const sandbox = await createSandbox();
    expect(sandbox).toBeInstanceOf(ProcessSandbox);
  });

  it('should fall back to process when mode="docker" and Docker unavailable', async () => {
    // Docker is mocked as unavailable (default)
    const sandbox = await createSandbox({ mode: 'docker' });
    // Should fall back to ProcessSandbox since fallbackToProcess defaults to true
    expect(sandbox).toBeInstanceOf(ProcessSandbox);
  });

  it('should throw when mode="docker", no Docker, and fallbackToProcess is false', async () => {
    await expect(
      createSandbox({
        mode: 'docker',
        fallbackToProcess: false,
      })
    ).rejects.toThrow(/Docker sandbox requested but Docker is not available/);
  });
});

// ============================================================
// isDockerAvailable
// ============================================================

describe('isDockerAvailable', () => {
  it('should return false when Docker is not available', async () => {
    // execFile is mocked to fail
    const result = await isDockerAvailable();
    expect(result).toBe(false);
  });

  it('should cache result after first call', async () => {
    // Calling twice — second call uses cache
    const r1 = await isDockerAvailable();
    const r2 = await isDockerAvailable();
    expect(r1).toBe(r2);
    expect(r1).toBe(false);
  });
});

// ============================================================
// DockerSandbox (direct — no Docker required)
// ============================================================

describe('DockerSandbox', () => {
  it('should be directly constructible', async () => {
    const sandbox = new DockerSandbox();
    const instance = await sandbox.create(sandboxConfig);
    expect(instance.id).toBeDefined();
    expect(instance.status).toBe('created');
    expect(instance.containerId).toMatch(/^docker-/);
  });

  it('should list created instances', async () => {
    const sandbox = new DockerSandbox();
    await sandbox.create(sandboxConfig);
    const list = await sandbox.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('created');
  });

  it('should destroy instances', async () => {
    const sandbox = new DockerSandbox();
    const instance = await sandbox.create(sandboxConfig);
    await sandbox.destroy(instance);
    const list = await sandbox.list();
    expect(list).toHaveLength(0);
  });
});
