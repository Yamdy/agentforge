/**
 * AGENTS.md Auto-Discovery Tests
 *
 * Tests for loadAgentsMd function and MemoryPlugin autoDiscover integration.
 * Uses temp directories with real filesystem for integration testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Observable, of, firstValueFrom, toArray } from 'rxjs';

import { loadAgentsMd, type AgentsMdConfig, type AgentsMdResult } from '../../src/memory/agents-md.js';
import { createMemoryPlugin } from '../../src/plugins/memory-plugin.js';
import { buildPluginPipeline } from '../../src/plugins/pipeline.js';
import type { AgentEvent, Message } from '../../src/core/events.js';
import type { PluginContext } from '../../src/plugins/plugin.js';
import type { PersistentMemory, MemoryEntry, MemoryLoadResult } from '../../src/memory/index.js';

// ============================================================
// Helpers
// ============================================================

function createPluginContext(): PluginContext {
  return { sessionId: 'test-session', agentName: 'test-agent' };
}

function createAgentStartEvent(): AgentEvent {
  return {
    type: 'agent.start',
    timestamp: Date.now(),
    sessionId: 'test-session',
    input: 'Hello',
    agentName: 'test-agent',
    model: { provider: 'openai', model: 'gpt-4o' },
  };
}

function createLLMRequestEvent(messages: Message[]): AgentEvent {
  return {
    type: 'llm.request',
    timestamp: Date.now(),
    sessionId: 'test-session',
    messages,
    model: { provider: 'openai', model: 'gpt-4o' },
  };
}

function createMockMemory(content: string): PersistentMemory {
  return {
    async load(sources: string[]): Promise<MemoryLoadResult> {
      return {
        success: true,
        entries: sources.map(s => ({
          id: `mock-${s}`,
          content,
          sourcePath: s,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
      };
    },
    async search(_query: string, _limit?: number): Promise<MemoryEntry[]> {
      return [];
    },
    async save(_entry: MemoryEntry): Promise<boolean> {
      return true;
    },
    async update(_id: string, _content: string): Promise<boolean> {
      return true;
    },
    async delete(_id: string): Promise<boolean> {
      return true;
    },
    formatForPrompt(entries: MemoryEntry[]): string {
      if (entries.length === 0) return '(No memory loaded)';
      return `<agent_memory>\n${entries.map(e => e.content).join('\n')}\n</agent_memory>`;
    },
  };
}

// ============================================================
// loadAgentsMd Tests
// ============================================================

describe('loadAgentsMd', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agents-md-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should discover AGENTS.md in cwd', async () => {
    const content = '# Project Guidelines\n\nUse TypeScript strict mode.';
    await writeFile(join(tempDir, 'AGENTS.md'), content);

    const result = await loadAgentsMd({ cwd: tempDir });

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toBe(join(tempDir, 'AGENTS.md'));
    expect(result.content).toBe(content);
    expect(result.estimatedTokens).toBe(Math.ceil(content.length / 4));
  });

  it('should walk up directories and collect AGENTS.md files', async () => {
    // Structure: tempDir/sub/deep
    const subDir = join(tempDir, 'sub');
    const deepDir = join(subDir, 'deep');
    await mkdir(deepDir, { recursive: true });

    // Root AGENTS.md
    await writeFile(join(tempDir, 'AGENTS.md'), '# Root Guidelines\n\nRoot content.');
    // Sub AGENTS.md
    await writeFile(join(subDir, 'AGENTS.md'), '# Sub Guidelines\n\nSub content.');
    // Deep AGENTS.md (cwd)
    await writeFile(join(deepDir, 'AGENTS.md'), '# Deep Guidelines\n\nDeep content.');

    const result = await loadAgentsMd({ cwd: deepDir });

    // Should find 3 files
    expect(result.paths).toHaveLength(3);

    // Root first, cwd last (reversed from walk-up order)
    expect(result.paths[0]).toBe(join(tempDir, 'AGENTS.md'));
    expect(result.paths[1]).toBe(join(subDir, 'AGENTS.md'));
    expect(result.paths[2]).toBe(join(deepDir, 'AGENTS.md'));

    // Content should be in root-first order
    expect(result.content).toContain('Root Guidelines');
    expect(result.content).toContain('Sub Guidelines');
    expect(result.content).toContain('Deep Guidelines');
  });

  it('should reverse order so root comes first, cwd last', async () => {
    const parentDir = join(tempDir, 'parent');
    const childDir = join(parentDir, 'child');
    await mkdir(childDir, { recursive: true });

    await writeFile(join(tempDir, 'AGENTS.md'), 'Root');
    await writeFile(join(parentDir, 'AGENTS.md'), 'Parent');
    await writeFile(join(childDir, 'AGENTS.md'), 'Child');

    const result = await loadAgentsMd({ cwd: childDir });

    // Root first, then parent, then child (cwd last)
    expect(result.paths[0]).toBe(join(tempDir, 'AGENTS.md'));
    expect(result.paths[1]).toBe(join(parentDir, 'AGENTS.md'));
    expect(result.paths[2]).toBe(join(childDir, 'AGENTS.md'));
  });

  it('should respect maxDepth', async () => {
    // Create a deep directory structure
    let currentDir = tempDir;
    for (let i = 0; i < 5; i++) {
      currentDir = join(currentDir, `level${i}`);
      await mkdir(currentDir);
      await writeFile(join(currentDir, 'AGENTS.md'), `Level ${i} content`);
    }

    // Walk from deepest, but limit depth to 2
    const result = await loadAgentsMd({ cwd: currentDir, maxDepth: 2 });

    // Should only find files within 2 levels up
    expect(result.paths.length).toBeLessThanOrEqual(3); // cwd + 2 levels up
  });

  it('should respect maxSize and skip oversized files', async () => {
    const smallContent = '# Small\n\nSmall content.';
    const largeContent = 'x'.repeat(200); // 200 bytes

    await writeFile(join(tempDir, 'AGENTS.md'), largeContent);

    const subDir = join(tempDir, 'sub');
    await mkdir(subDir);
    await writeFile(join(subDir, 'AGENTS.md'), smallContent);

    // maxSize = 100 bytes, large file should be skipped
    const result = await loadAgentsMd({ cwd: subDir, maxSize: 100 });

    // Only the small file in subDir should be included
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toBe(join(subDir, 'AGENTS.md'));
    expect(result.content).toBe(smallContent);
  });

  it('should handle missing files gracefully', async () => {
    // No AGENTS.md files anywhere
    const result = await loadAgentsMd({ cwd: tempDir });

    expect(result.paths).toHaveLength(0);
    expect(result.content).toBe('');
    expect(result.estimatedTokens).toBe(0);
  });

  it('should use default config values', async () => {
    const content = '# Default Config\n\nTest content.';
    await writeFile(join(tempDir, 'AGENTS.md'), content);

    // No config provided - should use defaults
    const result = await loadAgentsMd({ cwd: tempDir });

    expect(result.paths).toHaveLength(1);
    expect(result.content).toBe(content);
  });

  it('should use custom filename', async () => {
    const content = '# Custom\n\nCustom file content.';
    await writeFile(join(tempDir, 'CONTEXT.md'), content);

    const result = await loadAgentsMd({ cwd: tempDir, filename: 'CONTEXT.md' });

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toBe(join(tempDir, 'CONTEXT.md'));
    expect(result.content).toBe(content);
  });

  it('should merge content with separator', async () => {
    const parentDir = join(tempDir, 'parent');
    const childDir = join(parentDir, 'child');
    await mkdir(childDir, { recursive: true });

    await writeFile(join(tempDir, 'AGENTS.md'), 'Root content');
    await writeFile(join(childDir, 'AGENTS.md'), 'Child content');

    const result = await loadAgentsMd({ cwd: childDir });

    expect(result.content).toContain('Root content');
    expect(result.content).toContain('Child content');
    expect(result.content).toContain('---'); // separator
  });

  it('should estimate tokens correctly', async () => {
    const content = 'a'.repeat(100); // 100 chars
    await writeFile(join(tempDir, 'AGENTS.md'), content);

    const result = await loadAgentsMd({ cwd: tempDir });

    expect(result.estimatedTokens).toBe(Math.ceil(content.length / 4));
  });
});

// ============================================================
// MemoryPlugin with autoDiscover Tests
// ============================================================

describe('MemoryPlugin with autoDiscover', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agents-md-plugin-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should auto-discover AGENTS.md on agent.start', async () => {
    const content = '# Auto-discovered\n\nUse strict TypeScript.';
    await writeFile(join(tempDir, 'AGENTS.md'), content);

    const mockMemory = createMockMemory('should not be used');
    const plugin = createMemoryPlugin(mockMemory, {
      enabled: true,
      sources: [],
      autoDiscover: true,
      cwd: tempDir,
    });

    const ctx = createPluginContext();
    const source$ = of(
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<
      AgentEvent,
      { type: 'llm.request' }
    >;

    expect(llmRequest).toBeDefined();
    // Should have memory message + user message
    expect(llmRequest.messages.length).toBeGreaterThanOrEqual(2);
    // First message should be system memory
    expect(llmRequest.messages[0]?.role).toBe('system');
    expect(llmRequest.messages[0]?.content).toContain('Auto-discovered');
  });

  it('should inject auto-discovered content on llm.request', async () => {
    const content = '# Project Context\n\nAlways use async/await.';
    await writeFile(join(tempDir, 'AGENTS.md'), content);

    const mockMemory = createMockMemory('fallback');
    const plugin = createMemoryPlugin(mockMemory, {
      enabled: true,
      sources: [],
      autoDiscover: true,
      cwd: tempDir,
    });

    const ctx = createPluginContext();
    const source$ = of(
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'What is async?' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<
      AgentEvent,
      { type: 'llm.request' }
    >;

    // Memory message should contain auto-discovered content
    const memoryMessage = llmRequest.messages.find(
      m => m.role === 'system' && m.name === 'memory',
    );
    expect(memoryMessage).toBeDefined();
    expect(memoryMessage!.content).toContain('Project Context');
  });

  it('should use existing logic when autoDiscover is false', async () => {
    const mockMemory = createMockMemory('Existing memory content.');
    const plugin = createMemoryPlugin(mockMemory, {
      enabled: true,
      sources: ['/test/AGENTS.md'],
      autoDiscover: false,
    });

    const ctx = createPluginContext();
    const source$ = of(
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<
      AgentEvent,
      { type: 'llm.request' }
    >;

    // Should use existing memory.load() logic
    expect(llmRequest.messages.length).toBeGreaterThanOrEqual(2);
    expect(llmRequest.messages[0]?.content).toContain('Existing memory content');
  });

  it('should use existing logic when autoDiscover is not specified (backward compat)', async () => {
    const mockMemory = createMockMemory('Backward compat memory.');
    // No autoDiscover field - should default to false
    const plugin = createMemoryPlugin(mockMemory, {
      enabled: true,
      sources: ['/test/AGENTS.md'],
    });

    const ctx = createPluginContext();
    const source$ = of(
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<
      AgentEvent,
      { type: 'llm.request' }
    >;

    // Should use existing memory.load() logic
    expect(llmRequest.messages.length).toBeGreaterThanOrEqual(2);
    expect(llmRequest.messages[0]?.content).toContain('Backward compat memory');
  });

  it('should handle missing AGENTS.md gracefully with autoDiscover', async () => {
    // No AGENTS.md file in tempDir
    const mockMemory = createMockMemory('should not be used');
    const plugin = createMemoryPlugin(mockMemory, {
      enabled: true,
      sources: [],
      autoDiscover: true,
      cwd: tempDir,
    });

    const ctx = createPluginContext();
    const source$ = of(
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    // Should not crash, just no memory injection
    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<
      AgentEvent,
      { type: 'llm.request' }
    >;

    expect(llmRequest).toBeDefined();
    // Only user message, no memory injection
    expect(llmRequest.messages).toHaveLength(1);
    expect(llmRequest.messages[0]?.role).toBe('user');
  });

  it('should only load once on agent.start (not on subsequent events)', async () => {
    const content = '# Load Once\n\nShould only load once.';
    await writeFile(join(tempDir, 'AGENTS.md'), content);

    const mockMemory = createMockMemory('fallback');
    const plugin = createMemoryPlugin(mockMemory, {
      enabled: true,
      sources: [],
      autoDiscover: true,
      cwd: tempDir,
    });

    const ctx = createPluginContext();
    // Two agent.start events
    const source$ = of(
      createAgentStartEvent(),
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<
      AgentEvent,
      { type: 'llm.request' }
    >;

    // Should still have memory injection (loaded once)
    expect(llmRequest.messages.length).toBeGreaterThanOrEqual(2);
    expect(llmRequest.messages[0]?.content).toContain('Load Once');
  });
});
