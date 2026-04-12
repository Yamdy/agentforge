import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sandbox, createSandbox } from '../../src/sandbox/sandbox.js';

describe('Sandbox', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = createSandbox({
      allowedPaths: [process.cwd()],
      timeout: 5000,
    });
  });

  afterEach(() => {
    sandbox.dispose();
  });

  it('should execute command and return result', async () => {
    const result = await sandbox.execute('echo hello');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('should check if path is allowed', () => {
    expect(sandbox.isPathAllowed('./src/index.ts')).toBe(true);
    expect(sandbox.isPathAllowed('/etc/passwd')).toBe(false);
  });

  it('should kill running process', async () => {
    const executePromise = sandbox.execute('ping -n 10 127.0.0.1');

    // 稍后终止
    setTimeout(() => sandbox.kill(), 100);

    const result = await executePromise;
    expect(result.timedOut).toBe(true);
  }, 10000);
});
