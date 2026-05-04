/**
 * MCP Config Wiring Tests
 *
 * Verifies that createAgent correctly handles MCP server configuration:
 * - Agent creation with various MCP config shapes
 * - Config validation for MCP-specific fields
 * - Backward compatibility when MCP is absent
 *
 * Note: Full MCP client lifecycle (connect/disconnect/tools/callTool)
 * is tested in tests/mcp/client.spec.ts using ControllableMockTransport.
 */

import { describe, it, expect } from 'vitest';
import { createAgent } from '../../src/api/create-agent.js';

describe('MCP Config Wiring (createAgent)', () => {
  it('should create agent without MCP when no config provided', () => {
    const agent = createAgent({
      name: 'no-mcp-agent',
      model: 'openai/gpt-4o-mini',
    });
    expect(agent).toBeDefined();
    expect(agent.ctx.identity.sessionId).toBeDefined();
    expect(agent.ctx.identity.agentName).toBe('no-mcp-agent');
    expect(typeof agent.ctx.identity.sessionId).toBe('string');
  });

  it('should create agent with empty MCP array', () => {
    const agent = createAgent({
      name: 'empty-mcp-agent',
      model: 'openai/gpt-4o-mini',
      mcp: [],
    });
    expect(agent).toBeDefined();
    expect(agent.ctx.identity.sessionId).toBeDefined();
  });

  it('should create agent with MCP stdio config', () => {
    const agent = createAgent({
      name: 'stdio-mcp-agent',
      model: 'openai/gpt-4o-mini',
      mcp: [
        {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      ],
    });
    expect(agent).toBeDefined();
    expect(agent.ctx.identity.agentName).toBe('stdio-mcp-agent');
  });

  it('should create agent with multiple MCP servers', () => {
    const agent = createAgent({
      name: 'multi-mcp-agent',
      model: 'openai/gpt-4o-mini',
      mcp: [
        { type: 'stdio', command: 'server-a', args: [] },
        { type: 'stdio', command: 'server-b', args: ['--verbose'] },
      ],
    });
    expect(agent).toBeDefined();
    expect(agent.ctx.identity.agentName).toBe('multi-mcp-agent');
  });

  it('should create agent with MCP config including env vars', () => {
    const agent = createAgent({
      name: 'env-mcp-agent',
      model: 'openai/gpt-4o-mini',
      mcp: [
        {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: { NODE_ENV: 'production', API_KEY: 'test-key' },
        },
      ],
    });
    expect(agent).toBeDefined();
  });

  it('should produce unique session IDs for different MCP agents', () => {
    const agent1 = createAgent({ name: 'mcp-a', model: 'openai/gpt-4o-mini', mcp: [] });
    const agent2 = createAgent({ name: 'mcp-b', model: 'openai/gpt-4o-mini', mcp: [] });
    expect(agent1.ctx.identity.sessionId).not.toBe(agent2.ctx.identity.sessionId);
  });
});
