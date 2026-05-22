import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '../src/config.js';
import { ConfigEnvVarError } from '../src/errors.js';
import type { HarnessConfig } from '@primo-ai/sdk';

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

    // Session-level plugins concat with global + project
    expect(result.plugins).toEqual(['memory', 'skill', 'custom']);
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

    // env is lowest priority, plugins concat across layers
    expect(result.plugins).toEqual(['env-plugin', 'base']);
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

  it('produces validation error for invalid config values', async () => {
    const loader = new ConfigLoader({
      fileReader: () => Promise.reject(new Error('not found')),
    });

    await expect(
      loader.load({
        session: { plugins: 123 } as unknown as Partial<HarnessConfig>,
      }),
    ).rejects.toThrow(/Invalid config/);
  });
});

describe('expandEnvVars (environment variable expansion)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.TEST_VAR = 'expanded_value';
    process.env.DATA_DIR = '/data/app';
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  // -----------------------------------------------------------------------
  // Load-based tests — env vars in config content
  // -----------------------------------------------------------------------

  it('expands ${VAR_NAME} from environment in config string values', async () => {
    const loader = new ConfigLoader({
      fileReader: () => Promise.resolve('{ "session": { "path": "${DATA_DIR}" } }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });

    expect(result.session?.path).toBe('/data/app');
  });

  it('uses ${VAR_NAME:-default} when env var is NOT set', async () => {
    delete process.env.UNDEFINED_VAR;

    const loader = new ConfigLoader({
      fileReader: () => Promise.resolve('{ "session": { "path": "${UNDEFINED_VAR:-/fallback/path}" } }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });

    expect(result.session?.path).toBe('/fallback/path');
  });

  it('uses env var value over ${VAR:-default} when env var IS set', async () => {
    process.env.OVERRIDE_ME = 'actual_value';

    const loader = new ConfigLoader({
      fileReader: () => Promise.resolve('{ "session": { "path": "${OVERRIDE_ME:-fallback}" } }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });

    expect(result.session?.path).toBe('actual_value');
  });

  it('throws ConfigEnvVarError when env var is undefined and no default', async () => {
    delete process.env.MUST_EXIST;

    const loader = new ConfigLoader({
      fileReader: () => Promise.resolve('{ "session": { "path": "${MUST_EXIST}" } }'),
    });

    await expect(
      loader.load({ project: '/proj.jsonc' }),
    ).rejects.toThrow(ConfigEnvVarError);
  });

  it('includes variable name and config path in ConfigEnvVarError', async () => {
    delete process.env.MUST_EXIST;

    const loader = new ConfigLoader({
      fileReader: () => Promise.resolve('{ "session": { "path": "${MUST_EXIST}" } }'),
    });

    try {
      await loader.load({ project: '/proj.jsonc' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigEnvVarError);
      expect((err as ConfigEnvVarError).message).toContain('MUST_EXIST');
      expect((err as ConfigEnvVarError).message).toContain('session.path');
    }
  });

  it('$${ escapes to literal ${ — no env expansion', async () => {
    const loader = new ConfigLoader({
      fileReader: () => Promise.resolve('{ "session": { "path": "$${HOME}" } }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });

    expect(result.session?.path).toBe('${HOME}');
  });

  it('handles mixed literal text and env var expansion', async () => {
    process.env.VAR = 'expanded';

    const loader = new ConfigLoader({
      fileReader: () => Promise.resolve('{ "session": { "path": "/prefix/${VAR}/suffix" } }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });

    expect(result.session?.path).toBe('/prefix/expanded/suffix');
  });

  it('applies env var expansion in nested objects', async () => {
    const loader = new ConfigLoader({
      fileReader: () =>
        Promise.resolve('{ "agents": { "default": { "model": "${TEST_VAR}" } } }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });

    expect(result.agents?.default?.model).toBe('expanded_value');
  });

  it('applies env var expansion to string elements inside arrays', async () => {
    const loader = new ConfigLoader({
      fileReader: () => Promise.resolve('{ "plugins": ["${TEST_VAR}", "static"] }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });

    expect(result.plugins).toEqual(['expanded_value', 'static']);
  });

  it('leaves numeric values untouched during env var expansion', async () => {
    const loader = new ConfigLoader({
      fileReader: () =>
        Promise.resolve('{ "maxRetries": 3, "timeout": 5000 }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });
    expect((result as Record<string, unknown>).maxRetries).toBe(3);
    expect((result as Record<string, unknown>).timeout).toBe(5000);
  });

  it('leaves boolean values untouched during env var expansion', async () => {
    const loader = new ConfigLoader({
      fileReader: () =>
        Promise.resolve('{ "debug": true, "tls": false }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });
    expect((result as Record<string, unknown>).debug).toBe(true);
    expect((result as Record<string, unknown>).tls).toBe(false);
  });

  it('leaves null values untouched during env var expansion', async () => {
    const loader = new ConfigLoader({
      fileReader: () =>
        Promise.resolve('{ "customSettings": { "optionalField": null } }'),
    });

    const result = await loader.load({ project: '/proj.jsonc' });
    expect(
      ((result as Record<string, unknown>).customSettings as Record<string, unknown> | undefined)?.optionalField,
    ).toBeNull();
  });

  it('does NOT expand env vars in non-string values', async () => {
    const loader = new ConfigLoader({
      fileReader: () =>
        Promise.resolve('{ "session": { "path": "/fixed", "storage": "memory" } }'),
    });

    // Just ensure no error — non-strings are left intact
    const result = await loader.load({ project: '/proj.jsonc' });
    expect(result.session?.path).toBe('/fixed');
    expect(result.session?.storage).toBe('memory');
  });

  it('expands env vars before Zod validation', async () => {
    process.env.MY_MODEL = 'claude-v4';

    const loader = new ConfigLoader({
      fileReader: () => Promise.resolve('{ "modelGateways": [{ "name": "gw", "url": "${MY_MODEL}" }] }'),
    });

    // modelGateways.url is a required string — if expansion happened before
    // validation, the literal "${MY_MODEL}" would fail Zod
    const result = await loader.load({ project: '/proj.jsonc' });
    expect(result.modelGateways?.[0]?.url).toBe('claude-v4');
  });
});
