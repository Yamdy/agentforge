/**
 * Tests for the CLI entry point (index.ts).
 *
 * Tests CLI argument parsing, --default mode, validation,
 * and error handling. Mocks external dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptsConfig } from '../config.js';
import { DEFAULT_CONFIG } from '../config.js';

// Use vi.hoisted for mocks used in vi.mock factories
const { mockCollectPrompts, mockGenerateProject, mockRunPostInstall, mockMergeCliArgs } = vi.hoisted(() => ({
  mockCollectPrompts: vi.fn(),
  mockGenerateProject: vi.fn(),
  mockRunPostInstall: vi.fn(),
  mockMergeCliArgs: vi.fn((args: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }),
}));

vi.mock('../prompts.js', () => ({
  collectPrompts: mockCollectPrompts,
  mergeCliArgs: mockMergeCliArgs,
}));

vi.mock('../generator.js', () => ({
  generateProject: mockGenerateProject,
}));

vi.mock('../post-install.js', () => ({
  runPostInstall: mockRunPostInstall,
}));

vi.mock('chalk', () => ({
  default: {
    blue: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
    red: (s: string) => s,
    white: (s: string) => s,
  },
}));

// Suppress console output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { runAction } from '../index.js';

describe('index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateProject.mockResolvedValue({
      files: [
        { path: 'src/index.ts', description: 'Entry point' },
        { path: 'package.json', description: 'Package config' },
      ],
      targetDir: '/tmp/test-agent',
    });
    mockRunPostInstall.mockResolvedValue(undefined);
  });

  describe('runAction', () => {
    it('uses --default mode with provided project name', async () => {
      const opts = { default: true };

      await runAction('my-agent', opts);

      // Should call generateProject without calling collectPrompts
      expect(mockGenerateProject).toHaveBeenCalled();
      const config = mockGenerateProject.mock.calls[0][0] as PromptsConfig;
      expect(config.projectName).toBe('my-agent');
      expect(mockCollectPrompts).not.toHaveBeenCalled();
    });

    it('calls collectPrompts in interactive mode', async () => {
      const mockConfig: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'my-agent',
        agentName: 'my-agent',
        llm: 'openai',
        llmModel: 'gpt-4o',
      };
      mockCollectPrompts.mockResolvedValue(mockConfig);

      const opts = {};
      await runAction('my-agent', opts);

      expect(mockCollectPrompts).toHaveBeenCalled();
      expect(mockGenerateProject).toHaveBeenCalled();
    });

    it('maps --llm CLI option to config', async () => {
      const opts = { default: true, llm: 'anthropic' };

      await runAction('test-agent', opts);

      const config = mockGenerateProject.mock.calls[0][0] as PromptsConfig;
      expect(config.llm).toBe('anthropic');
    });

    it('maps boolean CLI flags to config', async () => {
      const opts = {
        default: true,
        tools: true,
        checkpoint: true,
        observability: true,
      };

      await runAction('test-agent', opts);

      const config = mockGenerateProject.mock.calls[0][0] as PromptsConfig;
      expect(config.tools).toBe(true);
      expect(config.checkpoint).toBe(true);
      expect(config.observability).toBe(true);
    });

    it('passes --dry-run to generateProject', async () => {
      const opts = { default: true, dryRun: true };

      await runAction('test-agent', opts);

      const generateOpts = mockGenerateProject.mock.calls[0][2] as { dryRun?: boolean };
      expect(generateOpts.dryRun).toBe(true);
    });

    it('skips post-install when --skip-install is set', async () => {
      const opts = { default: true, skipInstall: true };

      await runAction('test-agent', opts);

      expect(mockRunPostInstall).not.toHaveBeenCalled();
    });

    it('passes --no-git to config', async () => {
      const opts = { default: true, gitInit: false };

      await runAction('test-agent', opts);

      const config = mockGenerateProject.mock.calls[0][0] as PromptsConfig;
      expect(config.gitInit).toBe(false);
    });

    it('throws on validation error for invalid project name', async () => {
      const opts = { default: true };

      await expect(runAction('has spaces', opts)).rejects.toThrow();
    });

    it('runs post-install steps after successful generation', async () => {
      mockRunPostInstall.mockResolvedValue(undefined);
      const opts = { default: true };

      await runAction('test-agent', opts);

      expect(mockRunPostInstall).toHaveBeenCalled();
    });
  });
})