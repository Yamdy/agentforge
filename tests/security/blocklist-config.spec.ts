/**
 * MPU-M6: BlocklistConfig Tests
 *
 * Tests for configurable blocklist merging, validation, loading,
 * and SecurityGuard integration with custom blocklist configs.
 */

import { describe, it, expect } from 'vitest';
import { SecurityGuard } from '../../src/security/guard.js';
import {
  mergeBlocklists,
  loadBlocklistConfig,
  validateBlocklistConfig,
} from '../../src/security/blocklist-config.js';
import type { BlocklistConfig } from '../../src/security/blocklist-config.js';
import {
  DEFAULT_BLOCKED_COMMANDS,
  DEFAULT_BLOCKED_PATHS,
  DEFAULT_BLOCKED_DOMAINS,
} from '../../src/security/blocklist.js';

// ============================================================
// mergeBlocklists()
// ============================================================

describe('mergeBlocklists()', () => {
  it('should return base when no additional items provided', () => {
    const result = mergeBlocklists(['a', 'b', 'c']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should return base when empty additional array provided', () => {
    const result = mergeBlocklists(['a', 'b', 'c'], []);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should append additional items after base items', () => {
    const result = mergeBlocklists(['a', 'b'], ['c', 'd']);
    expect(result).toEqual(['a', 'b', 'c', 'd']);
  });

  it('should deduplicate items (case-sensitive)', () => {
    const result = mergeBlocklists(['a', 'b', 'c'], ['b', 'd']);
    expect(result).toEqual(['a', 'b', 'c', 'd']);
  });

  it('should preserve order: base first, then unique additions', () => {
    const result = mergeBlocklists(['a', 'b'], ['c', 'a']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should handle undefined additional gracefully', () => {
    const result = mergeBlocklists(['a'], undefined);
    expect(result).toEqual(['a']);
  });

  it('should filter out empty strings from additional items', () => {
    const result = mergeBlocklists(['a', 'b'], ['', 'c', '']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should filter out whitespace-only strings from additional items', () => {
    const result = mergeBlocklists(['a'], ['   ', 'b', '\t']);
    expect(result).toEqual(['a', 'b']);
  });
});

// ============================================================
// loadBlocklistConfig()
// ============================================================

describe('loadBlocklistConfig()', () => {
  it('should parse a JSON object with all fields', () => {
    const source = {
      commands: ['rm -rf /tmp'],
      paths: ['/secret/data'],
      domains: ['internal.corp.com'],
    };
    const config = loadBlocklistConfig(source);
    expect(config.commands).toEqual(['rm -rf /tmp']);
    expect(config.paths).toEqual(['/secret/data']);
    expect(config.domains).toEqual(['internal.corp.com']);
  });

  it('should parse a JSON object with only commands', () => {
    const source = { commands: ['dangerous-cmd'] };
    const config = loadBlocklistConfig(source);
    expect(config.commands).toEqual(['dangerous-cmd']);
    expect(config.paths).toBeUndefined();
    expect(config.domains).toBeUndefined();
  });

  it('should parse a JSON object with only paths', () => {
    const source = { paths: ['/forbidden'] };
    const config = loadBlocklistConfig(source);
    expect(config.paths).toEqual(['/forbidden']);
    expect(config.commands).toBeUndefined();
    expect(config.domains).toBeUndefined();
  });

  it('should parse a JSON object with only domains', () => {
    const source = { domains: ['evil.com'] };
    const config = loadBlocklistConfig(source);
    expect(config.domains).toEqual(['evil.com']);
    expect(config.commands).toBeUndefined();
    expect(config.paths).toBeUndefined();
  });

  it('should return empty config for empty object', () => {
    const config = loadBlocklistConfig({});
    expect(config.commands).toBeUndefined();
    expect(config.paths).toBeUndefined();
    expect(config.domains).toBeUndefined();
  });

  it('should ignore unknown fields', () => {
    const source = { commands: ['ls'], unknownField: 42, nested: { foo: 'bar' } };
    const config = loadBlocklistConfig(source);
    expect(config.commands).toEqual(['ls']);
    // unknownField should not appear
    expect((config as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it('should handle non-array strings gracefully (filter out)', () => {
    const source = { commands: ['ls', 123, null, 'cat'] };
    const config = loadBlocklistConfig(source as unknown as Record<string, unknown>);
    expect(config.commands).toEqual(['ls', 'cat']);
  });

  it('should filter out empty strings from loaded config', () => {
    const source = { commands: ['ls', '', 'cat'], domains: ['evil.com', ''] };
    const config = loadBlocklistConfig(source as unknown as Record<string, unknown>);
    expect(config.commands).toEqual(['ls', 'cat']);
    expect(config.domains).toEqual(['evil.com']);
  });

  it('should parse from a JSON string', () => {
    const json = JSON.stringify({
      commands: ['rm -rf /tmp'],
      domains: ['evil.com'],
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const config = loadBlocklistConfig(parsed);
    expect(config.commands).toEqual(['rm -rf /tmp']);
    expect(config.domains).toEqual(['evil.com']);
  });
});

// ============================================================
// validateBlocklistConfig()
// ============================================================

describe('validateBlocklistConfig()', () => {
  it('should pass valid config with all fields', () => {
    const config: BlocklistConfig = {
      commands: ['dangerous-cmd'],
      paths: ['/secret'],
      domains: ['evil.com'],
    };
    const result = validateBlocklistConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should pass empty config', () => {
    const config: BlocklistConfig = {};
    const result = validateBlocklistConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject empty strings in commands', () => {
    const config: BlocklistConfig = {
      commands: ['valid-cmd', '', 'also-valid'],
    };
    const result = validateBlocklistConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('empty'))).toBe(true);
  });

  it('should reject empty strings in paths', () => {
    const config: BlocklistConfig = {
      paths: [''],
    };
    const result = validateBlocklistConfig(config);
    expect(result.valid).toBe(false);
  });

  it('should reject empty strings in domains', () => {
    const config: BlocklistConfig = {
      domains: ['valid.com', ''],
    };
    const result = validateBlocklistConfig(config);
    expect(result.valid).toBe(false);
  });

  it('should reject config with non-string entries', () => {
    const config = {
      commands: [123 as unknown as string],
    };
    const result = validateBlocklistConfig(config as BlocklistConfig);
    expect(result.valid).toBe(false);
  });
});

// ============================================================
// SecurityGuard integration with BlocklistConfig
// ============================================================

describe('SecurityGuard with BlocklistConfig', () => {
  it('should use only defaults when no config provided', () => {
    const guard = new SecurityGuard();

    // Default blocked commands should still work
    expect(guard.checkCommand('rm -rf /').allowed).toBe(false);
    expect(guard.checkCommand('ls -la').allowed).toBe(true);

    // Default blocked paths should still work
    expect(guard.checkPath('/etc/shadow', 'read').allowed).toBe(false);
    expect(guard.checkPath('/tmp/safe.txt', 'read').allowed).toBe(true);

    // Default blocked domains should still work
    expect(guard.checkNetwork('localhost').allowed).toBe(false);
    expect(guard.checkNetwork('api.openai.com').allowed).toBe(true);
  });

  it('should block additional commands alongside defaults', () => {
    const guard = new SecurityGuard({
      commands: ['dangerous-tool'],
    });

    // Default still blocked
    expect(guard.checkCommand('rm -rf /').allowed).toBe(false);
    // Additional is now blocked too
    expect(guard.checkCommand('run dangerous-tool --force').allowed).toBe(false);
  });

  it('should block additional paths alongside defaults', () => {
    const guard = new SecurityGuard({
      paths: ['/secret/project'],
    });

    // Default still blocked
    expect(guard.checkPath('/etc/shadow', 'read').allowed).toBe(false);
    // Additional is now blocked too
    expect(guard.checkPath('/secret/project/config', 'read').allowed).toBe(false);
  });

  it('should block additional domains alongside defaults', () => {
    const guard = new SecurityGuard({
      domains: ['internal.corp.com'],
    });

    // Default still blocked
    expect(guard.checkNetwork('localhost').allowed).toBe(false);
    // Additional is now blocked too
    expect(guard.checkNetwork('https://internal.corp.com/api').allowed).toBe(false);
  });

  it('should allow safe commands that are not in defaults or additions', () => {
    const guard = new SecurityGuard({
      commands: ['evil-cmd'],
    });
    expect(guard.checkCommand('ls -la').allowed).toBe(true);
  });

  it('should handle config with only paths and no commands/domains', () => {
    const guard = new SecurityGuard({
      paths: ['/extra/blocked'],
    });

    // Default commands still blocked
    expect(guard.checkCommand('rm -rf /').allowed).toBe(false);
    // Safe command still allowed
    expect(guard.checkCommand('echo hello').allowed).toBe(true);
    // Additional path blocked
    expect(guard.checkPath('/extra/blocked/file', 'read').allowed).toBe(false);
    // Default domains still blocked
    expect(guard.checkNetwork('127.0.0.1').allowed).toBe(false);
  });

  it('should handle config with only domains and no commands/paths', () => {
    const guard = new SecurityGuard({
      domains: ['extra-blocked.test'],
    });

    expect(guard.checkCommand('rm -rf /').allowed).toBe(false);
    expect(guard.checkPath('/root/file', 'read').allowed).toBe(false);
    expect(guard.checkNetwork('extra-blocked.test').allowed).toBe(false);
    expect(guard.checkNetwork('api.openai.com').allowed).toBe(true);
  });

  it('should handle empty config (same as no config)', () => {
    const guard = new SecurityGuard({});

    expect(guard.checkCommand('rm -rf /').allowed).toBe(false);
    expect(guard.checkCommand('ls -la').allowed).toBe(true);
    expect(guard.checkPath('/etc/shadow', 'read').allowed).toBe(false);
    expect(guard.checkNetwork('localhost').allowed).toBe(false);
  });

  it('should not duplicate blocking when addition matches existing default', () => {
    const guard = new SecurityGuard({
      commands: ['mkfs'],
    });

    // Still blocked once
    expect(guard.checkCommand('mkfs.ext4 /dev/sda1').allowed).toBe(false);
    expect(guard.checkCommand('ls -la').allowed).toBe(true);
  });

  it('should return proper reason for additionally blocked items', () => {
    const guard = new SecurityGuard({
      commands: ['custom-evil'],
    });

    const result = guard.checkCommand('custom-evil --flag');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('custom-evil');
  });
});

// ============================================================
// DEFAULT_ exports from blocklist.ts
// ============================================================

describe('DEFAULT_BLOCKED_* exports', () => {
  it('DEFAULT_BLOCKED_COMMANDS should match old BLOCKED_COMMANDS values', () => {
    expect(DEFAULT_BLOCKED_COMMANDS).toEqual([
      'rm -rf /',
      'rm -rf /*',
      'dd if=',
      'mkfs',
      ':(){:|:&};:',
      'chmod 777',
    ]);
  });

  it('DEFAULT_BLOCKED_PATHS should match old BLOCKED_PATHS values', () => {
    expect(DEFAULT_BLOCKED_PATHS).toEqual([
      '/etc/shadow',
      '/etc/passwd',
      '~/.ssh',
      '~/.gnupg',
      '/root',
    ]);
  });

  it('DEFAULT_BLOCKED_DOMAINS should match old BLOCKED_DOMAINS values', () => {
    expect(DEFAULT_BLOCKED_DOMAINS).toEqual([
      '169.254.169.254',
      'metadata.google.internal',
      'localhost',
      '127.0.0.1',
      '::1',
    ]);
  });
});
