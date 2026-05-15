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
