/**
 * Memory/Skills Plugin Tests
 *
 * Tests for MemoryPlugin and SkillsPlugin using real InterceptorPlugin interface.
 * Uses mock PersistentMemory to avoid filesystem dependencies.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Observable, of, from, firstValueFrom, toArray, throwError } from 'rxjs';
import type { AgentEvent, Message } from '../../src/core/events.js';
import type { InterceptorPlugin, PluginContext } from '../../src/plugins/plugin.js';
import type { PersistentMemory, MemoryEntry, MemoryLoadResult } from '../../src/memory/index.js';
import { buildPluginPipeline } from '../../src/plugins/pipeline.js';
import { createMemoryPlugin } from '../../src/plugins/memory-plugin.js';

// ============================================================
// Mock PersistentMemory
// ============================================================

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
    async search(query: string, limit = 5): Promise<MemoryEntry[]> {
      return [];
    },
    async save(entry: MemoryEntry): Promise<boolean> { return true; },
    async update(id: string, content: string): Promise<boolean> { return true; },
    async delete(id: string): Promise<boolean> { return true; },
    formatForPrompt(entries: MemoryEntry[]): string {
      if (entries.length === 0) return '(No memory loaded)';
      return `<agent_memory>\n${entries.map(e => e.content).join('\n')}\n</agent_memory>`;
    },
  };
}

// ============================================================
// Helpers
// ============================================================

function createPluginContext(): PluginContext {
  return { sessionId: 'test-session', agentName: 'test-agent' };
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

function createAgentStepEvent(): AgentEvent {
  return {
    type: 'agent.step',
    timestamp: Date.now(),
    sessionId: 'test-session',
    step: 1,
    maxSteps: 10,
  };
}

// ============================================================
// Inline Skills Plugin (for testing without filesystem)
// ============================================================

function createTestSkillsPlugin(skills: Array<{ name: string; description: string; path: string }>): InterceptorPlugin {
  return {
    name: 'skills',
    type: 'interceptor' as const,
    priority: 5,
    eventTypes: ['llm.request'],
    enabled: true,

    intercept(event: AgentEvent, _ctx: PluginContext): Observable<AgentEvent> {
      if (event.type !== 'llm.request') return of(event);
      if (skills.length === 0) return of(event);

      const skillsList = skills
        .map(s => `- **${s.name}**: ${s.description}\n  -> Read \`${s.path}\` for full instructions`)
        .join('\n');

      const skillsMessage: Message = {
        role: 'system',
        content: `## Skills System\n\n**Available Skills:**\n\n${skillsList}`,
        name: 'skills',
      };

      return of({ ...event, messages: [skillsMessage, ...event.messages] });
    },
  };
}

// ============================================================
// Tests
// ============================================================

describe('MemoryPlugin (real implementation)', () => {
  let ctx: PluginContext;

  beforeEach(() => {
    ctx = createPluginContext();
  });

  it('should inject memory into llm.request messages', async () => {
    const mockMemory = createMockMemory('User prefers TypeScript examples.');
    const plugin = createMemoryPlugin(mockMemory, { enabled: true, sources: ['/test/AGENTS.md'] });

    const source$ = of(
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<AgentEvent, { type: 'llm.request' }>;

    expect(llmRequest).toBeDefined();
    expect(llmRequest.messages).toHaveLength(2);
    expect(llmRequest.messages[0]?.role).toBe('system');
    expect(llmRequest.messages[0]?.content).toContain('User prefers TypeScript');
    expect(llmRequest.messages[1]?.role).toBe('user');
  });

  it('should not inject memory before agent.start', async () => {
    const mockMemory = createMockMemory('User prefers TypeScript.');
    const plugin = createMemoryPlugin(mockMemory, { enabled: true, sources: ['/test/AGENTS.md'] });

    // llm.request before agent.start (memory not loaded)
    const source$ = of(createLLMRequestEvent([{ role: 'user', content: 'Hello' }]));

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<AgentEvent, { type: 'llm.request' }>;

    // Memory not loaded, should not inject
    expect(llmRequest.messages).toHaveLength(1);
    expect(llmRequest.messages[0]?.role).toBe('user');
  });

  it('should pass through non-matching events unchanged', async () => {
    const mockMemory = createMockMemory('memory content');
    const plugin = createMemoryPlugin(mockMemory, { enabled: true, sources: [] });

    const source$ = of(createAgentStepEvent());
    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('agent.step');
  });

  it('should be disabled when config.enabled is false', async () => {
    const mockMemory = createMockMemory('memory content');
    const plugin = createMemoryPlugin(mockMemory, { enabled: false, sources: [] });

    const source$ = of(
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<AgentEvent, { type: 'llm.request' }>;

    // Plugin disabled, no injection
    expect(llmRequest.messages).toHaveLength(1);
  });
});

describe('SkillsPlugin (inline mock)', () => {
  let ctx: PluginContext;

  beforeEach(() => {
    ctx = createPluginContext();
  });

  it('should inject skill metadata into llm.request', async () => {
    const plugin = createTestSkillsPlugin([
      { name: 'web-research', description: 'Structured web research', path: '/skills/web/SKILL.md' },
      { name: 'code-review', description: 'Automated code review', path: '/skills/review/SKILL.md' },
    ]);

    const source$ = of(
      createLLMRequestEvent([{ role: 'user', content: 'Research quantum computing' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<AgentEvent, { type: 'llm.request' }>;

    expect(llmRequest.messages).toHaveLength(2);
    expect(llmRequest.messages[0]?.content).toContain('web-research');
    expect(llmRequest.messages[0]?.content).toContain('code-review');
    expect(llmRequest.messages[0]?.content).toContain('/skills/web/SKILL.md');
    // Progressive disclosure: no full content
    expect(llmRequest.messages[0]?.content).not.toContain('Step 1:');
  });

  it('should not inject when no skills available', async () => {
    const plugin = createTestSkillsPlugin([]);

    const source$ = of(
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<AgentEvent, { type: 'llm.request' }>;

    expect(llmRequest.messages).toHaveLength(1); // No injection
  });
});

describe('Plugin Chain (Skills + Memory)', () => {
  let ctx: PluginContext;

  beforeEach(() => {
    ctx = createPluginContext();
  });

  it('should compose multiple plugins in priority order', async () => {
    const skillsPlugin = createTestSkillsPlugin([
      { name: 'research', description: 'Web research skill', path: '/skills/research/SKILL.md' },
    ]);
    const mockMemory = createMockMemory('User prefers concise answers.');
    const memoryPlugin = createMemoryPlugin(mockMemory, { enabled: true, sources: ['/test/AGENTS.md'] });

    const source$ = of(
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [skillsPlugin, memoryPlugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<AgentEvent, { type: 'llm.request' }>;

    // Should have 3 messages: memory + skills + user
    // Skills(p=5) first → [skills_msg, user_msg]
    // Memory(p=10) second → [memory_msg, skills_msg, user_msg]
    expect(llmRequest.messages).toHaveLength(3);

    // Memory first (priority=10, executed later, prepends first)
    expect(llmRequest.messages[0]?.name).toBe('memory');
    expect(llmRequest.messages[0]?.content).toContain('concise answers');

    // Skills second (priority=5, executed first)
    expect(llmRequest.messages[1]?.name).toBe('skills');
    expect(llmRequest.messages[1]?.content).toContain('research');

    // User last
    expect(llmRequest.messages[2]?.role).toBe('user');
  });

  it('should build pipeline with buildPluginPipeline (no custom code)', async () => {
    const skillsPlugin = createTestSkillsPlugin([
      { name: 'web', description: 'Web research', path: '/skills/web/SKILL.md' },
    ]);
    const mockMemory = createMockMemory('User context here.');
    const memoryPlugin = createMemoryPlugin(mockMemory, { enabled: true, sources: ['/test/AGENTS.md'] });

    const events: AgentEvent[] = [
      createAgentStartEvent(),
      createLLMRequestEvent([{ role: 'user', content: 'What is quantum computing?' }]),
    ];

    const source$ = from(events);
    const pipeline = buildPluginPipeline(source$, [skillsPlugin, memoryPlugin], ctx);
    const result = await firstValueFrom(pipeline.pipe(toArray()));

    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe('agent.start');

    const llmRequest = result[1] as Extract<AgentEvent, { type: 'llm.request' }>;
    expect(llmRequest.type).toBe('llm.request');
    expect(llmRequest.messages.length).toBeGreaterThan(1); // Has injections
  });

  it('should handle disabled plugin', async () => {
    const mockMemory = createMockMemory('memory');
    const plugin = createMemoryPlugin(mockMemory, { enabled: false, sources: [] });

    const source$ = of(
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [plugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    const llmRequest = events.find(e => e.type === 'llm.request') as Extract<AgentEvent, { type: 'llm.request' }>;

    expect(llmRequest.messages).toHaveLength(1); // No injection
  });

  it('should handle empty plugin list', async () => {
    const source$ = of(
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('llm.request');
  });

  it('should isolate Observable errors (degrade gracefully)', async () => {
    const brokenPlugin: InterceptorPlugin = {
      name: 'broken',
      type: 'interceptor',
      priority: 1,
      eventTypes: ['llm.request'],
      enabled: true,
      intercept() {
        return throwError(() => new Error('Plugin crashed!'));
      },
    };

    const source$ = of(
      createLLMRequestEvent([{ role: 'user', content: 'Hello' }]),
    );

    const result$ = buildPluginPipeline(source$, [brokenPlugin], ctx);
    const events = await firstValueFrom(result$.pipe(toArray()));

    // Observable error caught, original event passes through
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('llm.request');
  });
});
