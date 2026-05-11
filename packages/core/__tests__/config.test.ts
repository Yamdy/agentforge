import { describe, it, expect } from 'vitest';
import { ConfigLoader } from '../src/config.js';
import type { HarnessConfig } from '@agentforge/sdk';

describe('parseJsonc', () => {
  const loader = new ConfigLoader();

  it('strips single-line comments', () => {
    const result = loader.parseJsonc('{ "a": 1 // comment\n}');
    expect(result).toEqual({ a: 1 });
  });

  it('strips block comments', () => {
    const result = loader.parseJsonc('{ "a": /* comment */ 1 }');
    expect(result).toEqual({ a: 1 });
  });

  it('strips trailing commas before } and ]', () => {
    const result = loader.parseJsonc('{ "a": 1, "b": [1, 2,], }');
    expect(result).toEqual({ a: 1, b: [1, 2] });
  });

  it('throws clear error on invalid JSON', () => {
    expect(() => loader.parseJsonc('{ invalid }')).toThrow();
  });

  it('does NOT strip // inside strings', () => {
    const result = loader.parseJsonc('{ "url": "http://example.com" }');
    expect(result).toEqual({ url: 'http://example.com' });
  });

  it('does NOT strip /* */ inside strings', () => {
    const result = loader.parseJsonc('{ "code": "const a = /* inline */ 1" }');
    expect(result).toEqual({ code: 'const a = /* inline */ 1' });
  });

  it('parses valid JSONC with all features', () => {
    const content = `{
      // Global config
      "plugins": ["memory", /* todo */ "skill",],
      "agents": {
        "default": { "model": "anthropic/claude-3", },
      },
    }`;
    const result = loader.parseJsonc(content);
    expect(result).toEqual({
      plugins: ['memory', 'skill'],
      agents: { default: { model: 'anthropic/claude-3' } },
    });
  });
});

describe('ConfigLoader.load', () => {
  it('reads 3 JSONC layers, merges, and returns HarnessConfig', async () => {
    const files = new Map<string, string>([
      ['/global.jsonc', '{ "plugins": ["memory"] }'],
      ['/project.jsonc', '{ "plugins": ["skill"], "agents": { "default": { "model": "openai/gpt-4" } } }'],
    ]);

    const loader = new ConfigLoader({
      fileReader: (path) => {
        const content = files.get(path);
        if (!content) throw new Error(`File not found: ${path}`);
        return Promise.resolve(content);
      },
    });

    const result = await loader.load({
      global: '/global.jsonc',
      project: '/project.jsonc',
      session: { plugins: ['custom'] },
    });

    // Session overrides global + project (arrays replace, not merge)
    expect(result.plugins).toEqual(['custom']);
    // Project-level agent config preserved
    expect(result.agents?.default?.model).toBe('openai/gpt-4');
  });

  it('handles missing global and project files gracefully', async () => {
    const loader = new ConfigLoader({
      fileReader: () => Promise.reject(new Error('File not found')),
    });

    const result = await loader.load({
      session: { plugins: ['a'] },
    });

    expect(result.plugins).toEqual(['a']);
  });

  it('applies env-level inline JSON (lowest priority)', async () => {
    const files = new Map<string, string>([
      ['/global.jsonc', '{ "plugins": ["base"] }'],
    ]);

    const loader = new ConfigLoader({
      fileReader: (path) => {
        const content = files.get(path);
        if (!content) throw new Error(`File not found: ${path}`);
        return Promise.resolve(content);
      },
    });

    const result = await loader.load({
      global: '/global.jsonc',
      env: '{ "plugins": ["env-plugin"] }',
    });

    // env is lowest priority, global overwrites plugins (array replace)
    expect(result.plugins).toEqual(['base']);
  });

  it('returns empty config when no sources provided', async () => {
    const loader = new ConfigLoader();
    const result = await loader.load({});
    expect(result).toEqual({});
  });

  it('merge order: session > project > global > env', async () => {
    const files = new Map<string, string>([
      ['/global.jsonc', '{ "session": { "storage": "memory" } }'],
      ['/project.jsonc', '{ "session": { "storage": "file", "path": "/data" } }'],
    ]);

    const loader = new ConfigLoader({
      fileReader: (path) => {
        const content = files.get(path);
        if (!content) throw new Error(`File not found: ${path}`);
        return Promise.resolve(content);
      },
    });

    const result = await loader.load({
      global: '/global.jsonc',
      project: '/project.jsonc',
      env: '{ "session": { "storage": "memory" } }',
      session: { session: { path: '/override' } },
    });

    // Merge order: env -> global -> project -> session
    // env sets storage=memory, global sets storage=memory (no change), project sets storage=file, path=/data
    // session only sets path=/override (deep merge with project's session object)
    // So storage=file (from project), path=/override (from session)
    expect(result.session?.storage).toBe('file');
    expect(result.session?.path).toBe('/override');
  });
});
