/**
 * L1 API Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadConfig, L1AgentConfigSchema } from '../../src/l1/index.js';

describe('L1 API', () => {
  const testDir = join(__dirname, 'test-configs');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('L1AgentConfigSchema', () => {
    it('should validate minimal config', () => {
      const config = {
        name: 'test-agent',
        model: { provider: 'openai', model: 'gpt-4o' },
      };

      const result = L1AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const config = {
        name: 'test-agent',
        model: { provider: 'openai', model: 'gpt-4o' },
      };

      const result = L1AgentConfigSchema.parse(config);
      expect(result.maxSteps).toBe(10);
      expect(result.streaming).toBe(false);  // L2 default
      expect(result.parallelToolCalls).toBe(true);  // L2 default
      expect(result.tools).toEqual([]);
    });

    it('should reject invalid provider', () => {
      const config = {
        name: 'test-agent',
        model: { provider: 'invalid', model: 'gpt-4o' },
      };

      const result = L1AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const config = {
        name: '',
        model: { provider: 'openai', model: 'gpt-4o' },
      };

      const result = L1AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should accept all providers', () => {
      const providers = ['openai', 'anthropic', 'google', 'custom'];

      for (const provider of providers) {
        const config = {
          name: 'test-agent',
          model: { provider, model: 'test-model' },
        };

        const result = L1AgentConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should accept tool names as strings', () => {
      const config = {
        name: 'test-agent',
        model: { provider: 'openai', model: 'gpt-4o' },
        tools: ['read', 'write', 'bash'],
      };

      const result = L1AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tools).toEqual(['read', 'write', 'bash']);
      }
    });

    it('should accept tool configs as objects', () => {
      const config = {
        name: 'test-agent',
        model: { provider: 'openai', model: 'gpt-4o' },
        tools: [
          { name: 'read', enabled: true },
          { name: 'write', enabled: false, timeout: 5000 },
        ],
      };

      const result = L1AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept optional fields', () => {
      const config = {
        name: 'test-agent',
        description: 'A test agent',
        model: { provider: 'openai', model: 'gpt-4o' },
        maxSteps: 20,
        timeout: 30000,
        systemPrompt: 'You are helpful.',
        preset: 'production',
        streaming: false,
        parallelToolCalls: true,
        retry: { maxAttempts: 3, delayMs: 1000 },
        checkpoint: { enabled: true, storage: 'sqlite' },
      };

      const result = L1AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('loadConfig()', () => {
    it('should load valid JSON config', () => {
      const configPath = join(testDir, 'agent.json');
      writeFileSync(configPath, JSON.stringify({
        name: 'test-agent',
        model: { provider: 'openai', model: 'gpt-4o' },
      }));

      const config = loadConfig(configPath);
      expect(config.name).toBe('test-agent');
      expect(config.model.provider).toBe('openai');
    });

    it('should load JSONC config with comments', () => {
      const configPath = join(testDir, 'agent.jsonc');
      writeFileSync(configPath, `{
        // Agent name
        "name": "test-agent",
        /* Model config */
        "model": {
          "provider": "openai",
          "model": "gpt-4o"
        }
      }`);

      const config = loadConfig(configPath);
      expect(config.name).toBe('test-agent');
    });

    it('should throw for non-existent file', () => {
      expect(() => loadConfig('non-existent.json')).toThrow('not found');
    });

    it('should throw for invalid JSON', () => {
      const configPath = join(testDir, 'invalid.json');
      writeFileSync(configPath, '{ invalid json }');

      expect(() => loadConfig(configPath)).toThrow();
    });

    it('should throw for invalid config', () => {
      const configPath = join(testDir, 'bad-config.json');
      writeFileSync(configPath, JSON.stringify({
        name: '',  // Empty name is invalid
        model: { provider: 'openai', model: 'gpt-4o' },
      }));

      expect(() => loadConfig(configPath)).toThrow('Invalid configuration');
    });
  });
});
