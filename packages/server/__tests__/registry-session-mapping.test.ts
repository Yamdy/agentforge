import { describe, it, expect } from 'vitest';
import { AgentRegistry } from '../src/registry.js';

describe('AgentRegistry session mapping', () => {
  it('registerSession maps a sessionId to an agentId', () => {
    const registry = new AgentRegistry();
    const agent = registry.register('agent-1', { model: 'test-model', tools: [] });
    registry.registerSession('sess-1', 'agent-1');

    expect(registry.getAgentBySession('sess-1')).toBe(agent);
  });

  it('getAgentBySession returns undefined for unknown session', () => {
    const registry = new AgentRegistry();
    registry.register('agent-1', { model: 'test-model', tools: [] });
    expect(registry.getAgentBySession('unknown-session')).toBeUndefined();
  });

  it('getAgentBySession returns undefined when agent was removed', () => {
    const registry = new AgentRegistry();
    registry.register('agent-1', { model: 'test-model', tools: [] });
    registry.registerSession('sess-1', 'agent-1');
    registry.remove('agent-1');
    expect(registry.getAgentBySession('sess-1')).toBeUndefined();
  });

  it('unregisterSession removes the mapping', () => {
    const registry = new AgentRegistry();
    registry.register('agent-1', { model: 'test-model', tools: [] });
    registry.registerSession('sess-1', 'agent-1');
    expect(registry.getAgentBySession('sess-1')).toBeDefined();

    registry.unregisterSession('sess-1');
    expect(registry.getAgentBySession('sess-1')).toBeUndefined();
  });

  it('unregisterSession is a no-op for unknown session', () => {
    const registry = new AgentRegistry();
    // Should not throw
    registry.unregisterSession('nonexistent');
  });

  it('supports multiple sessions mapping to the same agent', () => {
    const registry = new AgentRegistry();
    const agent = registry.register('agent-1', { model: 'test-model', tools: [] });
    registry.registerSession('sess-1', 'agent-1');
    registry.registerSession('sess-2', 'agent-1');

    expect(registry.getAgentBySession('sess-1')).toBe(agent);
    expect(registry.getAgentBySession('sess-2')).toBe(agent);
  });

  it('overwrites previous mapping when same sessionId is registered again', () => {
    const registry = new AgentRegistry();
    const agent1 = registry.register('agent-1', { model: 'm1', tools: [] });
    const agent2 = registry.register('agent-2', { model: 'm2', tools: [] });
    registry.registerSession('sess-1', 'agent-1');
    expect(registry.getAgentBySession('sess-1')).toBe(agent1);

    registry.registerSession('sess-1', 'agent-2');
    expect(registry.getAgentBySession('sess-1')).toBe(agent2);
  });

  it('clear also clears session mappings', () => {
    const registry = new AgentRegistry();
    registry.register('agent-1', { model: 'test-model', tools: [] });
    registry.registerSession('sess-1', 'agent-1');

    registry.clear();
    expect(registry.getAgentBySession('sess-1')).toBeUndefined();
  });
});
