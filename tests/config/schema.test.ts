import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  PrimoConfigSchema,
  AgentConfigSchema,
  ServerConfigSchema,
  ModelConfigSchema,
  validatePrimoConfig,
  validateAgentConfig,
} from '../../src/config/index.js';

describe('Configuration Schema', () => {
  describe('PrimoConfigSchema', () => {
    it('should validate a minimal valid configuration', () => {
      const config = {
        name: 'test-agent',
        agent: {
          name: 'Test Agent',
        },
      };

      expect(() => validatePrimoConfig(config)).not.toThrow();
      const validated = validatePrimoConfig(config);
      expect(validated.name).toBe('test-agent');
      expect(validated.agent.name).toBe('Test Agent');
      expect(validated.version).toBe('1.0.0');
      expect(validated.environment).toBe('development');
    });

    it('should validate a complete configuration', () => {
      const config = {
        name: 'my-agent',
        version: '1.0.0',
        description: 'My test agent',
        environment: 'production',
        agent: {
          name: 'My Agent',
          description: 'A helpful agent',
          model: 'gpt-4o',
          apiKey: 'sk-xxx',
          maxSteps: 15,
          systemPrompt: 'You are a helpful assistant.',
          tools: ['calculator', 'web_search'],
          plugins: [
            {
              name: 'my-plugin',
              enabled: true,
            },
          ],
        },
        server: {
          port: 8080,
          apiKey: 'my-server-key',
          compactionThreshold: 30,
          rateLimit: {
            enabled: true,
            maxRequests: 200,
          },
        },
        logging: {
          level: 'debug',
          enabled: true,
        },
      };

      expect(() => validatePrimoConfig(config)).not.toThrow();
      const validated = validatePrimoConfig(config);
      expect(validated.agent.maxSteps).toBe(15);
      expect(validated.server?.port).toBe(8080);
      expect(validated.logging?.level).toBe('debug');
    });

    it('should fail when name is missing', () => {
      const config = {
        agent: {
          name: 'Test Agent',
        },
      };

      expect(() => validatePrimoConfig(config)).toThrow();
    });

    it('should fail when agent is missing', () => {
      const config = {
        name: 'test-agent',
      };

      expect(() => validatePrimoConfig(config)).toThrow();
    });
  });

  describe('AgentConfigSchema', () => {
    it('should set defaults correctly', () => {
      const config = {
        name: 'Test Agent',
      };

      const validated = validateAgentConfig(config);
      expect(validated.model).toBe('gpt-4-turbo');
      expect(validated.maxSteps).toBe(10);
      expect(validated.tools).toEqual([]);
      expect(validated.plugins).toEqual([]);
    });

    it('should accept tool configs as objects', () => {
      const config = {
        name: 'Test Agent',
        tools: [
          { name: 'calculator', enabled: true, description: 'Calculator tool' },
          'web_search',
        ],
      };

      expect(() => validateAgentConfig(config)).not.toThrow();
      const validated = validateAgentConfig(config);
      expect(validated.tools).toHaveLength(2);
    });
  });

  describe('ServerConfigSchema', () => {
    it('should set default port', () => {
      const config = {};
      const validated = ServerConfigSchema.parse(config);
      expect(validated.port).toBe(3000);
      expect(validated.corsOrigins).toBe('*');
    });

    it('should accept array for corsOrigins', () => {
      const config = {
        corsOrigins: ['https://example.com', 'http://localhost:3000'],
      };
      const validated = ServerConfigSchema.parse(config);
      expect(Array.isArray(validated.corsOrigins)).toBe(true);
    });
  });

  describe('ModelConfigSchema', () => {
    it('should have correct defaults', () => {
      const config = {};
      const validated = ModelConfigSchema.parse(config);
      expect(validated.model).toBe('gpt-4-turbo');
    });
  });
});
