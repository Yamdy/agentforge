import { describe, it, expect } from 'vitest';
import { computeDependencies, computeDevDependencies } from '../deps.js';
import type { PromptsConfig } from '../config.js';

function createConfig(overrides: Partial<PromptsConfig> = {}): PromptsConfig {
  return {
    projectName: 'test-project',
    agentName: 'test-project',
    maxSteps: 10,
    llm: 'mock',
    llmModel: 'mock-v1',
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

describe('computeDependencies', () => {
  it('always includes core dependencies', () => {
    const config = createConfig();
    const deps = computeDependencies(config);

    expect(deps['agentforge']).toBe('^0.1.0');
    // rxjs removed from CORE_DEPS (de-rxjs migration)
    expect(deps['rxjs']).toBeUndefined();
    expect(deps['zod']).toBe('^3.23.8');
    expect(deps['dotenv']).toBe('^16.4.0');
  });

  it('adds openai SDK for openai provider', () => {
    const config = createConfig({ llm: 'openai' });
    const deps = computeDependencies(config);

    expect(deps['@ai-sdk/openai']).toBe('^1.0.0');
    expect(deps['ai']).toBe('^6.0.0');
  });

  it('adds anthropic SDK for anthropic provider', () => {
    const config = createConfig({ llm: 'anthropic' });
    const deps = computeDependencies(config);

    expect(deps['@ai-sdk/anthropic']).toBe('^1.0.0');
    expect(deps['ai']).toBe('^6.0.0');
  });

  it('adds openai-compatible SDK for deepseek provider', () => {
    const config = createConfig({ llm: 'deepseek' });
    const deps = computeDependencies(config);

    expect(deps['@ai-sdk/openai-compatible']).toBe('^2.0.0');
    expect(deps['ai']).toBe('^6.0.0');
  });

  it('adds no extra deps for mock provider', () => {
    const config = createConfig({ llm: 'mock' });
    const deps = computeDependencies(config);

    // Should only have core deps (rxjs removed from CORE_DEPS)
    expect(Object.keys(deps).sort()).toEqual(['agentforge', 'dotenv', 'zod']);
  });

  it('adds better-sqlite3 when checkpoint is enabled', () => {
    const config = createConfig({ checkpoint: true });
    const deps = computeDependencies(config);

    expect(deps['better-sqlite3']).toBe('^11.0.0');
    expect(deps['@types/better-sqlite3']).toBe('^7.6.0');
  });

  it('adds MCP SDK when mcp is enabled', () => {
    const config = createConfig({ mcp: true });
    const deps = computeDependencies(config);

    expect(deps['@modelcontextprotocol/sdk']).toBe('^1.29.0');
  });

  it('combines all options correctly', () => {
    const config = createConfig({
      llm: 'openai',
      checkpoint: true,
      mcp: true,
    });
    const deps = computeDependencies(config);

    // Core deps
    expect(deps['agentforge']).toBe('^0.1.0');
    // rxjs removed from CORE_DEPS
    expect(deps['rxjs']).toBeUndefined();
    expect(deps['zod']).toBe('^3.23.8');
    expect(deps['dotenv']).toBe('^16.4.0');
    // LLM deps
    expect(deps['@ai-sdk/openai']).toBe('^1.0.0');
    expect(deps['ai']).toBe('^6.0.0');
    // Checkpoint deps
    expect(deps['better-sqlite3']).toBe('^11.0.0');
    expect(deps['@types/better-sqlite3']).toBe('^7.6.0');
    // MCP deps
    expect(deps['@modelcontextprotocol/sdk']).toBe('^1.29.0');
  });
});

describe('computeDevDependencies', () => {
  it('always includes standard dev dependencies', () => {
    const config = createConfig();
    const devDeps = computeDevDependencies(config);

    expect(devDeps['typescript']).toBe('^5.5.0');
    expect(devDeps['@types/node']).toBe('^22.0.0');
    expect(devDeps['tsx']).toBe('^4.19.0');
    expect(devDeps['vitest']).toBe('^2.0.0');
    expect(devDeps['chalk']).toBe('^5.3.0');
  });

  it('returns same dev deps regardless of config', () => {
    const config1 = createConfig({ llm: 'openai', checkpoint: true, mcp: true });
    const config2 = createConfig({ llm: 'mock', checkpoint: false, mcp: false });

    const devDeps1 = computeDevDependencies(config1);
    const devDeps2 = computeDevDependencies(config2);

    expect(devDeps1).toEqual(devDeps2);
  });
});
