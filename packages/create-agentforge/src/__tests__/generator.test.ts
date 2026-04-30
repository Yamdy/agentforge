import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateProject, type GenerateOptions } from '../generator.js';
import type { PromptsConfig } from '../config.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTempDir, cleanupTempDir } from '../utils.js';

/**
 * Helper to create a minimal test config
 */
function createTestConfig(overrides: Partial<PromptsConfig> = {}): PromptsConfig {
  return {
    projectName: 'test-agent',
    agentName: 'test-agent',
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
    apiMode: 'simple',
    gitInit: false,
    ...overrides,
  };
}

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push(fullPath.replace(baseDir, '').replace(/^[/\\]/, ''));
    }
  }
  
  return files;
}

describe('generator', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = createTempDir('generator-test-');
  });

  afterEach(() => {
    cleanupTempDir(outputDir);
  });

  describe('generateProject', () => {
    it('generates minimal project with base files only', async () => {
      const config = createTestConfig();
      
      const result = await generateProject(config, outputDir);
      
      // Verify result structure
      expect(result.targetDir).toBe(resolve(outputDir));
      expect(result.files.length).toBeGreaterThan(0);
      
      // Check critical base files exist
      const files = getAllFiles(outputDir);
      expect(files).toContain('package.json');
      expect(files).toContain('tsconfig.json');
      expect(files).toContain('.gitignore');
      expect(files).toContain('.env.example');
      expect(files).toContain('README.md');
      expect(files).toContain('agentforge.config.ts');
      expect(files).toContain(join('src', 'index.ts'));
      expect(files).toContain(join('src', 'types.ts'));
      
      // LLM adapter should always be created
      expect(files).toContain(join('src', 'llm', 'adapter.ts'));
      
      // No module directories should exist for minimal config
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'tools'))).toBe(false);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'checkpoint'))).toBe(false);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'observability'))).toBe(false);
    });

    it('generates project with checkpoint storage', async () => {
      const config = createTestConfig({ checkpoint: true });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files).toContain(join('src', 'checkpoint', 'storage.ts'));
    });

    it('generates SQLite checkpoint storage by default', async () => {
      const config = createTestConfig({ checkpoint: true, checkpointStorage: 'sqlite' });
      
      await generateProject(config, outputDir);
      
      const storagePath = join(outputDir, 'src', 'checkpoint', 'storage.ts');
      const content = readFileSync(storagePath, 'utf-8');
      
      expect(content).toContain('SQLite');
      expect(content).toContain('better-sqlite3');
    });

    it('generates in-memory checkpoint storage when specified', async () => {
      const config = createTestConfig({ checkpoint: true, checkpointStorage: 'memory' });
      
      await generateProject(config, outputDir);
      
      const storagePath = join(outputDir, 'src', 'checkpoint', 'storage.ts');
      const content = readFileSync(storagePath, 'utf-8');
      
      expect(content).toContain('InMemory');
      expect(content).toContain('development');
    });

    it('generates project with full observability stack', async () => {
      const config = createTestConfig({ observability: true });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files).toContain(join('src', 'observability', 'logger.ts'));
      expect(files).toContain(join('src', 'observability', 'tracer.ts'));
      expect(files).toContain(join('src', 'observability', 'metrics.ts'));
    });

    it('generates project with tools', async () => {
      const config = createTestConfig({ tools: true });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files).toContain(join('src', 'tools', 'index.ts'));
      expect(files).toContain(join('src', 'tools', 'weather.ts'));
    });

    it('generates project with HITL controller', async () => {
      const config = createTestConfig({ hitl: true });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files).toContain(join('src', 'hitl', 'controller.ts'));
    });

    it('generates project with plugins', async () => {
      const config = createTestConfig({ plugins: true });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files).toContain(join('src', 'plugins', 'index.ts'));
    });

    it('generates project with compaction', async () => {
      const config = createTestConfig({ compaction: true });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files).toContain(join('src', 'memory', 'compaction.ts'));
    });

    it('generates project with subagent registry', async () => {
      const config = createTestConfig({ subagent: true });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files).toContain(join('src', 'subagent', 'registry.ts'));
    });

    it('generates project with MCP client', async () => {
      const config = createTestConfig({ mcp: true });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files).toContain(join('src', 'mcp', 'client.ts'));
    });

    it('generates operators pipeline for advanced API mode', async () => {
      const config = createTestConfig({ apiMode: 'advanced' });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files).toContain(join('src', 'operators', 'pipeline.ts'));
    });

    it('does not generate operators for simple API mode', async () => {
      const config = createTestConfig({ apiMode: 'simple' });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'operators'))).toBe(false);
    });

    it('generates index.ts with L2 API for simple mode', async () => {
      const config = createTestConfig({ apiMode: 'simple' });
      
      await generateProject(config, outputDir);
      
      const indexPath = join(outputDir, 'src', 'index.ts');
      const content = readFileSync(indexPath, 'utf-8');
      
      expect(content).toContain("import { createAgent } from 'agentforge'");
      expect(content).toContain('createAgent(config)');
    });

    it('generates index.ts with L3 API for advanced mode', async () => {
      const config = createTestConfig({ apiMode: 'advanced' });
      
      await generateProject(config, outputDir);
      
      const indexPath = join(outputDir, 'src', 'index.ts');
      const content = readFileSync(indexPath, 'utf-8');
      
      expect(content).toContain("import { runAgent, AgentContextBuilder } from 'agentforge/api'");
      expect(content).toContain('AgentContextBuilder');
    });

    it('generates correct agentforge.config.ts with tools import', async () => {
      const config = createTestConfig({ tools: true });
      
      await generateProject(config, outputDir);
      
      const configPath = join(outputDir, 'agentforge.config.ts');
      const content = readFileSync(configPath, 'utf-8');
      
      expect(content).toContain("import { tools } from './src/tools/index.js'");
      expect(content).toContain('tools,');
    });

    it('generates correct agentforge.config.ts without tools import when disabled', async () => {
      const config = createTestConfig({ tools: false });
      
      await generateProject(config, outputDir);
      
      const configPath = join(outputDir, 'agentforge.config.ts');
      const content = readFileSync(configPath, 'utf-8');
      
      // Should NOT have tools import
      expect(content).not.toContain("import { tools } from './src/tools/index.js'");
    });

    it('generates correct OpenAI adapter', async () => {
      const config = createTestConfig({ llm: 'openai', llmModel: 'gpt-4o' });
      
      await generateProject(config, outputDir);
      
      const adapterPath = join(outputDir, 'src', 'llm', 'adapter.ts');
      const content = readFileSync(adapterPath, 'utf-8');
      
      expect(content).toContain('@ai-sdk/openai');
      expect(content).toContain('createOpenAI');
      expect(content).toContain('gpt-4o');
    });

    it('generates correct Anthropic adapter', async () => {
      const config = createTestConfig({ llm: 'anthropic', llmModel: 'claude-sonnet-4' });
      
      await generateProject(config, outputDir);
      
      const adapterPath = join(outputDir, 'src', 'llm', 'adapter.ts');
      const content = readFileSync(adapterPath, 'utf-8');
      
      expect(content).toContain('@ai-sdk/anthropic');
      expect(content).toContain('createAnthropic');
      expect(content).toContain('claude-sonnet-4');
    });

    it('generates correct DeepSeek adapter', async () => {
      const config = createTestConfig({ llm: 'deepseek', llmModel: 'deepseek-chat' });
      
      await generateProject(config, outputDir);
      
      const adapterPath = join(outputDir, 'src', 'llm', 'adapter.ts');
      const content = readFileSync(adapterPath, 'utf-8');
      
      expect(content).toContain('@ai-sdk/openai-compatible');
      expect(content).toContain('createOpenAICompatible');
      expect(content).toContain('deepseek-chat');
    });

    it('generates mock adapter for mock LLM', async () => {
      const config = createTestConfig({ llm: 'mock', llmModel: 'mock-v1' });
      
      await generateProject(config, outputDir);
      
      const adapterPath = join(outputDir, 'src', 'llm', 'adapter.ts');
      const content = readFileSync(adapterPath, 'utf-8');
      
      expect(content).toContain('Mock adapter');
      expect(content).toContain('MOCK_RESPONSES');
    });

    it('generates correct package.json with dependencies', async () => {
      const config = createTestConfig({ 
        llm: 'openai', 
        checkpoint: true,
        mcp: true,
      });
      
      await generateProject(config, outputDir);
      
      const pkgPath = join(outputDir, 'package.json');
      const content = readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      // Core dependencies
      expect(pkg.dependencies).toHaveProperty('agentforge');
      // rxjs removed from CORE_DEPS
      expect(pkg.dependencies).toHaveProperty('zod');
      expect(pkg.dependencies).toHaveProperty('dotenv');
      
      // LLM dependency
      expect(pkg.dependencies).toHaveProperty('@ai-sdk/openai');
      
      // Checkpoint dependency
      expect(pkg.dependencies).toHaveProperty('better-sqlite3');
      
      // MCP dependency
      expect(pkg.dependencies).toHaveProperty('@modelcontextprotocol/sdk');
      
      // Dev dependencies
      expect(pkg.devDependencies).toHaveProperty('typescript');
      expect(pkg.devDependencies).toHaveProperty('vitest');
      expect(pkg.devDependencies).toHaveProperty('tsx');
    });

    it('generates correct .env.example for OpenAI', async () => {
      const config = createTestConfig({ llm: 'openai' });
      
      await generateProject(config, outputDir);
      
      const envPath = join(outputDir, '.env.example');
      const content = readFileSync(envPath, 'utf-8');
      
      expect(content).toContain('OPENAI_API_KEY');
    });

    it('generates correct .env.example for Anthropic', async () => {
      const config = createTestConfig({ llm: 'anthropic' });
      
      await generateProject(config, outputDir);
      
      const envPath = join(outputDir, '.env.example');
      const content = readFileSync(envPath, 'utf-8');
      
      expect(content).toContain('ANTHROPIC_API_KEY');
    });

    it('generates correct .env.example for DeepSeek', async () => {
      const config = createTestConfig({ llm: 'deepseek' });
      
      await generateProject(config, outputDir);
      
      const envPath = join(outputDir, '.env.example');
      const content = readFileSync(envPath, 'utf-8');
      
      expect(content).toContain('DEEPSEEK_API_KEY');
    });

    it('includes project name in README', async () => {
      const config = createTestConfig({ projectName: 'my-custom-agent' });
      
      await generateProject(config, outputDir);
      
      const readmePath = join(outputDir, 'README.md');
      const content = readFileSync(readmePath, 'utf-8');
      
      expect(content).toContain('my-custom-agent');
    });

    it('includes enabled modules in README', async () => {
      const config = createTestConfig({ 
        tools: true, 
        checkpoint: true, 
        observability: true 
      });
      
      await generateProject(config, outputDir);
      
      const readmePath = join(outputDir, 'README.md');
      const content = readFileSync(readmePath, 'utf-8');
      
      expect(content).toContain('Tools');
      expect(content).toContain('Checkpoint');
      expect(content).toContain('Observability');
    });
  });

  describe('dry-run mode', () => {
    it('lists files without writing', async () => {
      const config = createTestConfig();
      const options: GenerateOptions = { dryRun: true };
      
      const result = await generateProject(config, outputDir, options);
      
      // Should return file list
      expect(result.files.length).toBeGreaterThan(0);
      
      // Should contain expected files
      const paths = result.files.map(f => f.path);
      expect(paths).toContain('package.json');
      expect(paths).toContain('tsconfig.json');
      expect(paths).toContain('agentforge.config.ts');
      expect(paths).toContain('src/index.ts');
      expect(paths).toContain('src/llm/adapter.ts');
      
      // Output directory should be empty (no actual writes)
      const entries = readdirSync(outputDir);
      expect(entries.length).toBe(0);
    });

    it('lists module files when enabled in dry-run', async () => {
      const config = createTestConfig({ 
        tools: true, 
        checkpoint: true, 
        observability: true,
        hitl: true,
      });
      const options: GenerateOptions = { dryRun: true };
      
      const result = await generateProject(config, outputDir, options);
      const paths = result.files.map(f => f.path);
      
      expect(paths).toContain('src/tools/index.ts');
      expect(paths).toContain('src/tools/weather.ts');
      expect(paths).toContain('src/checkpoint/storage.ts');
      expect(paths).toContain('src/observability/logger.ts');
      expect(paths).toContain('src/observability/tracer.ts');
      expect(paths).toContain('src/observability/metrics.ts');
      expect(paths).toContain('src/hitl/controller.ts');
    });

    it('includes file descriptions in dry-run', async () => {
      const config = createTestConfig();
      const options: GenerateOptions = { dryRun: true };
      
      const result = await generateProject(config, outputDir, options);
      
      // Each file should have a description
      for (const file of result.files) {
        expect(file.description).toBeTruthy();
        expect(typeof file.description).toBe('string');
      }
    });
  });

  describe('full-featured project', () => {
    it('generates project with all modules enabled', async () => {
      const config = createTestConfig({
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
      });
      
      await generateProject(config, outputDir);
      
      const files = getAllFiles(outputDir);
      
      // All module directories should exist
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'llm'))).toBe(true);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'tools'))).toBe(true);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'checkpoint'))).toBe(true);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'observability'))).toBe(true);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'hitl'))).toBe(true);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'plugins'))).toBe(true);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'memory'))).toBe(true);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'subagent'))).toBe(true);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'mcp'))).toBe(true);
      expect(files.some(f => f.startsWith('src' + require('path').sep + 'operators'))).toBe(true);
      
      // Config should import all modules
      const configPath = join(outputDir, 'agentforge.config.ts');
      const configContent = readFileSync(configPath, 'utf-8');
      
      expect(configContent).toContain("from './src/tools/index.js'");
      expect(configContent).toContain("from './src/checkpoint/storage.js'");
      expect(configContent).toContain("from './src/observability/logger.js'");
      expect(configContent).toContain("from './src/hitl/controller.js'");
      expect(configContent).toContain("from './src/plugins/index.js'");
      expect(configContent).toContain("from './src/memory/compaction.js'");
      expect(configContent).toContain("from './src/subagent/registry.js'");
      expect(configContent).toContain("from './src/mcp/client.js'");
    });
  });
});
