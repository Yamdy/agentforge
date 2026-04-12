import { describe, it, expect } from 'vitest';
import { createPolicy, isPathAllowed } from '../../src/sandbox/policy.js';

describe('SandboxPolicy', () => {
  it('should allow paths in whitelist', () => {
    const policy = createPolicy({
      allowedPaths: ['/home/user/project'],
      deniedPaths: ['/etc/passwd'],
    });
    expect(isPathAllowed(policy, '/home/user/project/src/index.ts')).toBe(true);
  });

  it('should deny paths not in whitelist', () => {
    const policy = createPolicy({
      allowedPaths: ['/home/user/project'],
      deniedPaths: ['/etc/passwd'],
    });
    expect(isPathAllowed(policy, '/etc/config.json')).toBe(false);
  });

  it('should deny paths in blacklist even if in whitelist', () => {
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
  });
});
