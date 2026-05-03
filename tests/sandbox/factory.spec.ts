/**
 * Sandbox Factory Tests
 *
 * Tests for sandbox selection strategy and factory functions.
 */

import { describe, it, expect } from 'vitest';
import { createNoopSandbox, createProcessSandbox } from '../../src/sandbox/factory.js';
import type { ContainerSandbox } from '../../src/contracts/mpu-interfaces.js';

// ============================================================
// NoopSandbox
// ============================================================

describe('NoopSandbox', () => {
  let sandbox: ContainerSandbox;

  beforeEach(async () => {
    sandbox = createNoopSandbox();
  });

  it('should create an instance', async () => {
    const instance = await sandbox.create({
      image: 'none',
      cpuLimit: '1.0',
      memoryLimit: '256m',
      timeoutMs: 30000,
      networkPolicy: 'open',
    });
    expect(instance.id).toBeDefined();
    expect(instance.status).toBe('created');
  });

  it('should execute command (passthrough)', async () => {
    const instance = await sandbox.create({
      image: 'none', cpuLimit: '1.0', memoryLimit: '256m', timeoutMs: 30000, networkPolicy: 'open',
    });
    const result = await sandbox.execute(instance, { executable: 'echo', args: ['hello'] });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toEqual([]);
  });

  it('should destroy instance', async () => {
    const instance = await sandbox.create({
      image: 'none', cpuLimit: '1.0', memoryLimit: '256m', timeoutMs: 30000, networkPolicy: 'open',
    });
    await sandbox.destroy(instance);
    const list = await sandbox.list();
    expect(list).toHaveLength(0);
  });

  it('should list created instances', async () => {
    await sandbox.create({ image: 'none', cpuLimit: '1.0', memoryLimit: '256m', timeoutMs: 30000, networkPolicy: 'open' });
    await sandbox.create({ image: 'none', cpuLimit: '1.0', memoryLimit: '256m', timeoutMs: 30000, networkPolicy: 'open' });
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
});
