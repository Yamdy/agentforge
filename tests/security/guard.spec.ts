/**
 * MPU-M6: SecurityGuard Tests
 *
 * Tests for the SecurityGuard that validates commands, paths, and network
 * against hardcoded blocklists. Blocklists are NOT configurable.
 */

import { describe, it, expect } from 'vitest';
import { SecurityGuard } from '../../src/security/guard.js';

// ============================================================
// Tests
// ============================================================

describe('SecurityGuard', () => {
  let guard: SecurityGuard;

  beforeEach(() => {
    guard = new SecurityGuard();
  });

  // --------------------------------------------------------
  // checkCommand()
  // --------------------------------------------------------
  describe('checkCommand()', () => {
    it('should allow safe commands', () => {
      const result = guard.checkCommand('ls -la');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should block "rm -rf /"', () => {
      const result = guard.checkCommand('rm -rf /');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should block "rm -rf /*"', () => {
      const result = guard.checkCommand('rm -rf /*');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should block "dd if=" commands', () => {
      const result = guard.checkCommand('dd if=/dev/zero of=/dev/sda');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should block "mkfs" commands', () => {
      const result = guard.checkCommand('mkfs.ext4 /dev/sda1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should block fork bomb ":(){:|:&};:"', () => {
      const result = guard.checkCommand(':(){:|:&};:');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should block "chmod 777"', () => {
      const result = guard.checkCommand('chmod 777 /tmp/file');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should detect blocked commands embedded in larger commands', () => {
      const result = guard.checkCommand('echo test && rm -rf /');
      expect(result.allowed).toBe(false);
    });

    it('should be case-sensitive for command matching', () => {
      // "RM -RF /" should be allowed (different case)
      const result = guard.checkCommand('RM -RF /');
      expect(result.allowed).toBe(true);
    });

    it('should handle empty command string', () => {
      const result = guard.checkCommand('');
      expect(result.allowed).toBe(true);
    });
  });

  // --------------------------------------------------------
  // checkPath()
  // --------------------------------------------------------
  describe('checkPath()', () => {
    it('should block read access to /etc/shadow', () => {
      const result = guard.checkPath('/etc/shadow', 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should block write access to /etc/shadow', () => {
      const result = guard.checkPath('/etc/shadow', 'write');
      expect(result.allowed).toBe(false);
    });

    it('should block read access to /etc/passwd', () => {
      const result = guard.checkPath('/etc/passwd', 'read');
      expect(result.allowed).toBe(false);
    });

    it('should block access to ~/.ssh', () => {
      const result = guard.checkPath('~/.ssh/id_rsa', 'read');
      expect(result.allowed).toBe(false);
    });

    it('should block access to ~/.gnupg', () => {
      const result = guard.checkPath('~/.gnupg/private-keys-v1.d', 'read');
      expect(result.allowed).toBe(false);
    });

    it('should block access to /root', () => {
      const result = guard.checkPath('/root/.bashrc', 'read');
      expect(result.allowed).toBe(false);
    });

    it('should allow access to safe paths', () => {
      const result = guard.checkPath('/tmp/workspace/file.txt', 'read');
      expect(result.allowed).toBe(true);
    });

    it('should allow write to /tmp', () => {
      const result = guard.checkPath('/tmp/output.log', 'write');
      expect(result.allowed).toBe(true);
    });

    it('should handle paths with trailing slashes', () => {
      const result = guard.checkPath('/root/', 'read');
      expect(result.allowed).toBe(false);
    });

    it('should block /root subdirectory access', () => {
      const result = guard.checkPath('/root/.config/app', 'read');
      expect(result.allowed).toBe(false);
    });
  });

  // --------------------------------------------------------
  // checkNetwork()
  // --------------------------------------------------------
  describe('checkNetwork()', () => {
    it('should block AWS metadata endpoint 169.254.169.254', () => {
      const result = guard.checkNetwork('169.254.169.254');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should block GCP metadata endpoint metadata.google.internal', () => {
      const result = guard.checkNetwork('metadata.google.internal');
      expect(result.allowed).toBe(false);
    });

    it('should block localhost', () => {
      const result = guard.checkNetwork('localhost');
      expect(result.allowed).toBe(false);
    });

    it('should block 127.0.0.1', () => {
      const result = guard.checkNetwork('127.0.0.1');
      expect(result.allowed).toBe(false);
    });

    it('should allow safe external domains', () => {
      const result = guard.checkNetwork('api.openai.com');
      expect(result.allowed).toBe(true);
    });

    it('should allow safe IP addresses', () => {
      const result = guard.checkNetwork('8.8.8.8');
      expect(result.allowed).toBe(true);
    });

    it('should handle empty domain string', () => {
      const result = guard.checkNetwork('');
      expect(result.allowed).toBe(true);
    });

    it('should detect blocked domain as substring in URL-like input', () => {
      const result = guard.checkNetwork('http://localhost:8080/api');
      expect(result.allowed).toBe(false);
    });
  });

  // --------------------------------------------------------
  // Result structure
  // --------------------------------------------------------
  describe('SecurityCheckResult', () => {
    it('should return allowed=true with no reason for safe input', () => {
      const result = guard.checkCommand('npm install');
      expect(result).toEqual({ allowed: true });
    });

    it('should return allowed=false with reason for blocked input', () => {
      const result = guard.checkCommand('rm -rf /');
      expect(result.allowed).toBe(false);
      expect(typeof result.reason).toBe('string');
      expect(result.reason!.length).toBeGreaterThan(0);
    });
  });
});
