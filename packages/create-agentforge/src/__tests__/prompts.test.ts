/**
 * Tests for the interactive prompts module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptsConfig } from '../config.js';

// Use vi.hoisted for mock used in vi.mock factory
const { mockPrompt } = vi.hoisted(() => ({
  mockPrompt: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: mockPrompt,
  },
}));

import { mergeCliArgs, collectPrompts } from '../prompts.js';

describe('prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mergeCliArgs', () => {
    it('removes undefined entries', () => {
      const result = mergeCliArgs({
        projectName: 'my-agent',
        llm: 'openai' as const,
        apiKey: undefined,
        preset: undefined,
      });
      expect(result).toEqual({
        projectName: 'my-agent',
        llm: 'openai',
      });
    });

    it('preserves falsy values that are not undefined', () => {
      const result = mergeCliArgs({
        projectName: 'my-agent',
        tools: false,
        checkpoint: false,
      });
      expect(result.tools).toBe(false);
      expect(result.checkpoint).toBe(false);
    });

    it('returns empty object for empty input', () => {
      const result = mergeCliArgs({});
      expect(result).toEqual({});
    });

    it('preserves empty string values', () => {
      const result = mergeCliArgs({ projectName: '' });
      expect(result.projectName).toBe('');
    });

    it('preserves zero values', () => {
      const result = mergeCliArgs({ maxSteps: 0 });
      expect(result.maxSteps).toBe(0);
    });
  });

  describe('collectPrompts', () => {
    // Helper: a fully-specified config that should trigger NO prompts
    const FULL_CONFIG: Partial<PromptsConfig> = {
      projectName: 'test-agent',
      agentName: 'test-agent',
      maxSteps: 10,
      llm: 'openai' as const,
      llmModel: 'gpt-4o',
      apiKey: undefined,  // explicitly in overrides = "skip prompt"
      tools: false,
      toolList: [],
      checkpoint: false,
      checkpointStorage: 'sqlite' as const,
      observability: false,
      hitl: false,
      plugins: false,
      compaction: false,
      subagent: false,
      mcp: false,
      apiMode: 'simple' as const,
      preset: undefined,  // explicitly in overrides = "skip prompt"
      gitInit: true,
    };

    it('returns default config when all fields are pre-filled (--default mode)', async () => {
      const result = await collectPrompts(FULL_CONFIG);

      expect(result.projectName).toBe('test-agent');
      expect(result.llm).toBe('openai');
      expect(result.apiMode).toBe('simple');
      // inquirer.prompt should not be called since all fields are provided
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('prompts for missing fields when partial config provided', async () => {
      // Only projectName provided — mocks must answer all remaining prompts
      mockPrompt
        .mockResolvedValueOnce({ agentName: 'my-agent' })
        .mockResolvedValueOnce({ maxSteps: 10 })
        .mockResolvedValueOnce({ llm: 'anthropic' })
        .mockResolvedValueOnce({ llmModel: 'claude-sonnet-4' })
        .mockResolvedValueOnce({ apiKey: '' })
        .mockResolvedValueOnce({ modules: [] })
        .mockResolvedValueOnce({ apiMode: 'simple' })
        .mockResolvedValueOnce({ preset: '' })
        .mockResolvedValueOnce({ gitInit: true });

      const result = await collectPrompts({ projectName: 'my-agent' });

      expect(result.projectName).toBe('my-agent');
      expect(result.llm).toBe('anthropic');
      expect(mockPrompt).toHaveBeenCalled();
    });

    it('throws validation error for invalid project name', async () => {
      await expect(
        collectPrompts({ projectName: 'has spaces' })
      ).rejects.toThrow();
    });

    it('throws validation error for empty project name', async () => {
      await expect(
        collectPrompts({ projectName: '' })
      ).rejects.toThrow();
    });

    it('maps boolean module flags directly to config', async () => {
      const configWithModules: Partial<PromptsConfig> = {
        ...FULL_CONFIG,
        tools: true,
        checkpoint: true,
        observability: true,
        hitl: true,
        plugins: true,
        compaction: true,
        subagent: true,
        mcp: true,
      };

      const result = await collectPrompts(configWithModules);

      expect(result.tools).toBe(true);
      expect(result.checkpoint).toBe(true);
      expect(result.observability).toBe(true);
      expect(result.hitl).toBe(true);
      expect(result.plugins).toBe(true);
      expect(result.compaction).toBe(true);
      expect(result.subagent).toBe(true);
      expect(result.mcp).toBe(true);
    });

    it('prompts for checkpointStorage when checkpoint enabled but storage not specified', async () => {
      // Full config except checkpointStorage — should trigger exactly one prompt
      // ALL module booleans must be provided to skip the module checkbox prompt
      const configOverrides: Partial<PromptsConfig> = {
        projectName: 'test-agent',
        agentName: 'test-agent',
        maxSteps: 10,
        llm: 'openai' as const,
        llmModel: 'gpt-4o',
        apiKey: undefined,  // skip apiKey prompt
        checkpoint: true,
        // checkpointStorage NOT provided — should prompt
        tools: false,
        observability: false,
        hitl: false,
        plugins: false,
        compaction: false,
        subagent: false,
        mcp: false,
        apiMode: 'simple' as const,
        preset: undefined,  // skip preset prompt
        gitInit: true,
      };

      mockPrompt.mockResolvedValueOnce({ checkpointStorage: 'memory' });

      const result = await collectPrompts(configOverrides);
      expect(result.checkpointStorage).toBe('memory');
      // Should have called prompt exactly once (for checkpointStorage)
      expect(mockPrompt).toHaveBeenCalledTimes(1);
    });

    it('skips apiKey prompt when already provided via CLI', async () => {
      const configWithKey: Partial<PromptsConfig> = {
        ...FULL_CONFIG,
        apiKey: 'sk-test-123',
      };

      const result = await collectPrompts(configWithKey);

      expect(result.apiKey).toBe('sk-test-123');
      expect(mockPrompt).not.toHaveBeenCalled();
    });
  });
})