/**
 * MPU-M6: Blocklist Tests
 *
 * Tests for the hardcoded blocklist constants.
 * These lists are NOT configurable and must contain specific entries.
 */

import { describe, it, expect } from 'vitest';
import {
  BLOCKED_COMMANDS,
  BLOCKED_PATHS,
  BLOCKED_DOMAINS,
  isCommandBlocked,
  isPathBlocked,
  isDomainBlocked,
} from '../../src/security/blocklist.js';

// ============================================================
// BLOCKED_COMMANDS
// ============================================================

describe('BLOCKED_COMMANDS', () => {
  it('should be a readonly array', () => {
    expect(Array.isArray(BLOCKED_COMMANDS)).toBe(true);
    // Verify it's frozen (immutable)
    expect(() => {
      (BLOCKED_COMMANDS as unknown as string[]).push('malicious');
    }).toThrow();
  });

  it('should contain rm -rf /', () => {
    expect(BLOCKED_COMMANDS).toContain('rm -rf /');
  });

  it('should contain rm -rf /*', () => {
    expect(BLOCKED_COMMANDS).toContain('rm -rf /*');
  });

  it('should contain dd if=', () => {
    expect(BLOCKED_COMMANDS).toContain('dd if=');
  });

  it('should contain mkfs', () => {
    expect(BLOCKED_COMMANDS).toContain('mkfs');
  });

  it('should contain fork bomb :(){:|:&};:', () => {
    expect(BLOCKED_COMMANDS).toContain(':(){:|:&};:');
  });

  it('should contain chmod 777', () => {
    expect(BLOCKED_COMMANDS).toContain('chmod 777');
  });

  it('should have exactly 6 entries', () => {
    expect(BLOCKED_COMMANDS).toHaveLength(6);
  });
});

// ============================================================
// BLOCKED_PATHS
// ============================================================

describe('BLOCKED_PATHS', () => {
  it('should be a readonly array', () => {
    expect(Array.isArray(BLOCKED_PATHS)).toBe(true);
    expect(() => {
      (BLOCKED_PATHS as unknown as string[]).push('/malicious');
    }).toThrow();
  });

  it('should contain /etc/shadow', () => {
    expect(BLOCKED_PATHS).toContain('/etc/shadow');
  });

  it('should contain /etc/passwd', () => {
    expect(BLOCKED_PATHS).toContain('/etc/passwd');
  });

  it('should contain ~/.ssh', () => {
    expect(BLOCKED_PATHS).toContain('~/.ssh');
  });

  it('should contain ~/.gnupg', () => {
    expect(BLOCKED_PATHS).toContain('~/.gnupg');
  });

  it('should contain /root', () => {
    expect(BLOCKED_PATHS).toContain('/root');
  });

  it('should have exactly 5 entries', () => {
    expect(BLOCKED_PATHS).toHaveLength(5);
  });
});

// ============================================================
// BLOCKED_DOMAINS
// ============================================================

describe('BLOCKED_DOMAINS', () => {
  it('should be a readonly array', () => {
    expect(Array.isArray(BLOCKED_DOMAINS)).toBe(true);
    expect(() => {
      (BLOCKED_DOMAINS as unknown as string[]).push('malicious.com');
    }).toThrow();
  });

  it('should contain 169.254.169.254', () => {
    expect(BLOCKED_DOMAINS).toContain('169.254.169.254');
  });

  it('should contain metadata.google.internal', () => {
    expect(BLOCKED_DOMAINS).toContain('metadata.google.internal');
  });

  it('should contain localhost', () => {
    expect(BLOCKED_DOMAINS).toContain('localhost');
  });

  it('should contain 127.0.0.1', () => {
    expect(BLOCKED_DOMAINS).toContain('127.0.0.1');
  });

  it('should have exactly 5 entries', () => {
    expect(BLOCKED_DOMAINS).toHaveLength(5);
  });
});

// ============================================================
// Helper functions
// ============================================================

describe('isCommandBlocked()', () => {
  it('should return true for exact blocked command', () => {
    expect(isCommandBlocked('rm -rf /')).toBe(true);
  });

  it('should return true when command contains blocked pattern', () => {
    expect(isCommandBlocked('sudo rm -rf /')).toBe(true);
    expect(isCommandBlocked('echo test && dd if=/dev/zero')).toBe(true);
  });

  it('should return false for safe commands', () => {
    expect(isCommandBlocked('ls -la')).toBe(false);
    expect(isCommandBlocked('npm install')).toBe(false);
    expect(isCommandBlocked('cat file.txt')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isCommandBlocked('')).toBe(false);
  });
});

describe('isPathBlocked()', () => {
  it('should return true for exact blocked path', () => {
    expect(isPathBlocked('/etc/shadow')).toBe(true);
  });

  it('should return true for subdirectory of blocked path', () => {
    expect(isPathBlocked('/root/.config')).toBe(true);
    expect(isPathBlocked('~/.ssh/id_rsa')).toBe(true);
  });

  it('should return false for safe paths', () => {
    expect(isPathBlocked('/tmp/file.txt')).toBe(false);
    expect(isPathBlocked('/home/user/project')).toBe(false);
  });
});

describe('isDomainBlocked()', () => {
  it('should return true for exact blocked domain', () => {
    expect(isDomainBlocked('localhost')).toBe(true);
    expect(isDomainBlocked('127.0.0.1')).toBe(true);
  });

  it('should return true when domain is subdomain of blocked entry', () => {
    expect(isDomainBlocked('sub.localhost')).toBe(true);
  });

  it('should return true for URL with blocked hostname', () => {
    expect(isDomainBlocked('http://localhost:8080')).toBe(true);
    expect(isDomainBlocked('https://localhost')).toBe(true);
  });

  it('should NOT false-positive on domains containing blocked strings', () => {
    // 'localhost' substring should NOT block 'my-localhost.example.com'
    expect(isDomainBlocked('my-localhost.example.com')).toBe(false);
    // '127.0.0.1' should NOT block '10.127.0.0.1' (different IP)
    expect(isDomainBlocked('10.127.0.0.1')).toBe(false);
  });

  it('should return false for safe domains', () => {
    expect(isDomainBlocked('api.openai.com')).toBe(false);
    expect(isDomainBlocked('github.com')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isDomainBlocked('')).toBe(false);
  });
});
