import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginManager } from '../src/plugin-manager.js';
import { PipelineRunner } from '../src/pipeline.js';
import { ToolRegistry } from '../src/tool-registry.js';

function makePluginManager(): PluginManager {
  return new PluginManager(new PipelineRunner(), new ToolRegistry());
}

describe('PluginManager path validation', () => {
  const origCwd = process.cwd;

  beforeEach(() => {
    // Pin cwd so path resolution is deterministic
    process.cwd = () => '/project/root';
  });

  afterEach(() => {
    process.cwd = origCwd;
  });

  it('rejects absolute paths outside project root', async () => {
    const mgr = makePluginManager();
    await mgr.loadPlugin('/etc/passwd');
    const errors = mgr.getErrors();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[errors.length - 1].error.message).toMatch(/outside project root/i);
  });

  it('rejects Windows absolute paths outside project root', async () => {
    const mgr = makePluginManager();
    await mgr.loadPlugin('C:\\Windows\\System32\\evil.dll');
    const errors = mgr.getErrors();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[errors.length - 1].error.message).toMatch(/outside project root/i);
  });

  it('rejects path traversal beyond project root', async () => {
    const mgr = makePluginManager();
    await mgr.loadPlugin('../../etc/passwd');
    const errors = mgr.getErrors();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[errors.length - 1].error.message).toMatch(/outside project root/i);
  });

  it('allows bare package names (node_modules resolution)', async () => {
    const mgr = makePluginManager();
    await mgr.loadPlugin('nonexistent-plugin-xyz');
    const errors = mgr.getErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].error.message).not.toMatch(/outside project root/i);
  });

  it('allows scoped package names', async () => {
    const mgr = makePluginManager();
    await mgr.loadPlugin('@scope/plugin-name');
    const errors = mgr.getErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].error.message).not.toMatch(/outside project root/i);
  });

  it('allows relative paths within project', async () => {
    const mgr = makePluginManager();
    await mgr.loadPlugin('./plugins/my-plugin.ts');
    const errors = mgr.getErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].error.message).not.toMatch(/outside project root/i);
  });

  it('loadPluginsFromConfig validates each path independently', async () => {
    const mgr = makePluginManager();
    await mgr.loadPluginsFromConfig({
      plugins: [
        { path: '/etc/passwd' },
        { path: './local-plugin' },
      ],
    });
    const errors = mgr.getErrors();
    expect(errors.length).toBe(2);
    expect(errors[0].error.message).toMatch(/outside project root/i);
    expect(errors[1].error.message).not.toMatch(/outside project root/i);
  });
});
