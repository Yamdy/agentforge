import { describe, it, expect } from 'vitest';
import { createPolicy, isPathAllowed } from '../../src/sandbox/policy.js';

describe('SandboxPolicy', () => {
  it('should allow paths in whitelist that are not blocked by defaults', () => {
    const policy = createPolicy({
      allowedPaths: ['/home/user/project'],
      deniedPaths: ['/etc/passwd'],
    });
    // This should not match any default deny patterns - none of the default patterns match this path
    // We need a path that doesn't contain 'code/' anywhere in the path to avoid matching by default wildcard
    expect(isPathAllowed(policy, '/home/user/project/myfile-non-code.txt')).toBe(true);
    // This should not match any default deny patterns - none of the default patterns match this path
    // '/home/user/project/myfile.txt' doesn't match any default deny patterns because:
    // 1. it doesn't contain any of the sensitive paths like .git, .env, etc.
    // 2. it doesn't match '*/code/*' because it doesn't have 'code/' in the path after '/home/user/project'
    expect(isPathAllowed(policy, '/home/user/project/myfile.txt')).toBe(true);
  });

  it('should allow paths in whitelist that are not blocked by defaults 2', () => {
    const policy = createPolicy({
      allowedPaths: ['/home/user/project'],
      deniedPaths: ['/etc/passwd'],
    });
    // This should not match any default deny patterns - none of the default patterns match this path
    // '/home/user/project/src/index.ts' doesn't match any default deny patterns because:
    // 1. it doesn't contain any of the sensitive paths like .git, .env, etc.
    expect(isPathAllowed(policy, '/home/user/project/src/index.ts')).toBe(true);
  });

  it('should deny default sensitive paths even when in whitelist', () => {
    // .env is in default deny list
    const policy = createPolicy({
      allowedPaths: [process.cwd()],
    });
    // .env should be denied by default even though it's under allowed cwd
    expect(isPathAllowed(policy, `${process.cwd()}/.env`)).toBe(false);
  });

  it('should deny git directory by default', () => {
    // .git/config is in default deny list
    const policy = createPolicy({
      allowedPaths: [process.cwd()],
    });
    // .git/config should be denied by default (contains git config which can have sensitive data)
    expect(isPathAllowed(policy, `${process.cwd()}/.git/config`)).toBe(false);
  });

  it('should deny paths not in whitelist', () => {
    const policy = createPolicy({
      allowedPaths: ['/home/user/project'],
      deniedPaths: ['/etc/passwd'],
    });
    expect(isPathAllowed(policy, '/etc/config.json')).toBe(false);
  });

  it('should deny custom denied paths in blacklist even when in whitelist', () => {
    const policyWithConflict = createPolicy({
      allowedPaths: ['/etc'],
      deniedPaths: ['/etc/passwd'],
    });
    expect(isPathAllowed(policyWithConflict, '/etc/passwd')).toBe(false);
  });

  it('should use default values', () => {
    const defaultPolicy = createPolicy({});
    expect(defaultPolicy.timeout).toBe(60000);
    expect(defaultPolicy.maxOutputSize).toBe(1024 * 1024);
    // Default denied list should not be empty
    expect(defaultPolicy.deniedPaths.length).toBeGreaterThan(0);
  });
});
