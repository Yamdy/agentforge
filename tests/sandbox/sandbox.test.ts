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

  it('should allow non-sensitive paths under allowed directory', () => {
    // ./src/index.ts should be allowed because:
    // 1. it's under the allowed working directory (cwd) which is in allowedPaths
    // 2. it doesn't match any of the default denied patterns
    expect(sandbox.isPathAllowed('./src/index.ts')).toBe(true);
  });

  it('should deny default sensitive paths like .env', () => {
    // .env should be denied by default even though it's under allowed directory
    expect(sandbox.isPathAllowed('./.env')).toBe(false);
  });

  it('should deny /etc/passwd by default', () => {
    // /etc/passwd should be denied because:
    // 1. it's outside the allowed working directory
    // 2. it also matches default denied pattern '*/passwd*' → yes it does, so denied because 1
    expect(sandbox.isPathAllowed('/etc/passwd')).toBe(false);
  });

  it('should kill running process', async () => {
    const executePromise = sandbox.execute('sleep 10');

    // kill after timeout
    setTimeout(() => sandbox.kill(), 100);

    const result = await executePromise;
    expect(result.timedOut).toBe(true);
  }, 10000);
});
