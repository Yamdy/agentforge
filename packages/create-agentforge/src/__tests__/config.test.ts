import { describe, it, expect } from 'vitest';
import {
  VALID_LLM_PROVIDERS,
  VALID_PRESETS,
  VALID_API_MODES,
  VALID_CHECKPOINT_STORAGE,
  VALID_LLM_MODELS,
  DEFAULT_VALUES,
  DEFAULT_CONFIG,
  validateConfig,
} from '../config.js';
import type {
  PromptsConfig,
  LLMProvider,
  Preset,
  APIMode,
} from '../config.js';

describe('config', () => {
  describe('DEFAULT_VALUES', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_VALUES.maxSteps).toBe(10);
      expect(DEFAULT_VALUES.llm).toBe('openai');
      expect(DEFAULT_VALUES.llmModel).toBe('gpt-4o');
      expect(DEFAULT_VALUES.tools).toBe(false);
      expect(DEFAULT_VALUES.toolList).toEqual([]);
      expect(DEFAULT_VALUES.checkpoint).toBe(false);
      expect(DEFAULT_VALUES.checkpointStorage).toBe('sqlite');
      expect(DEFAULT_VALUES.observability).toBe(false);
      expect(DEFAULT_VALUES.hitl).toBe(false);
      expect(DEFAULT_VALUES.plugins).toBe(false);
      expect(DEFAULT_VALUES.compaction).toBe(false);
      expect(DEFAULT_VALUES.subagent).toBe(false);
      expect(DEFAULT_VALUES.mcp).toBe(false);
      expect(DEFAULT_VALUES.deployment).toBe(false);
      expect(DEFAULT_VALUES.apiMode).toBe('simple');
      expect(DEFAULT_VALUES.gitInit).toBe(true);
    });

    it('should have empty agentName that defaults to projectName', () => {
      expect(DEFAULT_VALUES.agentName).toBe('');
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should include projectName and spread DEFAULT_VALUES', () => {
      expect(DEFAULT_CONFIG.projectName).toBe('');
      expect(DEFAULT_CONFIG.maxSteps).toBe(DEFAULT_VALUES.maxSteps);
      expect(DEFAULT_CONFIG.llm).toBe(DEFAULT_VALUES.llm);
    });
  });

  describe('validateConfig', () => {
    it('should return valid: true for a valid config', () => {
      const config: PromptsConfig = {
        projectName: 'my-agent',
        agentName: 'my-agent',
        maxSteps: 10,
        llm: 'openai',
        llmModel: 'gpt-4o',
        tools: false,
        toolList: [],
        checkpoint: false,
        checkpointStorage: 'sqlite',
        observability: false,
        hitl: false,
        plugins: false,
        compaction: false,
        subagent: false,
        mcp: false,
        deployment: false,
        apiMode: 'simple',
        gitInit: true,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for invalid LLM provider', () => {
      const config = {
        projectName: 'my-agent',
        llm: 'invalid-provider' as LLMProvider,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid LLM provider "invalid-provider"');
      expect(result.errors[0]).toContain('openai, anthropic, deepseek, mock');
    });

    it('should return error for empty projectName', () => {
      const config = {
        projectName: '',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Project name is required');
    });

    it('should return error for whitespace-only projectName', () => {
      const config = {
        projectName: '   ',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Project name is required');
    });

    it('should return error for spaces in projectName', () => {
      const config = {
        projectName: 'my agent',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Project name cannot contain spaces');
    });

    it('should return error for invalid characters in projectName', () => {
      const config = {
        projectName: 'my@agent!',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Project name can only contain letters, numbers, hyphens, and underscores');
    });

    it('should accept valid projectName with hyphens and underscores', () => {
      const config = {
        projectName: 'my_agent-name-123',
        llm: 'openai' as LLMProvider,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
    });

    it('should return error for invalid preset', () => {
      const config = {
        projectName: 'my-agent',
        preset: 'invalid-preset' as Preset,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid preset "invalid-preset"');
      expect(result.errors[0]).toContain('production, debug, test');
    });

    it('should return error for invalid API mode', () => {
      const config = {
        projectName: 'my-agent',
        apiMode: 'invalid-mode' as APIMode,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid API mode "invalid-mode"');
      expect(result.errors[0]).toContain('simple, advanced');
    });

    it('should accumulate multiple errors', () => {
      const config = {
        projectName: '',
        llm: 'invalid' as LLMProvider,
        preset: 'invalid' as Preset,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('VALID_LLM_PROVIDERS', () => {
    it('should contain all expected providers', () => {
      expect(VALID_LLM_PROVIDERS).toContain('openai');
      expect(VALID_LLM_PROVIDERS).toContain('anthropic');
      expect(VALID_LLM_PROVIDERS).toContain('deepseek');
      expect(VALID_LLM_PROVIDERS).toContain('mock');
      expect(VALID_LLM_PROVIDERS).toHaveLength(4);
    });
  });

  describe('VALID_PRESETS', () => {
    it('should contain all expected presets', () => {
      expect(VALID_PRESETS).toContain('production');
      expect(VALID_PRESETS).toContain('debug');
      expect(VALID_PRESETS).toContain('test');
      expect(VALID_PRESETS).toHaveLength(3);
    });
  });

  describe('VALID_API_MODES', () => {
    it('should contain all expected API modes', () => {
      expect(VALID_API_MODES).toContain('simple');
      expect(VALID_API_MODES).toContain('advanced');
      expect(VALID_API_MODES).toHaveLength(2);
    });
  });

  describe('VALID_CHECKPOINT_STORAGE', () => {
    it('should contain all expected storage types', () => {
      expect(VALID_CHECKPOINT_STORAGE).toContain('sqlite');
      expect(VALID_CHECKPOINT_STORAGE).toContain('memory');
      expect(VALID_CHECKPOINT_STORAGE).toHaveLength(2);
    });
  });

  describe('VALID_LLM_MODELS', () => {
    it('should have correct default models for each provider', () => {
      expect(VALID_LLM_MODELS['openai']).toBe('gpt-4o');
      expect(VALID_LLM_MODELS['anthropic']).toBe('claude-sonnet-4');
      expect(VALID_LLM_MODELS['deepseek']).toBe('deepseek-chat');
      expect(VALID_LLM_MODELS['mock']).toBe('mock-v1');
    });
  });
});
