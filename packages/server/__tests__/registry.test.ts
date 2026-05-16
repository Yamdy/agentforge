import { describe, it, expect } from 'vitest';
import { AgentRegistry } from '../src/registry.js';

describe('AgentRegistry', () => {
  it('registers and retrieves an agent', () => {
    const registry = new AgentRegistry();
    const agent = registry.register('test', { model: 'test-model', tools: [] });
    expect(registry.get('test')).toBe(agent);
  });

  it('returns undefined for unknown agent', () => {
    const registry = new AgentRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('lists registered agents', () => {
    const registry = new AgentRegistry();
    registry.register('a', { model: 'm1', tools: [] });
    registry.register('b', { model: 'm2', tools: [] });
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('removes an agent', () => {
    const registry = new AgentRegistry();
    registry.register('test', { model: 'm', tools: [] });
    registry.remove('test');
    expect(registry.get('test')).toBeUndefined();
  });
});
