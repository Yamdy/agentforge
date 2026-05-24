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
    it('should create an agent from minimal AgentConfig', async () => {
      const config = validateAgentConfig({ name: 'Test Agent' });
      const agent = await AgentFactory.create(config);
      expect(agent).toBeDefined();
    });

    it('should create an agent from AgentForgeConfig', async () => {
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
      const agent = await AgentFactory.fromConfig(config);
      expect(agent).toBeDefined();
    });

    it('should merge model config from top-level correctly', async () => {
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
      const agent = await createAgent(config);
      expect(agent).toBeDefined();
    });

    it('should use createAgent helper function', async () => {
      const config = validateAgentConfig({ name: 'Test Agent' });
      const agent = await createAgent(config);
      expect(agent).toBeDefined();
    });
  });
});
