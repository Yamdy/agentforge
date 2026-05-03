/**
 * MPU-M3: Process Sandbox Tests
 *
 * Tests for ProcessSandbox implementing ContainerSandbox interface.
 * Uses child_process.execFile for lightweight process-level isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SandboxInstance, SandboxCommand } from '../../src/contracts/mpu-interfaces.js';
import type { ProcessSandboxConfig } from '../../src/sandbox/process-sandbox.js';
import { ProcessSandbox } from '../../src/sandbox/process-sandbox.js';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ============================================================
// Default Config Helper
// ============================================================

function defaultConfig(overrides?: Partial<ProcessSandboxConfig>): ProcessSandboxConfig {
  return {
    image: 'node:18-alpine',
    cpuLimit: '1.0',
    memoryLimit: '512m',
    timeoutMs: 30000,
    networkPolicy: 'none',
    workDir: tmpdir(),
    ...overrides,
  };
}

function defaultCommand(overrides?: Partial<SandboxCommand>): SandboxCommand {
  return {
    executable: 'node',
    args: ['-e', 'process.stdout.write("hello")'],
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('ProcessSandbox', () => {
  let sandbox: ProcessSandbox;

  beforeEach(() => {
    sandbox = new ProcessSandbox();
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

    it('should default workDir to process.cwd() when not provided', async () => {
      const config = defaultConfig();
      delete (config as Record<string, unknown>).workDir;
      const instance = await sandbox.create(config);

      expect(instance.status).toBe('created');
    });

    it('should support filesystem mounts in config', async () => {
      const config = defaultConfig({
        workDir: tmpdir(),
        filesystemMounts: [
          { hostPath: tmpdir(), containerPath: '/workspace', readOnly: false },
          { hostPath: tmpdir(), containerPath: '/data', readOnly: true },
        ],
      });
      const instance = await sandbox.create(config);

      expect(instance.status).toBe('created');
    });
  });

  // --------------------------------------------------------
  // execute() - basic
  // --------------------------------------------------------
  describe('execute()', () => {
    let instance: SandboxInstance;

    beforeEach(async () => {
      instance = await sandbox.create(defaultConfig());
    });

    it('should execute a simple command and return exitCode 0', async () => {
      const result = await sandbox.execute(
        instance,
        defaultCommand({ executable: 'node', args: ['-e', 'process.stdout.write("hello")'] })
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello');
      expect(result.stderr).toBe('');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.violations)).toBe(true);
    });

    it('should capture stderr and non-zero exit code on failure', async () => {
      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stderr.write("error msg"); process.exit(1)'],
        }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error msg');
    });

    it('should throw if instance not found', async () => {
      const ghost: SandboxInstance = {
        id: 'nonexistent',
        containerId: 'ghost',
        status: 'created',
        createdAt: Date.now(),
      };

      await expect(
        sandbox.execute(ghost, defaultCommand())
      ).rejects.toThrow();
    });

    it('should throw if instance is destroyed', async () => {
      await sandbox.destroy(instance);

      await expect(
        sandbox.execute(instance, defaultCommand())
      ).rejects.toThrow();
    });

    it('should pass stdin to command when provided', async () => {
      // node process reads stdin as UTF-8 by default
      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdin.on("data", d => process.stdout.write(d))'],
          stdin: 'hello from stdin',
        }
      );

      expect(result.stdout).toContain('hello from stdin');
    });
  });

  // --------------------------------------------------------
  // execute() - timeout enforcement
  // --------------------------------------------------------
  describe('timeout enforcement', () => {
    it('should enforce timeout and report violation', async () => {
      const instance = await sandbox.create(
        defaultConfig({ timeoutMs: 500 })
      );

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'setTimeout(() => {}, 30000)'],
        }
      );

      const timeoutViolations = result.violations.filter(
        (v) => v.type === 'timeout'
      );
      expect(timeoutViolations.length).toBeGreaterThan(0);
      expect(timeoutViolations[0]!.timeoutMs).toBe(500);
    });

    it('should not report timeout when command finishes within limit', async () => {
      const instance = await sandbox.create(
        defaultConfig({ timeoutMs: 10000 })
      );

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write("fast")'],
        }
      );

      expect(result.exitCode).toBe(0);
      const timeoutViolations = result.violations.filter(
        (v) => v.type === 'timeout'
      );
      expect(timeoutViolations).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // execute() - cwd restriction
  // --------------------------------------------------------
  describe('cwd restriction', () => {
    it('should reject commands with workingDir outside workDir', async () => {
      const workDir = tmpdir();
      const instance = await sandbox.create(
        defaultConfig({ workDir })
      );

      // Try to access parent of workDir (which should be outside)
      const outsideDir = resolve(workDir, '..');
      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write(process.cwd())'],
          workingDir: outsideDir,
        }
      );

      // Should have path_violation or exit code non-zero
      const pathViolations = result.violations.filter(
        (v) => v.type === 'path_violation'
      );
      expect(pathViolations.length).toBeGreaterThan(0);
    });

    it('should allow commands within workDir', async () => {
      const workDir = tmpdir();
      const instance = await sandbox.create(
        defaultConfig({ workDir })
      );

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write(process.cwd())'],
          workingDir: workDir,
        }
      );

      expect(result.exitCode).toBe(0);
      const pathViolations = result.violations.filter(
        (v) => v.type === 'path_violation'
      );
      expect(pathViolations).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // execute() - env filtering
  // --------------------------------------------------------
  describe('env filtering', () => {
    it('should not pass secret env vars to subprocess', async () => {
      const instance = await sandbox.create(defaultConfig());

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write(process.env.MY_API_KEY || "NOT_SET")'],
          env: { MY_API_KEY: 'sk-secret-12345', NORMAL_VAR: 'visible' },
        }
      );

      // MY_API_KEY should be filtered out (contains API_KEY)
      expect(result.stdout).not.toContain('sk-secret-12345');
      expect(result.stdout).toContain('NOT_SET');
    });

    it('should not pass TOKEN vars to subprocess', async () => {
      const instance = await sandbox.create(defaultConfig());

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write(process.env.GITHUB_TOKEN || "NOT_FOUND")'],
          env: { GITHUB_TOKEN: 'ghp_secret' },
        }
      );

      expect(result.stdout).not.toContain('ghp_secret');
    });

    it('should not pass SECRET vars to subprocess', async () => {
      const instance = await sandbox.create(defaultConfig());

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write(process.env.SECRET_VALUE || "EMPTY")'],
          env: { SECRET_VALUE: 'top-secret' },
        }
      );

      expect(result.stdout).not.toContain('top-secret');
    });

    it('should not pass PASSWORD vars to subprocess', async () => {
      const instance = await sandbox.create(defaultConfig());

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write(process.env.DB_PASSWORD || "NONE")'],
          env: { DB_PASSWORD: 'hunter2' },
        }
      );

      expect(result.stdout).not.toContain('hunter2');
    });

    it('should pass whitelisted non-sensitive vars', async () => {
      const instance = await sandbox.create(defaultConfig());

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write(process.env.MY_NORMAL_VAR || "MISSING")'],
          env: { MY_NORMAL_VAR: 'hello-world' },
        }
      );

      expect(result.stdout).toContain('hello-world');
    });

    it('should include whitelisted system env vars', async () => {
      const instance = await sandbox.create(
        defaultConfig({ envWhitelist: ['PATH', 'TEMP'] })
      );

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write(process.env.PATH ? "HAS_PATH" : "NO_PATH")'],
        }
      );

      expect(result.stdout).toContain('HAS_PATH');
    });
  });

  // --------------------------------------------------------
  // execute() - network policy
  // --------------------------------------------------------
  describe('network policy', () => {
    it('should block network commands with none policy (curl)', async () => {
      const instance = await sandbox.create(
        defaultConfig({ networkPolicy: 'none' })
      );

      const result = await sandbox.execute(
        instance,
        { executable: 'curl', args: ['https://example.com'] }
      );

      const networkViolations = result.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(networkViolations.length).toBeGreaterThan(0);
    });

    it('should block network commands with none policy (wget)', async () => {
      const instance = await sandbox.create(
        defaultConfig({ networkPolicy: 'none' })
      );

      const result = await sandbox.execute(
        instance,
        { executable: 'wget', args: ['https://example.com'] }
      );

      const networkViolations = result.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(networkViolations.length).toBeGreaterThan(0);
    });

    it('should allow network commands with open policy', async () => {
      const instance = await sandbox.create(
        defaultConfig({ networkPolicy: 'open' })
      );

      const result = await sandbox.execute(
        instance,
        { executable: 'curl', args: ['https://example.com'] }
      );

      const networkViolations = result.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(networkViolations).toHaveLength(0);
    });

    it('should block by URL pattern in args with none policy', async () => {
      const instance = await sandbox.create(
        defaultConfig({ networkPolicy: 'none' })
      );

      const result = await sandbox.execute(
        instance,
        { executable: 'node', args: ['-e', '""', 'https://evil.com'] }
      );

      // The args contain an http URL, should trigger network violation
      const networkViolations = result.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(networkViolations.length).toBeGreaterThan(0);
    });

    it('should block metadata service IP in restricted mode', async () => {
      const instance = await sandbox.create(
        defaultConfig({ networkPolicy: 'restricted', allowedDomains: [] })
      );

      const result = await sandbox.execute(
        instance,
        { executable: 'curl', args: ['http://169.254.169.254/latest/meta-data'] }
      );

      const networkViolations = result.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(networkViolations.length).toBeGreaterThan(0);
    });

    it('should allow whitelisted domains in restricted mode', async () => {
      const instance = await sandbox.create(
        defaultConfig({
          networkPolicy: 'restricted',
          allowedDomains: ['example.com'],
        })
      );

      const result = await sandbox.execute(
        instance,
        { executable: 'curl', args: ['https://example.com/api'] }
      );

      const networkViolations = result.violations.filter(
        (v) => v.type === 'network_violation'
      );
      expect(networkViolations).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // execute() - path violation
  // --------------------------------------------------------
  describe('path violations', () => {
    it('should report path violations for blocked paths', async () => {
      const instance = await sandbox.create(defaultConfig());

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write("test")', '/etc/shadow'],
        }
      );

      const pathViolations = result.violations.filter(
        (v) => v.type === 'path_violation'
      );
      expect(pathViolations.length).toBeGreaterThan(0);
      expect(pathViolations[0]!.path).toBe('/etc/shadow');
    });

    it('should report path violations for read-only mount writes', async () => {
      const workDir = tmpdir();
      const instance = await sandbox.create(
        defaultConfig({
          workDir,
          filesystemMounts: [
            { hostPath: join(workDir, 'data'), containerPath: '/data', readOnly: true },
          ],
        })
      );

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write("test")', '/data/file.txt'],
        }
      );

      const writeViolations = result.violations.filter(
        (v) => v.type === 'path_violation' && v.mode === 'write'
      );
      expect(writeViolations.length).toBeGreaterThan(0);
    });

    it('should block multiple blocked paths in one command', async () => {
      const instance = await sandbox.create(defaultConfig());

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', '""', '/etc/shadow', '/etc/passwd'],
        }
      );

      const pathViolations = result.violations.filter(
        (v) => v.type === 'path_violation'
      );
      expect(pathViolations.length).toBeGreaterThanOrEqual(2);
    });
  });

  // --------------------------------------------------------
  // execute() - output truncation
  // --------------------------------------------------------
  describe('output truncation', () => {
    it('should truncate large stdout output', async () => {
      const instance = await sandbox.create(
        defaultConfig({ maxOutputChars: 100 })
      );

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write("x".repeat(5000))'],
        }
      );

      expect(result.stdout.length).toBe(100);
    });

    it('should truncate large stderr output', async () => {
      const instance = await sandbox.create(
        defaultConfig({ maxOutputChars: 100 })
      );

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stderr.write("y".repeat(5000)); process.exit(1)'],
        }
      );

      expect(result.stderr.length).toBeLessThanOrEqual(100);
    });

    it('should not truncate small output', async () => {
      const instance = await sandbox.create(
        defaultConfig({ maxOutputChars: 100000 })
      );

      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write("small output")'],
        }
      );

      expect(result.stdout).toBe('small output');
      expect(result.stdout.length).toBeLessThan(100000);
    });

    it('should use default maxOutputChars of 100000', async () => {
      const instance = await sandbox.create(defaultConfig());

      // Output under 100K should not be truncated
      const result = await sandbox.execute(
        instance,
        {
          executable: 'node',
          args: ['-e', 'process.stdout.write("ok")'],
        }
      );

      expect(result.stdout).toBe('ok');
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
});
