/**
 * MPU-M3: Docker Sandbox Isolation Tests
 *
 * Tests for DockerSandbox implementing ContainerSandbox interface.
 * Docker process calls are mocked; logic is fully tested.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DockerSandbox,
  type DockerSandboxConfig,
} from '../../src/sandbox/docker-sandbox.js';
import type {
  SandboxConfig,
  SandboxInstance,
  SandboxCommand,
} from '../../src/contracts/mpu-interfaces.js';

// ============================================================
// Default Config Helper
// ============================================================

function defaultConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    image: 'node:18-alpine',
    cpuLimit: '1.0',
    memoryLimit: '512m',
    timeoutMs: 30000,
    networkPolicy: 'none',
    ...overrides,
  };
}

function defaultCommand(overrides?: Partial<SandboxCommand>): SandboxCommand {
  return {
    executable: 'echo',
    args: ['hello'],
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('DockerSandbox', () => {
  let sandbox: DockerSandbox;

  beforeEach(() => {
    sandbox = new DockerSandbox();
  });

  // --------------------------------------------------------
  // create()
  // --------------------------------------------------------
  describe('create()', () => {
    it('should create a sandbox instance with correct properties', async () => {
      const config = defaultConfig();
      const instance = await sandbox.create(config);

      expect(instance.id).toBeDefined();
      expect(typeof instance.id).toBe('string');
      expect(instance.id.length).toBeGreaterThan(0);
      expect(instance.containerId).toBeDefined();
      expect(instance.status).toBe('created');
      expect(instance.createdAt).toBeGreaterThan(0);
    });

    it('should assign unique IDs to different instances', async () => {
      const config = defaultConfig();
      const a = await sandbox.create(config);
      const b = await sandbox.create(config);

      expect(a.id).not.toBe(b.id);
      expect(a.containerId).not.toBe(b.containerId);
    });

    it('should store config on the instance for later use', async () => {
      const config = defaultConfig({
        image: 'python:3.11-slim',
        cpuLimit: '2.0',
        memoryLimit: '1g',
        timeoutMs: 60000,
        networkPolicy: 'restricted',
        allowedDomains: ['pypi.org'],
      });
      const instance = await sandbox.create(config);

      expect(instance.status).toBe('created');
      // Config should be retrievable via the sandbox
      const instances = await sandbox.list();
      expect(instances).toContainEqual(instance);
    });

    it('should support filesystem mounts in config', async () => {
      const config = defaultConfig({
        filesystemMounts: [
          { hostPath: '/tmp/workspace', containerPath: '/workspace', readOnly: false },
          { hostPath: '/tmp/data', containerPath: '/data', readOnly: true },
        ],
      });
      const instance = await sandbox.create(config);

      expect(instance.status).toBe('created');
    });
  });

  // --------------------------------------------------------
  // execute()
  // --------------------------------------------------------
  describe('execute()', () => {
    let instance: SandboxInstance;

    beforeEach(async () => {
      instance = await sandbox.create(defaultConfig());
    });

    it('should execute a command and return result', async () => {
      const result = await sandbox.execute(instance, defaultCommand());

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeDefined();
      expect(result.stderr).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.violations)).toBe(true);
    });

    it('should record path violations for blocked paths', async () => {
      const result = await sandbox.execute(
        instance,
        defaultCommand({ executable: 'cat', args: ['/etc/shadow'] })
      );

      const pathViolations = result.violations.filter(
        (v) => v.type === 'path_violation'
      );
      expect(pathViolations.length).toBeGreaterThan(0);
      expect(pathViolations[0]).toHaveProperty('path', '/etc/shadow');
    });

    it('should record path violations for write on read-only mounts', async () => {
      const readOnlyInstance = await sandbox.create(
        defaultConfig({
          filesystemMounts: [
            { hostPath: '/tmp/data', containerPath: '/data', readOnly: true },
          ],
        })
      );

      const result = await sandbox.execute(
        readOnlyInstance,
        defaultCommand({ executable: 'touch', args: ['/data/file.txt'] })
      );

      const pathViolations = result.violations.filter(
        (v) => v.type === 'path_violation' && v.mode === 'write'
      );
      expect(pathViolations.length).toBeGreaterThan(0);
    });

    it('should record network violations for blocked domains', async () => {
      const restrictedInstance = await sandbox.create(
        defaultConfig({ networkPolicy: 'restricted', allowedDomains: [] })
      );

      const result = await sandbox.execute(
        restrictedInstance,
        defaultCommand({ executable: 'curl', args: ['http://169.254.169.254'] })
      );

      const networkViolations = result.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(networkViolations.length).toBeGreaterThan(0);
    });

    it('should record timeout violation when command exceeds limit', async () => {
      const shortTimeoutInstance = await sandbox.create(
        defaultConfig({ timeoutMs: 50 })
      );

      const result = await sandbox.execute(
        shortTimeoutInstance,
        defaultCommand({ executable: 'sleep', args: ['10'] })
      );

      const timeoutViolations = result.violations.filter(
        (v) => v.type === 'timeout'
      );
      expect(timeoutViolations.length).toBeGreaterThan(0);
      expect(result.exitCode).not.toBe(0);
    });

    it('should throw if instance is not in created or running status', async () => {
      await sandbox.destroy(instance);

      await expect(
        sandbox.execute(instance, defaultCommand())
      ).rejects.toThrow();
    });

    it('should pass environment variables to command', async () => {
      const result = await sandbox.execute(
        instance,
        defaultCommand({
          executable: 'printenv',
          args: ['MY_VAR'],
          env: { MY_VAR: 'test-value' },
        })
      );

      expect(result.stdout).toContain('test-value');
    });

    it('should pass stdin to command', async () => {
      const result = await sandbox.execute(
        instance,
        defaultCommand({
          executable: 'cat',
          args: [],
          stdin: 'hello from stdin',
        })
      );

      expect(result.stdout).toContain('hello from stdin');
    });

    it('should respect working directory', async () => {
      const result = await sandbox.execute(
        instance,
        defaultCommand({
          executable: 'pwd',
          args: [],
          workingDir: '/tmp',
        })
      );

      expect(result.stdout).toContain('/tmp');
    });
  });

  // --------------------------------------------------------
  // destroy()
  // --------------------------------------------------------
  describe('destroy()', () => {
    it('should destroy a sandbox instance', async () => {
      const instance = await sandbox.create(defaultConfig());
      await sandbox.destroy(instance);

      expect(instance.status).toBe('destroyed');
    });

    it('should remove instance from list after destroy', async () => {
      const instance = await sandbox.create(defaultConfig());
      await sandbox.destroy(instance);

      const instances = await sandbox.list();
      expect(instances).not.toContainEqual(instance);
    });

    it('should be idempotent - destroying twice does not throw', async () => {
      const instance = await sandbox.create(defaultConfig());
      await sandbox.destroy(instance);
      await sandbox.destroy(instance); // should not throw

      expect(instance.status).toBe('destroyed');
    });
  });

  // --------------------------------------------------------
  // list()
  // --------------------------------------------------------
  describe('list()', () => {
    it('should return empty array when no instances exist', async () => {
      const instances = await sandbox.list();
      expect(instances).toEqual([]);
    });

    it('should list all active instances', async () => {
      const a = await sandbox.create(defaultConfig());
      const b = await sandbox.create(defaultConfig());

      const instances = await sandbox.list();
      expect(instances).toHaveLength(2);
      expect(instances).toContainEqual(a);
      expect(instances).toContainEqual(b);
    });

    it('should not include destroyed instances', async () => {
      const a = await sandbox.create(defaultConfig());
      const b = await sandbox.create(defaultConfig());
      await sandbox.destroy(a);

      const instances = await sandbox.list();
      expect(instances).toHaveLength(1);
      expect(instances[0]).toBe(b);
    });
  });

  // --------------------------------------------------------
  // Network Policy
  // --------------------------------------------------------
  describe('network policy', () => {
    it('should allow all domains with open policy', async () => {
      const openInstance = await sandbox.create(
        defaultConfig({ networkPolicy: 'open' })
      );

      const result = await sandbox.execute(
        openInstance,
        defaultCommand({ executable: 'curl', args: ['https://example.com'] })
      );

      const networkViolations = result.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(networkViolations).toHaveLength(0);
    });

    it('should allow only whitelisted domains with restricted policy', async () => {
      const restrictedInstance = await sandbox.create(
        defaultConfig({
          networkPolicy: 'restricted',
          allowedDomains: ['registry.npmjs.org'],
        })
      );

      const allowedResult = await sandbox.execute(
        restrictedInstance,
        defaultCommand({ executable: 'curl', args: ['https://registry.npmjs.org'] })
      );
      const allowedViolations = allowedResult.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(allowedViolations).toHaveLength(0);

      const blockedResult = await sandbox.execute(
        restrictedInstance,
        defaultCommand({ executable: 'curl', args: ['https://evil.com'] })
      );
      const blockedViolations = blockedResult.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(blockedViolations.length).toBeGreaterThan(0);
    });

    it('should block all network with none policy', async () => {
      const noneInstance = await sandbox.create(
        defaultConfig({ networkPolicy: 'none' })
      );

      const result = await sandbox.execute(
        noneInstance,
        defaultCommand({ executable: 'curl', args: ['https://example.com'] })
      );

      const networkViolations = result.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(networkViolations.length).toBeGreaterThan(0);
    });
  });
});
