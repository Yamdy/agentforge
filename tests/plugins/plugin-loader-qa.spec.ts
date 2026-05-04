/**
 * PluginLoader Integration Tests — End-to-end loading with real test doubles
 *
 * Creates temporary plugin packages on disk, loads them via PluginLoader,
 * and verifies hook registration and execution.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HookRegistry } from '../../src/core/hooks.js';
import { AgentEventEmitter } from '../../src/core/events.js';
import { PluginLoader, parsePluginSpec } from '../../src/plugins/plugin-loader.js';
import type { Plugin, PluginContext } from '../../src/plugins/plugin.js';
import type { Message } from '../../src/core/events.js';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const FIXTURE_DIR = path.join(process.env.TEMP ?? '/tmp', 'agentforge-plugin-qa');

const PLUGIN_PKG = {
  name: 'test-dynamic-plugin',
  version: '1.0.0',
  agentforge: './index.js',
  main: './index.js',
  type: 'module',
  engines: { agentforge: '>=0.1.0' },
};

const PLUGIN_CODE = `
export const server = async (input, options) => ({
  name: 'test-dynamic-plugin',
  enabled: true,
  requestHooks: [{
    name: 'test-hook',
    priority: 50,
    apply(messages, state) {
      const opts = options ? JSON.stringify(options) : 'none';
      return [{ role: 'system', content: 'TEST_PLUGIN_ACTIVE:' + opts }, ...messages];
    },
  }],
  lifecycleHooks: [
    { name: 'session.start', fn: () => { /* noop */ } },
  ],
  toolProviderHooks: [{
    name: 'test-tool-provider',
    priority: 50,
    filter(tools, state) {
      return [...tools, { name: 'injected_tool', description: 'From plugin', parameters: {} }];
    },
  }],
});
`;

describe('PluginLoader Integration (E2E)', () => {
  let ctx: PluginContext;
  let hooks: HookRegistry;
  let emitter: AgentEventEmitter;

  // ── Fixture Setup ──

  beforeAll(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true });
    await writeFile(path.join(FIXTURE_DIR, 'package.json'), JSON.stringify(PLUGIN_PKG));
    await writeFile(path.join(FIXTURE_DIR, 'index.js'), PLUGIN_CODE);
  });

  afterAll(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    ctx = { sessionId: 'qa-test', agentName: 'qa-agent' };
    hooks = new HookRegistry();
    emitter = new AgentEventEmitter();
  });

  // ── parsePluginSpec ──

  describe('parsePluginSpec', () => {
    it('should parse a file-source spec (relative path)', () => {
      const result = parsePluginSpec('./local-dir');
      expect(result.source).toBe('file');
      expect(result.pkg).toBe('./local-dir');
      expect(result.version).toBe('');
    });

    it('should parse a file-source spec (file:// prefix)', () => {
      const result = parsePluginSpec('file://./local');
      expect(result.source).toBe('file');
      expect(result.pkg).toBe('./local');
      expect(result.version).toBe('');
    });

    it('should parse a file-source spec (absolute path)', () => {
      const result = parsePluginSpec('/absolute/path/to/plugin');
      expect(result.source).toBe('file');
      expect(result.pkg).toBe('/absolute/path/to/plugin');
    });

    it('should detect npm spec as source=npm (version parsing removed)', () => {
      const result = parsePluginSpec('my-plugin@^1.0.0');
      expect(result.source).toBe('npm');
      expect(result.pkg).toBe('my-plugin@^1.0.0');
      expect(result.version).toBe('');
    });

    it('should detect npm spec without version as source=npm', () => {
      const result = parsePluginSpec('my-plugin');
      expect(result.source).toBe('npm');
      expect(result.pkg).toBe('my-plugin');
      expect(result.version).toBe('');
    });

    it('should detect scoped npm package as source=npm', () => {
      const result = parsePluginSpec('@scope/pkg@2.0.0');
      expect(result.source).toBe('npm');
      expect(result.pkg).toBe('@scope/pkg@2.0.0');
      expect(result.version).toBe('');
    });
  });

  // ── Plugin Loading Tests ──

  it('should parse a file-source spec', () => {
    const result = parsePluginSpec(FIXTURE_DIR);
    expect(result.source).toBe('file');
    expect(result.pkg).toBe(FIXTURE_DIR);
  });

  it('should load a local file plugin successfully', async () => {
    expect(existsSync(path.join(FIXTURE_DIR, 'package.json'))).toBe(true);

    const results = await PluginLoader.loadAll(
      [{ source: FIXTURE_DIR, options: { qa: true } }],
      ctx,
      hooks,
      emitter,
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.error).toBeUndefined();
    expect(results[0]!.plugin).toBeDefined();
  });

  it('should register plugin name correctly', async () => {
    const results = await PluginLoader.loadAll(
      [{ source: FIXTURE_DIR }],
      ctx,
      hooks,
      emitter,
    );
    expect(results[0]!.plugin!.name).toBe('test-dynamic-plugin');
  });

  it('should register request hooks and execute them', async () => {
    await PluginLoader.loadAll(
      [{ source: FIXTURE_DIR, options: { secret: 42 } }],
      ctx,
      hooks,
      emitter,
    );

    const requestHooks = hooks.getRequestHooks();
    expect(requestHooks.length).toBeGreaterThan(0);

    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    const result = await requestHooks[0]!.apply(messages, {} as Parameters<typeof requestHooks[0]['apply']>[1]);
    expect(result[0]!.role).toBe('system');
    expect(result[0]!.content).toContain('TEST_PLUGIN_ACTIVE');
    expect(result[0]!.content).toContain('42'); // options passed through
  });

  it('should register tool provider hooks', async () => {
    await PluginLoader.loadAll(
      [{ source: FIXTURE_DIR }],
      ctx,
      hooks,
      emitter,
    );

    const providerHooks = hooks.getToolProviderHooks();
    expect(providerHooks.length).toBeGreaterThan(0);

    const tools = [{ name: 'read', description: 'read file', parameters: {} }];
    const result = await providerHooks[0]!.filter(tools, {} as Parameters<typeof providerHooks[0]['filter']>[1]);
    expect(result.length).toBe(2);
    expect(result[1]!.name).toBe('injected_tool');
  });

  it('should register lifecycle hooks', async () => {
    await PluginLoader.loadAll(
      [{ source: FIXTURE_DIR }],
      ctx,
      hooks,
      emitter,
    );

    const lifecycleHooks = hooks.getLifecycleHooks('session.start');
    expect(lifecycleHooks.length).toBeGreaterThan(0);
  });

  it('should isolate load failures — second spec loads even if first fails', async () => {
    const results = await PluginLoader.loadAll(
      [
        { source: '/nonexistent/path/to/plugin' },
        { source: FIXTURE_DIR },
      ],
      ctx,
      hooks,
      emitter,
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toBeDefined();
    expect(results[1]!.success).toBe(true);
    expect(results[1]!.plugin).toBeDefined();
  });

  it('should handle empty specs array', async () => {
    const results = await PluginLoader.loadAll([], ctx, hooks, emitter);
    expect(results).toEqual([]);
  });
});
