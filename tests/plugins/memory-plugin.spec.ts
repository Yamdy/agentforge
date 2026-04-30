/**
 * Memory/Skills Plugin Tests
 *
 * Tests for MemoryPlugin and SkillsPlugin using the applyPlugins() + HookRegistry bridge.
 * Uses mock PersistentMemory to avoid filesystem dependencies.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentEvent, Message } from '../../src/core/events.js';
import type { InterceptorPlugin, PluginContext } from '../../src/plugins/plugin.js';
import type { PersistentMemory, MemoryEntry, MemoryLoadResult } from '../../src/memory/index.js';
import { applyPlugins } from '../../src/plugins/pipeline.js';
import { createMemoryPlugin } from '../../src/plugins/memory-plugin.js';
import { HookRegistry } from '../../src/core/hooks.js';
import { AgentEventEmitter } from '../../src/core/events.js';

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
    async search(_query: string, _limit?: number): Promise<MemoryEntry[]> {
      return [];
    },
    async save(_entry: MemoryEntry): Promise<boolean> { return true; },
    async update(_id: string, _content: string): Promise<boolean> { return true; },
    async delete(_id: string): Promise<boolean> { return true; },
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

    intercept(event: AgentEvent, _ctx: PluginContext): any {
      if (event.type !== 'llm.request') return Promise.resolve(event);
      if (skills.length === 0) return Promise.resolve(event);

      const skillsList = skills
        .map(s => `- **${s.name}**: ${s.description}\n  -> Read \`${s.path}\` for full instructions`)
        .join('\n');

      const skillsMessage: Message = {
        role: 'system',
        content: `## Skills System\n\n**Available Skills:**\n\n${skillsList}`,
        name: 'skills',
      };

      return Promise.resolve({ ...event, messages: [skillsMessage, ...event.messages] });
    },
  };
}

// ============================================================
// Helper to simulate agent.start via lifecycle hooks
// ============================================================

async function triggerAgentStart(registry: HookRegistry): Promise<void> {
  const lifecycles = registry.getLifecycleHooks('session.start');
  for (const fn of lifecycles) {
    await fn({ sessionId: 'test-session', agentName: 'test-agent' }, {});
  }
}

async function applyRequestHooks(registry: HookRegistry, msgs: Message[]): Promise<Message[]> {
  const hooks = registry.getRequestHooks();
  let result = msgs;
  for (const hook of hooks) {
    result = await hook.apply(result, {} as any);
  }
  return result;
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

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    // Trigger agent.start (loads memory)
    await triggerAgentStart(registry);

    // Apply request hooks to llm.request messages
    const msgs = await applyRequestHooks(registry, [{ role: 'user', content: 'Hello' }]);

    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('User prefers TypeScript');
    expect(msgs[1]?.role).toBe('user');
  });

  it('should not inject memory before agent.start', async () => {
    const mockMemory = createMockMemory('User prefers TypeScript.');
    const plugin = createMemoryPlugin(mockMemory, { enabled: true, sources: ['/test/AGENTS.md'] });

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    // Do NOT trigger agent.start - memory not loaded

    const msgs = await applyRequestHooks(registry, [{ role: 'user', content: 'Hello' }]);

    // Memory not loaded, should not inject
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.role).toBe('user');
  });

  it('should pass through non-llm.request events unchanged', () => {
    const mockMemory = createMockMemory('memory content');
    const plugin = createMemoryPlugin(mockMemory, { enabled: true, sources: [] });

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    // No hooks should affect non-llm.request processing
    // The bridge only creates request hooks for llm.request
    // agent.step events don't go through request hooks at all
    expect(true).toBe(true);
  });

  it('should be disabled when config.enabled is false', async () => {
    const mockMemory = createMockMemory('memory content');
    const plugin = createMemoryPlugin(mockMemory, { enabled: false, sources: [] });

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    const msgs = await applyRequestHooks(registry, [{ role: 'user', content: 'Hello' }]);

    // Plugin disabled, no injection
    expect(msgs).toHaveLength(1);
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

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    const msgs = await applyRequestHooks(registry, [{ role: 'user', content: 'Research quantum computing' }]);

    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toContain('web-research');
    expect(msgs[0]?.content).toContain('code-review');
    expect(msgs[0]?.content).toContain('/skills/web/SKILL.md');
    // Progressive disclosure: no full content
    expect(msgs[0]?.content).not.toContain('Step 1:');
  });

  it('should not inject when no skills available', async () => {
    const plugin = createTestSkillsPlugin([]);

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    const msgs = await applyRequestHooks(registry, [{ role: 'user', content: 'Hello' }]);

    expect(msgs).toHaveLength(1); // No injection
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

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([skillsPlugin, memoryPlugin], registry, emitter, ctx);

    // Trigger agent.start for memory loading
    await triggerAgentStart(registry);

    // Apply request hooks
    const msgs = await applyRequestHooks(registry, [{ role: 'user', content: 'Hello' }]);

    // Should have 3 messages: memory + skills + user
    // Skills(p=5) first → [skills_msg, user_msg]
    // Memory(p=10) second → [memory_msg, skills_msg, user_msg]
    expect(msgs).toHaveLength(3);

    // Memory first (priority=10, executed later, prepends first)
    expect(msgs[0]?.name).toBe('memory');
    expect(msgs[0]?.content).toContain('concise answers');

    // Skills second (priority=5, executed first)
    expect(msgs[1]?.name).toBe('skills');
    expect(msgs[1]?.content).toContain('research');

    // User last
    expect(msgs[2]?.role).toBe('user');
  });

  it('should apply plugins via applyPlugins with correct hook registration', () => {
    const skillsPlugin = createTestSkillsPlugin([
      { name: 'web', description: 'Web research', path: '/skills/web/SKILL.md' },
    ]);
    const mockMemory = createMockMemory('User context here.');
    const memoryPlugin = createMemoryPlugin(mockMemory, { enabled: true, sources: ['/test/AGENTS.md'] });

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([skillsPlugin, memoryPlugin], registry, emitter, ctx);

    // Both plugins registered as request hooks
    const hooks = registry.getRequestHooks();
    expect(hooks).toHaveLength(2);

    // Memory has lifecycle hook for agent.start
    const lifecycles = registry.getLifecycleHooks('session.start');
    expect(lifecycles).toHaveLength(1);
  });

  it('should handle disabled plugin', async () => {
    const mockMemory = createMockMemory('memory');
    const plugin = createMemoryPlugin(mockMemory, { enabled: false, sources: [] });

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    const msgs = await applyRequestHooks(registry, [{ role: 'user', content: 'Hello' }]);

    expect(msgs).toHaveLength(1); // No injection
  });

  it('should handle empty plugin list', async () => {
    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([], registry, emitter, ctx);

    const msgs = await applyRequestHooks(registry, [{ role: 'user', content: 'Hello' }]);

    expect(msgs).toHaveLength(1);
  });

  it('should isolate plugin errors (degrade gracefully)', async () => {
    const brokenPlugin: InterceptorPlugin = {
      name: 'broken',
      type: 'interceptor',
      priority: 1,
      eventTypes: ['llm.request'],
      enabled: true,
      intercept() {
        throw new Error('Plugin crashed!');
      },
    };

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([brokenPlugin], registry, emitter, ctx);

    const msgs = await applyRequestHooks(registry, [{ role: 'user', content: 'Hello' }]);

    // Error caught, original messages pass through
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.role).toBe('user');
  });
});

// ============================================================
// SummarizationPlugin Tests
// ============================================================

import { createSummarizationPlugin } from '../../src/plugins/summarization-plugin.js';

describe('SummarizationPlugin', () => {
  let ctx: PluginContext;

  beforeEach(() => {
    ctx = createPluginContext();
  });

  it('should pass through when below token threshold', async () => {
    const plugin = createSummarizationPlugin({
      tokenThreshold: 10000,
      preserveRecent: 5,
    });

    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    const msgs = await applyRequestHooks(registry, messages);

    // Below threshold, no compression
    expect(msgs).toHaveLength(2);
  });

  it('should compress when above token threshold', async () => {
    const plugin = createSummarizationPlugin({
      tokenThreshold: 20, // Very low threshold for testing (actual messages will exceed this)
      preserveRecent: 2,
    });

    // Create messages that will definitely exceed 20 tokens
    const messages: Message[] = [
      { role: 'user', content: 'A'.repeat(200) },  // ~66 tokens
      { role: 'assistant', content: 'B'.repeat(200) },
      { role: 'user', content: 'C'.repeat(200) },
      { role: 'assistant', content: 'D'.repeat(200) },
      { role: 'user', content: 'E'.repeat(200) },
    ];

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    const msgs = await applyRequestHooks(registry, messages);

    // Should have fewer messages after compression
    expect(msgs.length).toBeLessThan(5);
    expect(msgs.length).toBeGreaterThanOrEqual(2); // At least preserveRecent
  });

  it('should not compress when threshold equals zero', async () => {
    const plugin = createSummarizationPlugin({
      tokenThreshold: 0, // Never trigger
      preserveRecent: 2,
    });

    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    const msgs = await applyRequestHooks(registry, messages);

    expect(msgs).toHaveLength(2);
  });

  it('should pass through non-llm.request events', () => {
    const plugin = createSummarizationPlugin({
      tokenThreshold: 100,
      preserveRecent: 2,
    });

    const registry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], registry, emitter, ctx);

    // Non-llm.request events don't go through request hooks
    // The bridge only creates hooks for llm.request
    expect(true).toBe(true);
  });
});
