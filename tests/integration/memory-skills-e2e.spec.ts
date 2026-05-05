/**
 * Integration Test — Memory/Skills/Summarization Plugin Wiring
 *
 * Verifies that createAgent() correctly creates and wires
 * MemoryPlugin, SkillsPlugin, and SummarizationPlugin into
 * the HookRegistry via the plugin pipeline.
 *
 * Uses real FileBasedMemory, SkillRegistry, and HookRegistry.
 * Only LLM adapter and agent loop are mocked.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fs as memfsModule, vol } from 'memfs';

// ============================================================
// Mocks — replace real filesystem with memfs (in-memory)
// Must be at TOP — before any imports that trigger real fs I/O
// ============================================================

vi.mock('node:fs/promises', () => memfsModule.promises);
vi.mock('node:fs', () => memfsModule);
vi.mock('fs/promises', () => memfsModule.promises);
vi.mock('fs', () => memfsModule);

// ============================================================
// Mocks — isolate config wiring from external dependencies
// ============================================================

vi.mock('../../src/adapters/index.js', () => ({
  createLLMAdapter: () => ({
    name: 'mock',
    provider: 'mock',
    chat: async () => ({ content: 'ok', finishReason: 'stop' }),
    stream: async function* () { yield { type: 'text', delta: 'ok' }; },
  }),
  parseModelSpec: (spec: string) => {
    const parts = spec.split('/');
    return { provider: parts[0] ?? 'openai', model: parts[1] ?? spec };
  },
}));

vi.mock('../../src/loop/agent-loop.js', () => ({
  createAgentLoop: () => ({
    run: async () => ({ output: 'ok', status: 'success' as const }),
    iterate: async function* () {
      yield { type: 'agent.start' } as any;
      return { output: 'ok', status: 'success' as const };
    },
    on: () => () => {},
    onAny: () => () => {},
    emit: async () => {},
    emitter: {
      on: () => () => {},
      onAny: () => () => {},
      emit: async () => {},
      clear: () => {},
    },
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    getState: () => null,
    getStatus: () => 'pending',
    onStateChange: () => () => {},
    destroy: () => {},
  }),
}));

import { createAgent } from '../../src/api/create-agent.js';
import { HookRegistry } from '../../src/core/hooks.js';

// ============================================================
// Test Setup
// ============================================================

const TEST_DIR = '/test/memory-skills-e2e';
const AGENTS_MD = `${TEST_DIR}/AGENTS.md`;
const SKILL_DIR = `${TEST_DIR}/skills/test-skill`;
const SKILL_MD = `${SKILL_DIR}/SKILL.md`;

describe('createAgent() — Memory/Skills/Summarization plugin wiring', () => {
  beforeAll(() => {
    vol.fromJSON(
      {
        './AGENTS.md': '# Test Memory\nUser prefers TypeScript.\n',
        './skills/test-skill/SKILL.md': `---
name: test-skill
description: A test skill for verification
---

# Test Skill
`,
      },
      TEST_DIR,
    );
  });

  afterAll(() => {
    vol.reset();
  });

  // ==========================================================
  // Baseline — no plugins
  // ==========================================================

  it('should create agent with no auto-plugins when memory/skills are absent', () => {
    const agent = createAgent({
      name: 'bare-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
    });

    expect(agent.ctx.sessionId).toBeDefined();
    expect(agent.ctx.agentName).toBe('bare-agent');
    expect(agent.getStatus()).toBe('pending');

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    expect(hooks).toBeInstanceOf(HookRegistry);
    // No auto-plugins, no planner → 0 request hooks
    expect(hooks.getRequestHooks()).toHaveLength(0);
  });

  // ==========================================================
  // Memory Plugin
  // ==========================================================

  it('should wire MemoryPlugin into HookRegistry as a request hook', () => {
    const agent = createAgent({
      name: 'memory-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      memory: {
        enabled: true,
        sources: [AGENTS_MD],
      },
    });

    expect(agent.ctx.agentName).toBe('memory-agent');
    expect(agent.getStatus()).toBe('pending');

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();
    const memoryHook = requestHooks.find(h => h.name === 'memory-context');
    expect(memoryHook).toBeDefined();
    expect(memoryHook!.priority).toBe(20);
  });

  it('should register memory request hook with correct priority', () => {
    const agent = createAgent({
      name: 'memory-lifecycle',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      memory: {
        enabled: true,
        sources: [AGENTS_MD],
      },
    });

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();
    const memoryHook = requestHooks.find(h => h.name === 'memory-context');
    expect(memoryHook).toBeDefined();
    expect(memoryHook!.priority).toBe(20); // MEMORY_CONTEXT
  });

  // ==========================================================
  // Skills Plugin
  // ==========================================================

  it('should wire SkillsPlugin into HookRegistry as a request hook', () => {
    const agent = createAgent({
      name: 'skills-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      skills: {
        sources: [`${TEST_DIR}/skills`],
      },
    });

    expect(agent.ctx.agentName).toBe('skills-agent');

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();
    const skillsHook = requestHooks.find(h => h.name === 'skills-context');
    expect(skillsHook).toBeDefined();
    expect(skillsHook!.priority).toBe(30);
  });

  it('should register skills request hook with correct priority', () => {
    const agent = createAgent({
      name: 'skills-lifecycle',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      skills: {
        sources: [`${TEST_DIR}/skills`],
      },
    });

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();
    const skillsHook = requestHooks.find(h => h.name === 'skills-context');
    expect(skillsHook).toBeDefined();
    expect(skillsHook!.priority).toBe(30); // SKILL_INSTRUCTIONS
  });

  // ==========================================================
  // Memory + Skills combined
  // ==========================================================

  it('should wire both memory and skills hooks with correct priority ordering', () => {
    const agent = createAgent({
      name: 'combined-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      memory: {
        enabled: true,
        sources: [AGENTS_MD],
      },
      skills: {
        sources: [`${TEST_DIR}/skills`],
      },
    });

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();

    expect(requestHooks.length).toBeGreaterThanOrEqual(2);

    const skillsHook = requestHooks.find(h => h.name === 'skills-context');
    const memoryHook = requestHooks.find(h => h.name === 'memory-context');

    expect(skillsHook).toBeDefined();
    expect(memoryHook).toBeDefined();

    // Memory (priority 20) should come before Skills (priority 30)
    const skillsIdx = requestHooks.indexOf(skillsHook!);
    const memoryIdx = requestHooks.indexOf(memoryHook!);
    expect(memoryIdx).toBeLessThan(skillsIdx);
  });

  // ==========================================================
  // Memory + Skills + Summarization
  // ==========================================================

  it('should wire summarization hook alongside memory and skills', () => {
    const agent = createAgent({
      name: 'full-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      memory: {
        enabled: true,
        sources: [AGENTS_MD],
      },
      skills: {
        sources: [`${TEST_DIR}/skills`],
      },
      summarization: {
        tokenThreshold: 100000,
        preserveRecent: 20,
      },
    });

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();

    expect(requestHooks.length).toBeGreaterThanOrEqual(3);

    const summarizationHook = requestHooks.find(h => h.name === 'summarization-compact');
    expect(summarizationHook).toBeDefined();
    expect(summarizationHook!.priority).toBe(20);

    // Verify order: todo(15) < memory(20) ≤ summarization(20) < skills(30)
    const skillsIdx = requestHooks.findIndex(h => h.name === 'skills-context');
    const memoryIdx = requestHooks.findIndex(h => h.name === 'memory-context');
    const summIdx = requestHooks.findIndex(h => h.name === 'summarization-compact');
    expect(memoryIdx).toBeLessThan(skillsIdx);
    expect(summIdx).toBeLessThan(skillsIdx);
  });

  // ==========================================================
  // Custom + auto-created plugins coexist
  // ==========================================================

  it('should coexist custom observer plugin with auto-created memory plugin', () => {
    const agent = createAgent({
      name: 'hybrid-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      plugins: [
        {
          name: 'custom-observer',
          enabled: true,
          eventSubscriptions: [
            {
              event: 'agent.start' as const,
              handler: () => {},
            },
          ],
        },
      ],
      memory: {
        enabled: true,
        sources: [AGENTS_MD],
      },
    });

    expect(agent.ctx.agentName).toBe('hybrid-agent');

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();

    // Should have the auto-created memory hook
    const memoryHook = requestHooks.find(h => h.name === 'memory-context');
    expect(memoryHook).toBeDefined();
  });

  // ==========================================================
  // Session uniqueness
  // ==========================================================

  it('should produce unique session IDs across agents', () => {
    const a1 = createAgent({ name: 'u1', model: { provider: 'mock', model: 'm' }, maxSteps: 1 });
    const a2 = createAgent({ name: 'u2', model: { provider: 'mock', model: 'm' }, maxSteps: 1 });

    expect(a1.ctx.sessionId).not.toBe(a2.ctx.sessionId);
    expect(typeof a1.ctx.sessionId).toBe('string');
    expect(a1.ctx.sessionId.length).toBeGreaterThan(0);
  });
});
