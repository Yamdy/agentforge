import { describe, it, expect } from 'vitest';
import { AgentFactory, createAgent } from '../../src/agent/factory.js';
import { validateAgentConfig, validateAgentForgeConfig } from '../../src/config/index.js';

describe('AgentFactory', () => {
  describe('constructor', () => {
    it('should create with AgentConfig', () => {
      const config = validateAgentConfig({ name: 'Test Agent' });
      const factory = new AgentFactory(config);
      expect(factory).toBeInstanceOf(AgentFactory);
    });

    it('should create with AgentForgeConfig', () => {
      const config = validateAgentForgeConfig({
        name: 'test-agent',
        agent: { name: 'Test Agent' },
      });
      const factory = new AgentFactory(config);
      expect(factory).toBeInstanceOf(AgentFactory);
    });
  });

  describe('create', () => {
    it('should create an agent from minimal AgentConfig', () => {
      const config = validateAgentConfig({ name: 'Test Agent' });
      const agent = AgentFactory.create(config);
      expect(agent).toBeDefined();
    });

    it('should create an agent from AgentForgeConfig', () => {
      const config = validateAgentForgeConfig({
        name: 'test-agent',
        agent: {
          name: 'Test Agent',
          model: 'gpt-4o',
          maxSteps: 15,
        },
        model: {
          temperature: 0.7,
        },
      });
      const agent = AgentFactory.fromConfig(config);
      expect(agent).toBeDefined();
    });

    it('should merge model config from top-level correctly', () => {
      const config = validateAgentForgeConfig({
        name: 'test-agent',
        agent: {
          name: 'Test Agent',
          model: 'gpt-4-turbo',
        },
        model: {
          model: 'gpt-4o',
          temperature: 0.5,
        },
      });
      const agent = createAgent(config);
      expect(agent).toBeDefined();
    });

    it('should use createAgent helper function', () => {
      const config = validateAgentConfig({ name: 'Test Agent' });
      const agent = createAgent(config);
      expect(agent).toBeDefined();
    });
  });
});
