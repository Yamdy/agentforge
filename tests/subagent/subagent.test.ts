import { describe, it, expect } from 'vitest';
import { SubAgent } from '../../src/subagent/index.js';

describe('SubAgent Module Tests', () => {
  describe('Configuration and Types', () => {
    it('should export SubAgent namespace', () => {
      expect(SubAgent).toBeDefined();
      expect(SubAgent.register).toBeDefined();
      expect(SubAgent.list).toBeDefined();
      expect(SubAgent.get).toBeDefined();
      expect(SubAgent.delegate).toBeDefined();
      expect(SubAgent.createDelegateToSubAgentTool).toBeDefined();
      expect(SubAgent.createListSubAgentsTool).toBeDefined();
    });
  });

  describe('SubAgent Registration', () => {
    it('should list sub-agents (empty initially)', () => {
      const agents = SubAgent.list();
      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBe(0);
    });

    it('should create delegate_to_subagent tool', () => {
      const tool = SubAgent.createDelegateToSubAgentTool();
      expect(tool.name).toBe('delegate_to_subagent');
      expect(typeof tool.execute).toBe('function');
    });

    it('should create list_subagents tool', () => {
      const tool = SubAgent.createListSubAgentsTool();
      expect(tool.name).toBe('list_subagents');
      expect(typeof tool.execute).toBe('function');
    });

    it('should handle non-existent sub-agent in tool', async () => {
      const tool = SubAgent.createDelegateToSubAgentTool();
      const result = await tool.execute({ subagent: 'non-existent', task: 'test' });
      expect(typeof result).toBe('string');
      expect(result).toContain('Error');
    });

    it('should list sub-agents via tool', async () => {
      const tool = SubAgent.createListSubAgentsTool();
      const result = await tool.execute({});
      expect(typeof result).toBe('string');
      expect(result).toContain('No sub-agents');
    });
  });

  describe('Delegation System', () => {
    it('should throw error when delegating to non-existent sub-agent', async () => {
      await expect(SubAgent.delegate('non-existent', 'test task', [])).rejects.toThrow();
    });
  });
});
