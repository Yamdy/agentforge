/**
 * PluginLoader Unit Tests (TDD - RED phase)
 *
 * Tests for dynamic plugin loading: spec parsing, npm resolution,
 * entry point resolution, compatibility checking, and loading lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PluginLoader,
  parsePluginSpec,
  type PluginSpec,
  type PluginLoadError,
  type PluginLoadResult,
} from '../../src/plugins/plugin-loader.js';
import type { Plugin, PluginContext } from '../../src/plugins/plugin.js';
import { HookRegistry } from '../../src/core/hooks.js';
import { AgentEventEmitter } from '../../src/core/events.js';

// ============================================================
// Helpers
// ============================================================

function createMockCtx(): PluginContext {
  return { sessionId: 'test-session', agentName: 'test-agent' };
}

function createMockPlugin(name: string): Plugin {
  return {
    name,
    enabled: true,
    requestHooks: [{
      name: `${name}-hook`,
      priority: 50,
      apply(messages) { return messages; },
    }],
  };
}

// ============================================================
// parsePluginSpec Tests
// ============================================================

describe('parsePluginSpec', () => {
  it('should detect npm specifier (version no longer parsed)', () => {
    const result = parsePluginSpec('my-plugin@^1.0.0');
    expect(result.source).toBe('npm');
    expect(result.pkg).toBe('my-plugin@^1.0.0');
    expect(result.version).toBe('');
  });

  it('should detect npm specifier (no longer parsed — returns raw string)', () => {
    const result = parsePluginSpec('my-plugin');
    expect(result.source).toBe('npm');
    expect(result.pkg).toBe('my-plugin');
    expect(result.version).toBe('');
  });

  it('should detect scoped npm specifier as source=npm', () => {
    const result = parsePluginSpec('@scope/my-plugin@2.0.0');
    expect(result.source).toBe('npm');
    // NPM version parsing removed — the full spec becomes the pkg
    expect(result.pkg).toBe('@scope/my-plugin@2.0.0');
    expect(result.version).toBe('');
  });

  it('should detect scoped npm specifier without version as source=npm', () => {
    const result = parsePluginSpec('@scope/my-plugin');
    expect(result.source).toBe('npm');
    expect(result.pkg).toBe('@scope/my-plugin');
    expect(result.version).toBe('');
  });

  it('should detect file:// prefix as file source', () => {
    const result = parsePluginSpec('file://./my-local-plugin');
    expect(result.source).toBe('file');
    expect(result.pkg).toBe('./my-local-plugin');
  });

  it('should detect relative path as file source', () => {
    const result = parsePluginSpec('./plugins/my-plugin');
    expect(result.source).toBe('file');
    expect(result.pkg).toBe('./plugins/my-plugin');
  });

  it('should detect absolute path as file source on unix', () => {
    const result = parsePluginSpec('/home/user/plugins/my-plugin');
    expect(result.source).toBe('file');
    expect(result.pkg).toBe('/home/user/plugins/my-plugin');
  });
});

// ============================================================
// checkCompatibility Tests
// ============================================================

describe('checkCompatibility', () => {
  it('should not throw when engines.agentforge is not specified', () => {
    const pkg = { name: 'test-plugin', version: '1.0.0' };
    expect(() =>
      PluginLoader.checkCompatibility(pkg, '0.1.0')
    ).not.toThrow();
  });

  it('should not throw when version satisfies range', () => {
    const pkg = {
      name: 'test-plugin',
      version: '1.0.0',
      engines: { agentforge: '>=0.1.0 <1.0.0' },
    };
    expect(() =>
      PluginLoader.checkCompatibility(pkg, '0.1.3')
    ).not.toThrow();
  });

  it('should throw when version does not satisfy range', () => {
    const pkg = {
      name: 'test-plugin',
      version: '1.0.0',
      engines: { agentforge: '>=2.0.0' },
    };
    expect(() =>
      PluginLoader.checkCompatibility(pkg, '1.0.0')
    ).toThrow(/requires agentforge/i);
  });
});

// ============================================================
// resolveEntry Tests
// ============================================================

describe('resolveEntry', () => {
  it('should prefer exports["./agentforge"] over main', () => {
    const pkg = {
      name: 'test-plugin',
      version: '1.0.0',
      exports: { './agentforge': './dist/server.js' },
      main: './dist/index.js',
    };
    const entry = PluginLoader.resolveEntryFromPkg(pkg);
    expect(entry).toBe('./dist/server.js');
  });

  it('should fall back to "agentforge" field if exports["./agentforge"] missing', () => {
    const pkg = {
      name: 'test-plugin',
      version: '1.0.0',
      agentforge: './dist/server.js',
      main: './dist/index.js',
    };
    const entry = PluginLoader.resolveEntryFromPkg(pkg);
    expect(entry).toBe('./dist/server.js');
  });

  it('should fall back to main field', () => {
    const pkg = {
      name: 'test-plugin',
      version: '1.0.0',
      main: './dist/index.js',
    };
    const entry = PluginLoader.resolveEntryFromPkg(pkg);
    expect(entry).toBe('./dist/index.js');
  });

  it('should return undefined if no entry found', () => {
    const pkg = {
      name: 'test-plugin',
      version: '1.0.0',
    };
    const entry = PluginLoader.resolveEntryFromPkg(pkg);
    expect(entry).toBeUndefined();
  });
});

// ============================================================
// loadAll Tests (integration)
// ============================================================

describe('PluginLoader.loadAll', () => {
  let registry: HookRegistry;
  let emitter: AgentEventEmitter;

  beforeEach(() => {
    registry = new HookRegistry();
    emitter = new AgentEventEmitter();
  });

  it('should return empty array for empty specs', async () => {
    const results = await PluginLoader.loadAll([], createMockCtx(), registry, emitter);
    expect(results).toEqual([]);
  });

  it('should handle invalid spec gracefully (not crash)', async () => {
    const results = await PluginLoader.loadAll(
      [{ source: 'nonexistent-pkg-12345-xyz' }],
      createMockCtx(),
      registry,
      emitter,
    );
    // Should not crash, just return what succeeded
    expect(Array.isArray(results)).toBe(true);
  });

  it('should return PluginLoadResult with success flag for each spec', async () => {
    const results = await PluginLoader.loadAll(
      [{ source: 'nonexistent-pkg-12345-xyz' }],
      createMockCtx(),
      registry,
      emitter,
    );
    for (const r of results) {
      expect(r).toHaveProperty('spec');
      expect(r).toHaveProperty('success');
    }
  });
});

// ============================================================
// PluginLoader static methods
// ============================================================

describe('PluginLoader (static)', () => {
  it('should have loadAll static method', () => {
    expect(typeof PluginLoader.loadAll).toBe('function');
  });

  it('should have checkCompatibility static method', () => {
    expect(typeof PluginLoader.checkCompatibility).toBe('function');
  });

  it('should have resolveEntryFromPkg static method', () => {
    expect(typeof PluginLoader.resolveEntryFromPkg).toBe('function');
  });

  it('should have parseSpec static method', () => {
    expect(typeof PluginLoader.parseSpec).toBe('function');
  });
});
