import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseArgs, scaffold } from '../src/index.js';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

describe('parseArgs', () => {
  it('parses init with project name', () => {
    const result = parseArgs(['init', 'my-agent']);
    expect(result).toEqual({ command: 'init', projectName: 'my-agent', profile: 'default', studio: true });
  });

  it('parses init with --profile', () => {
    const result = parseArgs(['init', 'my-agent', '--profile', 'coding']);
    expect(result).toEqual({ command: 'init', projectName: 'my-agent', profile: 'coding', studio: true });
  });

  it('parses init with --no-studio', () => {
    const result = parseArgs(['init', 'my-agent', '--no-studio']);
    expect(result).toEqual({ command: 'init', projectName: 'my-agent', profile: 'default', studio: false });
  });

  it('parses init with profile and no-studio', () => {
    const result = parseArgs(['init', 'my-agent', '--profile', 'business', '--no-studio']);
    expect(result).toEqual({ command: 'init', projectName: 'my-agent', profile: 'business', studio: false });
  });

  it('returns null for empty args', () => {
    expect(parseArgs([])).toBeNull();
  });

  it('returns null for unknown command', () => {
    expect(parseArgs(['unknown'])).toBeNull();
  });

  it('returns null for --help', () => {
    expect(parseArgs(['--help'])).toBeNull();
  });
});

describe('scaffold', () => {
  const tmpDir = resolve('__tests__', 'tmp-scaffold-test');

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates project directory with all template files', async () => {
    const projectDir = resolve(tmpDir, 'my-test-agent');
    await scaffold({ projectName: 'my-test-agent', profile: 'default', studio: true, cwd: tmpDir });

    expect(existsSync(resolve(projectDir, 'package.json'))).toBe(true);
    expect(existsSync(resolve(projectDir, 'tsconfig.json'))).toBe(true);
    expect(existsSync(resolve(projectDir, 'agent.ts'))).toBe(true);
    expect(existsSync(resolve(projectDir, '.env.example'))).toBe(true);
    expect(existsSync(resolve(projectDir, '.agentforge', 'config.jsonc'))).toBe(true);
  });

  it('replaces {{projectName}} in generated package.json', async () => {
    const projectDir = resolve(tmpDir, 'name-replace-test');
    await scaffold({ projectName: 'name-replace-test', profile: 'default', studio: true, cwd: tmpDir });

    const pkg = JSON.parse(readFileSync(resolve(projectDir, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('name-replace-test');
  });

  it('does not leave any {{projectName}} placeholders in files', async () => {
    const projectDir = resolve(tmpDir, 'no-placeholders');
    await scaffold({ projectName: 'no-placeholders', profile: 'default', studio: true, cwd: tmpDir });

    const files = ['package.json', 'tsconfig.json', 'agent.ts', 'config.jsonc', '.env.example'];
    for (const file of files) {
      const filePath = resolve(projectDir, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        expect(content).not.toContain('{{projectName}}');
      }
    }
  });
});
