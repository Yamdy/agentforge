import { describe, it, expect } from 'vitest';
import { parseCommand, runSingleShot } from '../src/cli.js';
import { AgentRegistry } from '../src/registry.js';

describe('parseCommand', () => {
  it('parses serve with --port', () => {
    const cmd = parseCommand(['serve', '--port', '3000']);
    expect(cmd).toEqual({ command: 'serve', port: 3000 });
  });

  it('parses serve with --api-key and --config', () => {
    const cmd = parseCommand(['serve', '--api-key', 'secret', '--config', 'my.jsonc']);
    expect(cmd).toEqual({ command: 'serve', apiKey: 'secret', config: 'my.jsonc' });
  });

  it('parses run with --agent and --input', () => {
    const cmd = parseCommand(['run', '--agent', 'my-agent', '--input', 'hello']);
    expect(cmd).toEqual({ command: 'run', agent: 'my-agent', input: 'hello' });
  });

  it('parses run with --config', () => {
    const cmd = parseCommand(['run', '--agent', 'a', '--input', 'hi', '--config', 'c.jsonc']);
    expect(cmd).toEqual({ command: 'run', agent: 'a', input: 'hi', config: 'c.jsonc' });
  });

  it('parses dev with --config', () => {
    const cmd = parseCommand(['dev', '--config', 'custom.jsonc']);
    expect(cmd).toEqual({ command: 'dev', config: 'custom.jsonc' });
  });

  it('parses dev with --port', () => {
    const cmd = parseCommand(['dev', '--port', '8080']);
    expect(cmd).toEqual({ command: 'dev', port: 8080 });
  });

  it('returns null for unknown command', () => {
    const cmd = parseCommand(['unknown']);
    expect(cmd).toEqual({ command: null });
  });

  it('returns null for empty args', () => {
    const cmd = parseCommand([]);
    expect(cmd).toEqual({ command: null });
  });

  // -------------------------------------------------------------------------
  // NEW: --help, --version, --verbose, --quiet
  // -------------------------------------------------------------------------

  it('parses --help as a help command', () => {
    const cmd = parseCommand(['--help']);
    expect(cmd).toEqual({ command: 'help' });
  });

  it('parses -h as a help command', () => {
    const cmd = parseCommand(['-h']);
    expect(cmd).toEqual({ command: 'help' });
  });

  it('parses --version as a version command', () => {
    const cmd = parseCommand(['--version']);
    expect(cmd).toEqual({ command: 'version' });
  });

  it('parses -v as a version command', () => {
    const cmd = parseCommand(['-v']);
    expect(cmd).toEqual({ command: 'version' });
  });

  it('parses serve with --verbose flag', () => {
    const cmd = parseCommand(['serve', '--verbose']);
    expect(cmd).toEqual({ command: 'serve', verbose: true });
  });

  it('parses serve with --quiet flag', () => {
    const cmd = parseCommand(['serve', '--quiet']);
    expect(cmd).toEqual({ command: 'serve', quiet: true });
  });

  it('parses serve with --verbose and other options', () => {
    const cmd = parseCommand(['serve', '--verbose', '--port', '4000']);
    expect(cmd).toEqual({ command: 'serve', verbose: true, port: 4000 });
  });

  it('parses dev with --verbose', () => {
    const cmd = parseCommand(['dev', '--verbose']);
    expect(cmd).toEqual({ command: 'dev', verbose: true });
  });

  // -------------------------------------------------------------------------
  // Discovery flags
  // -------------------------------------------------------------------------

  it('parses serve with --no-agents-convention', () => {
    const cmd = parseCommand(['serve', '--no-agents-convention']);
    expect(cmd).toEqual({ command: 'serve', agentsConvention: false });
  });

  it('parses serve with --no-agentforge-convention', () => {
    const cmd = parseCommand(['serve', '--no-agentforge-convention']);
    expect(cmd).toEqual({ command: 'serve', agentforgeConvention: false });
  });

  it('parses serve with --skill-dir', () => {
    const cmd = parseCommand(['serve', '--skill-dir', '/custom/skills']);
    expect(cmd).toEqual({ command: 'serve', skillDirs: ['/custom/skills'] });
  });

  it('parses multiple --skill-dir flags', () => {
    const cmd = parseCommand(['serve', '--skill-dir', '/a', '--skill-dir', '/b']);
    expect(cmd).toEqual({ command: 'serve', skillDirs: ['/a', '/b'] });
  });

  it('parses run with discovery flags', () => {
    const cmd = parseCommand([
      'run', '--agent', 'a', '--input', 'hi',
      '--no-agents-convention', '--skill-dir', '/x',
    ]);
    expect(cmd).toEqual({
      command: 'run',
      agent: 'a',
      input: 'hi',
      agentsConvention: false,
      skillDirs: ['/x'],
    });
  });
});

describe('runSingleShot', () => {
  it('throws when agent ID not found', async () => {
    const registry = new AgentRegistry();
    await expect(runSingleShot(registry, 'missing', 'hello')).rejects.toThrow(/not found/);
  });
});

describe('AgentRegistry.clear()', () => {
  it('removes all registered agents', () => {
    const registry = new AgentRegistry();
    registry.register('a', { model: 'test', systemPrompt: '', tools: [] });
    registry.register('b', { model: 'test', systemPrompt: '', tools: [] });
    expect(registry.list()).toHaveLength(2);

    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  it('allows re-registration after clear', () => {
    const registry = new AgentRegistry();
    registry.register('a', { model: 'test', systemPrompt: '', tools: [] });
    registry.clear();
    registry.register('b', { model: 'test2', systemPrompt: '', tools: [] });
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].id).toBe('b');
  });
});
