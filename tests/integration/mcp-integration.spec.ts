/**
 * MCP Integration Tests
 *
 * Tests for MCP client integration with createAgent.
 * Note: Full MCP integration tests require mocking createMCPClient which
 * is tested separately. This file provides basic smoke tests.
 */

import { describe, it, expect } from 'vitest';
import { createAgent } from '../../src/api/create-agent.js';

describe('MCP Integration (createAgent)', () => {
  it('should create agent without MCP when no config provided', () => {
    const agent = createAgent({
      name: 'no-mcp-agent',
      model: 'openai/gpt-4o-mini',
    });
    expect(agent).toBeDefined();
    expect(agent.context.sessionId).toBeDefined();
    expect(agent.context.agentName).toBe('no-mcp-agent');
  });

  it('should create agent with empty MCP array without error', () => {
    const agent = createAgent({
      name: 'empty-mcp-agent',
      model: 'openai/gpt-4o-mini',
      mcp: [],
    });
    expect(agent).toBeDefined();
    expect(agent.context.sessionId).toBeDefined();
  });

  it('should have sessionId as non-empty string', () => {
    const agent = createAgent({
      name: 'test-agent',
      model: 'openai/gpt-4o-mini',
    });
    expect(typeof agent.context.sessionId).toBe('string');
    expect(agent.context.sessionId.length).toBeGreaterThan(0);
  });
});
