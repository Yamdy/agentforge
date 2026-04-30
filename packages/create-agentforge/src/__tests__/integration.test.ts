/**
 * Integration tests for create-agentforge.
 *
 * Tests the full pipeline: config → generator → files on disk.
 * Does NOT call git/npm (those are mocked in their own test files).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateProject } from '../generator.js';
import { computeDependencies } from '../deps.js';
import { validateConfig, DEFAULT_CONFIG } from '../config.js';
import { mergeCliArgs } from '../prompts.js';
import type { PromptsConfig } from '../config.js';

describe('integration', () => {
  const tempRoot = join(tmpdir(), 'agentforge-integration-test');

  beforeEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('full generation with minimal config (--default mode)', () => {
    it('creates all base files + LLM adapter', async () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'test-minimal-agent',
        agentName: 'test-minimal-agent',
        llm: 'openai',
      };

      const targetDir = join(tempRoot, 'test-minimal-agent');
      const result = await generateProject(config, targetDir);

      // Base files
      expect(existsSync(join(targetDir, 'agentforge.config.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'package.json'))).toBe(true);
      expect(existsSync(join(targetDir, 'tsconfig.json'))).toBe(true);
      expect(existsSync(join(targetDir, '.env.example'))).toBe(true);
      expect(existsSync(join(targetDir, '.gitignore'))).toBe(true);
      expect(existsSync(join(targetDir, 'README.md'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'index.ts'))).toBe(true);

      // LLM adapter (always present)
      expect(existsSync(join(targetDir, 'src', 'llm', 'adapter.ts'))).toBe(true);

      // Module directories should NOT exist (minimal config)
      expect(existsSync(join(targetDir, 'src', 'checkpoint'))).toBe(false);
      expect(existsSync(join(targetDir, 'src', 'observability'))).toBe(false);
      expect(existsSync(join(targetDir, 'src', 'hitl'))).toBe(false);
      expect(existsSync(join(targetDir, 'src', 'tools'))).toBe(false);

      // L2 API (simple mode)
      const indexContent = readFileSync(join(targetDir, 'src', 'index.ts'), 'utf-8');
      expect(indexContent).toContain('createAgent');
      expect(indexContent).not.toContain('AgentContextBuilder');

      // agentforge.config.ts contains defineConfig
      const configContent = readFileSync(join(targetDir, 'agentforge.config.ts'), 'utf-8');
      expect(configContent).toContain('defineConfig');

      // Verify result structure
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.targetDir).toBe(targetDir);
    });
  });

  describe('full generation with all modules enabled', () => {
    it('creates all base and module files', async () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'test-full-agent',
        agentName: 'test-full-agent',
        llm: 'openai',
        tools: true,
        checkpoint: true,
        checkpointStorage: 'sqlite',
        observability: true,
        hitl: true,
        plugins: true,
        compaction: true,
        subagent: true,
        mcp: true,
        apiMode: 'advanced',
      };

      const targetDir = join(tempRoot, 'test-full-agent');
      await generateProject(config, targetDir);

      // All module directories should exist
      expect(existsSync(join(targetDir, 'src', 'tools', 'index.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'tools', 'weather.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'checkpoint', 'storage.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'observability', 'logger.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'observability', 'tracer.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'observability', 'metrics.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'hitl', 'controller.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'plugins', 'index.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'memory', 'compaction.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'subagent', 'registry.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'mcp', 'client.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'operators', 'pipeline.ts'))).toBe(true);

      // L3 API (advanced mode)
      const indexContent = readFileSync(join(targetDir, 'src', 'index.ts'), 'utf-8');
      expect(indexContent).toContain('AgentContextBuilder');

      // agentforge.config.ts imports all modules
      const configContent = readFileSync(join(targetDir, 'agentforge.config.ts'), 'utf-8');
      expect(configContent).toContain('defineConfig');
      expect(configContent).toContain('tools');
      expect(configContent).toContain('checkpoint');
      expect(configContent).toContain('observability');
    });
  });

  describe('config validation round-trip', () => {
    it('validates valid default config', () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'valid-agent',
        agentName: 'valid-agent',
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects invalid LLM provider', () => {
      const result = validateConfig({
        projectName: 'test-agent',
        llm: 'invalid' as PromptsConfig['llm'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects empty project name', () => {
      const result = validateConfig({ projectName: '' });
      expect(result.valid).toBe(false);
    });
  });

  describe('dependency calculation', () => {
    it('includes core + openai deps', () => {
      const config: PromptsConfig = { ...DEFAULT_CONFIG, projectName: 'test', llm: 'openai' };
      const deps = computeDependencies(config);
      expect(deps).toHaveProperty('agentforge');
      // rxjs removed from CORE_DEPS
      expect(deps).toHaveProperty('zod');
      expect(deps).toHaveProperty('@ai-sdk/openai');
      expect(deps).toHaveProperty('ai');
    });

    it('excludes LLM-specific deps for mock provider', () => {
      const config: PromptsConfig = { ...DEFAULT_CONFIG, projectName: 'test', llm: 'mock' };
      const deps = computeDependencies(config);
      expect(deps).toHaveProperty('agentforge');
      expect(deps).not.toHaveProperty('@ai-sdk/openai');
    });

    it('includes checkpoint deps when checkpoint enabled', () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'test',
        llm: 'mock',
        checkpoint: true,
      };
      const deps = computeDependencies(config);
      expect(deps).toHaveProperty('better-sqlite3');
    });
  });

  describe('merge CLI args round-trip', () => {
    it('strips undefined values', () => {
      const result = mergeCliArgs({
        projectName: 'my-agent',
        apiKey: undefined,
        preset: undefined,
      });
      expect(result).toEqual({ projectName: 'my-agent' });
    });

    it('preserves falsy boolean values', () => {
      const result = mergeCliArgs({
        projectName: 'my-agent',
        tools: false,
        checkpoint: false,
      });
      expect(result.tools).toBe(false);
      expect(result.checkpoint).toBe(false);
    });
  });

  describe('dry-run mode', () => {
    it('returns file list without creating files', async () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'test-dryrun',
        agentName: 'test-dryrun',
        llm: 'openai',
      };

      const targetDir = join(tempRoot, 'test-dryrun');
      const result = await generateProject(config, targetDir, { dryRun: true });

      // Should have file entries
      expect(result.files.length).toBeGreaterThan(0);

      // Should NOT have created the target directory
      expect(existsSync(targetDir)).toBe(false);
    });
  });
});