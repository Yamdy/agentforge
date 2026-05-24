import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandExecutor } from '../../src/sandbox/executor.js';
import { createPolicy } from '../../src/sandbox/policy.js';

describe('CommandExecutor', () => {
  let executor: CommandExecutor;

  beforeEach(() => {
    const policy = createPolicy({
      allowedPaths: [process.cwd()],
      timeout: 5000,
    });
    executor = new CommandExecutor(policy);
  });

  afterEach(() => {
    executor.dispose();
  });

  it('should execute simple command', async () => {
    const result = await executor.execute('echo', ['hello']);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('should capture stderr', async () => {
    const result = await executor.execute('node', ['-e', 'console.error("error")']);
    expect(result.stderr).toContain('error');
  });

  it('should timeout on long running command', async () => {
    const shortPolicy = createPolicy({ timeout: 100 });
    const shortExecutor = new CommandExecutor(shortPolicy);

    // Windows: use ping as a delay command
    const result = await shortExecutor.execute('ping', ['-n', '10', '127.0.0.1']);
    expect(result.timedOut).toBe(true);

    shortExecutor.dispose();
  }, 10000);

  it('should track duration', async () => {
    const result = await executor.execute('echo', ['test']);
    expect(result.duration).toBeGreaterThan(0);
  });
});
