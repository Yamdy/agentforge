/**
 * Tests for config-normalizer.ts
 *
 * Verifies that normalizeConfig() correctly resolves:
 * - New grouped format
 * - Legacy flat format (backward compatibility)
 * - Grouped fields taking precedence over flat equivalents
 * - Default values
 */

import { describe, it, expect } from 'vitest';
import { normalizeConfig } from '../../src/api/config-normalizer.js';
import type { AgentConfig } from '../../src/api/types.js';

// ============================================================
// Helpers
// ============================================================

function base(): AgentConfig {
  return { model: 'openai/gpt-4o' };
}

// ============================================================
// Core defaults
// ============================================================

describe('normalizeConfig — defaults', () => {
  it('fills default name when omitted', () => {
    const n = normalizeConfig(base());
    expect(n.name).toBe('agent');
  });

  it('fills default maxSteps', () => {
    const n = normalizeConfig(base());
    expect(n.maxSteps).toBe(10);
  });

  it('fills default parallelToolCalls', () => {
    const n = normalizeConfig(base());
    expect(n.parallelToolCalls).toBe(true);
  });

  it('fills default executionMode', () => {
    const n = normalizeConfig(base());
    expect(n.executionMode).toBe('react');
  });

  it('fills default retry/retryDelay/maxLLMRepairAttempts', () => {
    const n = normalizeConfig(base());
    expect(n.retry).toBe(0);
    expect(n.retryDelay).toBe(1000);
    expect(n.maxLLMRepairAttempts).toBe(3);
  });

  it('resolves model string format', () => {
    const n = normalizeConfig({ model: 'openai/gpt-4o' });
    expect(n.model).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('resolves model object format', () => {
    const n = normalizeConfig({ model: { provider: 'anthropic', model: 'claude-3' } });
    expect(n.model).toEqual({ provider: 'anthropic', model: 'claude-3' });
  });

  it('defaults model to openai/gpt-4o when omitted', () => {
    // model is required per TS, but handle missing fields in object
    const n = normalizeConfig({ model: {} as unknown as AgentConfig['model'] });
    expect(n.model.provider).toBe('openai');
    expect(n.model.model).toBe('gpt-4o');
  });
});

// ============================================================
// New grouped format
// ============================================================

describe('normalizeConfig — grouped format', () => {
  it('reads execution from grouped object', () => {
    const n = normalizeConfig({
      ...base(),
      execution: { parallelToolCalls: false, streaming: true, executionMode: 'plan-then-execute' },
    });
    expect(n.parallelToolCalls).toBe(false);
    expect(n.streaming).toBe(true);
    expect(n.executionMode).toBe('plan-then-execute');
  });

  it('reads controls from grouped object', () => {
    const n = normalizeConfig({
      ...base(),
      controls: { timeout: 30000, tokenBudget: 100000, retry: 3, retryDelay: 2000, maxLLMRepairAttempts: 5 },
    });
    expect(n.timeout).toBe(30000);
    expect(n.tokenBudget).toBe(100000);
    expect(n.retry).toBe(3);
    expect(n.retryDelay).toBe(2000);
    expect(n.maxLLMRepairAttempts).toBe(5);
  });

  it('reads observability from grouped object', () => {
    const n = normalizeConfig({
      ...base(),
      observability: { tracing: { exporter: 'console' }, metrics: true, preset: 'production' },
    });
    expect(n.tracing).toEqual({ exporter: 'console' });
    expect(n.metrics).toBe(true);
    expect(n.preset).toBe('production');
  });

  it('reads extensions from grouped object', () => {
    const n = normalizeConfig({
      ...base(),
      extensions: {
        memory: { enabled: true, sources: ['./AGENTS.md'] },
        subagents: [{ name: 'sub1' }],
        mcp: [{ name: 'mcp1', type: 'http', url: 'http://localhost' }],
      },
    });
    expect(n.memory).toEqual({ enabled: true, sources: ['./AGENTS.md'] });
    expect(n.subagents).toEqual([{ name: 'sub1' }]);
    expect(n.mcp).toEqual([{ name: 'mcp1', type: 'http', url: 'http://localhost' }]);
  });

  it('reads plugins from grouped object', () => {
    const plugin = { name: 'test', enabled: true };
    const n = normalizeConfig({
      ...base(),
      pluginsConfig: { plugins: [plugin], pluginSpecs: [{ source: 'test-plugin' }] },
    });
    expect(n.plugins).toEqual([plugin]);
    expect(n.pluginSpecs).toEqual([{ source: 'test-plugin' }]);
  });
});

// ============================================================
// Legacy flat format (backward compatibility)
// ============================================================

describe('normalizeConfig — legacy flat format', () => {
  it('reads legacy parallelToolCalls', () => {
    const n = normalizeConfig({ ...base(), parallelToolCalls: false });
    expect(n.parallelToolCalls).toBe(false);
  });

  it('reads legacy streaming', () => {
    const n = normalizeConfig({ ...base(), streaming: true });
    expect(n.streaming).toBe(true);
  });

  it('reads legacy executionMode', () => {
    const n = normalizeConfig({ ...base(), executionMode: 'plan-then-execute-strict' });
    expect(n.executionMode).toBe('plan-then-execute-strict');
  });

  it('reads legacy timeout and tokenBudget', () => {
    const n = normalizeConfig({ ...base(), timeout: 5000, tokenBudget: 50000 });
    expect(n.timeout).toBe(5000);
    expect(n.tokenBudget).toBe(50000);
  });

  it('reads legacy retry/retryDelay/maxLLMRepairAttempts', () => {
    const n = normalizeConfig({ ...base(), retry: 2, retryDelay: 500, maxLLMRepairAttempts: 1 });
    expect(n.retry).toBe(2);
    expect(n.retryDelay).toBe(500);
    expect(n.maxLLMRepairAttempts).toBe(1);
  });

  it('reads legacy tracing and metrics', () => {
    const n = normalizeConfig({ ...base(), tracing: true, metrics: { prefix: 'test' } });
    expect(n.tracing).toBe(true);
    expect(n.metrics).toEqual({ prefix: 'test' });
  });

  it('reads legacy hitl', () => {
    const n = normalizeConfig({ ...base(), hitl: { autoAllow: ['fs'] } });
    expect(n.hitl).toEqual({ autoAllow: ['fs'] });
  });

  it('reads legacy preset', () => {
    const n = normalizeConfig({ ...base(), preset: 'production' });
    expect(n.preset).toBe('production');
  });

  it('reads legacy memory and skills', () => {
    const n = normalizeConfig({
      ...base(),
      memory: { enabled: true, sources: ['./MEMORY.md'] },
      skills: { sources: ['./skills'] },
    });
    expect(n.memory).toEqual({ enabled: true, sources: ['./MEMORY.md'] });
    expect(n.skills).toEqual({ sources: ['./skills'] });
  });

  it('reads legacy compaction', () => {
    const n = normalizeConfig({ ...base(), compaction: { strategy: 'truncate-oldest' } });
    expect(n.compaction).toEqual({ strategy: 'truncate-oldest' });
  });

  it('reads legacy subagents and mcp', () => {
    const n = normalizeConfig({
      ...base(),
      subagents: [{ name: 'legacy-sub' }],
      mcp: [{ name: 'legacy-mcp', type: 'stdio', command: 'node' }],
    });
    expect(n.subagents).toEqual([{ name: 'legacy-sub' }]);
    expect(n.mcp).toEqual([{ name: 'legacy-mcp', type: 'stdio', command: 'node' }]);
  });

  it('reads legacy plugins and pluginSpecs', () => {
    const p = { name: 'legacy-plugin', enabled: true };
    const n = normalizeConfig({
      ...base(),
      plugins: [p],
      pluginSpecs: [{ source: 'legacy-spec' }],
    });
    expect(n.plugins).toEqual([p]);
    expect(n.pluginSpecs).toEqual([{ source: 'legacy-spec' }]);
  });
});

// ============================================================
// Grouped takes precedence over flat
// ============================================================

describe('normalizeConfig — grouped overrides flat', () => {
  it('execution group overrides flat parallelToolCalls', () => {
    const n = normalizeConfig({
      ...base(),
      parallelToolCalls: true,
      execution: { parallelToolCalls: false },
    });
    expect(n.parallelToolCalls).toBe(false);
  });

  it('execution group overrides flat streaming', () => {
    const n = normalizeConfig({
      ...base(),
      streaming: false,
      execution: { streaming: true },
    });
    expect(n.streaming).toBe(true);
  });

  it('controls group overrides flat timeout', () => {
    const n = normalizeConfig({
      ...base(),
      timeout: 1000,
      controls: { timeout: 9999 },
    });
    expect(n.timeout).toBe(9999);
  });

  it('observability group overrides flat tracing', () => {
    const n = normalizeConfig({
      ...base(),
      tracing: true,
      observability: { tracing: { exporter: 'none' } },
    });
    expect(n.tracing).toEqual({ exporter: 'none' });
  });

  it('observability group overrides flat preset', () => {
    const n = normalizeConfig({
      ...base(),
      preset: 'debug',
      observability: { preset: 'production' },
    });
    expect(n.preset).toBe('production');
  });

  it('extensions group overrides flat memory', () => {
    const n = normalizeConfig({
      ...base(),
      memory: { enabled: false, sources: [] },
      extensions: { memory: { enabled: true, sources: ['./AGENTS.md'] } },
    });
    expect(n.memory).toEqual({ enabled: true, sources: ['./AGENTS.md'] });
  });

  it('pluginsConfig group overrides flat plugins', () => {
    const pNew = { name: 'new', enabled: true };
    const pOld = { name: 'old', enabled: false };
    const n = normalizeConfig({
      ...base(),
      plugins: [pOld],
      pluginsConfig: { plugins: [pNew] },
    });
    expect(n.plugins).toEqual([pNew]);
  });
});

// ============================================================
// Tool specs
// ============================================================

describe('normalizeConfig — tools', () => {
  it('defaults to empty array', () => {
    const n = normalizeConfig(base());
    expect(n.toolSpecs).toEqual([]);
  });

  it('preserves string tool names', () => {
    const n = normalizeConfig({ ...base(), tools: ['fs', 'bash'] });
    expect(n.toolSpecs).toEqual(['fs', 'bash']);
  });

  it('preserves ToolDefinition objects', () => {
    const tool = { name: 'custom', description: 'desc', parameters: { type: 'object', properties: {} } };
    const n = normalizeConfig({ ...base(), tools: [tool] });
    expect(n.toolSpecs).toEqual([tool]);
  });

  it('preserves mixed string and ToolDefinition', () => {
    const tool = { name: 'custom', description: 'desc', parameters: { type: 'object', properties: {} } };
    const n = normalizeConfig({ ...base(), tools: ['fs', tool] });
    expect(n.toolSpecs).toEqual(['fs', tool]);
  });
});

// ============================================================
// Edge cases
// ============================================================

describe('normalizeConfig — edge cases', () => {
  it('handles empty config gracefully', () => {
    const n = normalizeConfig({ model: 'openai/gpt-4o' });
    expect(n.name).toBe('agent');
    expect(n.toolSpecs).toEqual([]);
  });

  it('preserves custom name', () => {
    const n = normalizeConfig({ ...base(), name: 'my-agent' });
    expect(n.name).toBe('my-agent');
  });

  it('passes through systemPrompt and history', () => {
    const history = [{ role: 'user' as const, content: 'hello' }];
    const n = normalizeConfig({ ...base(), systemPrompt: 'be helpful', history });
    expect(n.systemPrompt).toBe('be helpful');
    expect(n.history).toEqual(history);
  });

  it('passes through llmOptions', () => {
    const n = normalizeConfig({ ...base(), llmOptions: { temperature: 0.5 } });
    expect(n.llmOptions).toEqual({ temperature: 0.5 });
  });

  it('handles summarization config', () => {
    const n = normalizeConfig({
      ...base(),
      summarization: { tokenThreshold: 1000, preserveRecent: 5, offloadDir: '/tmp' },
    });
    expect(n.summarization).toEqual({ tokenThreshold: 1000, preserveRecent: 5, offloadDir: '/tmp' });
  });
});
