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
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

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
    run: async () => 'ok',
    on: () => () => {},
    onAny: () => () => {},
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

const TEST_DIR = join(tmpdir(), 'agentforge-memory-skills-e2e');
const AGENTS_MD = join(TEST_DIR, 'AGENTS.md');
const SKILL_DIR = join(TEST_DIR, 'skills', 'test-skill');
const SKILL_MD = join(SKILL_DIR, 'SKILL.md');

describe('createAgent() — Memory/Skills/Summarization plugin wiring', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(SKILL_DIR, { recursive: true });

    await writeFile(AGENTS_MD, '# Test Memory\nUser prefers TypeScript.\n', 'utf-8');

    await writeFile(
      SKILL_MD,
      `---
name: test-skill
description: A test skill for verification
---

# Test Skill
`,
      'utf-8',
    );
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
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
    const memoryHook = requestHooks.find(h => h.name === 'memory-intercept');
    expect(memoryHook).toBeDefined();
    expect(memoryHook!.priority).toBe(10);
  });

  it('should register memory lifecycle hook for agent.start bridging', () => {
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
    const lifecycleFns = hooks.getLifecycleHooks('session.start');
    expect(lifecycleFns.length).toBeGreaterThanOrEqual(1);
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
        sources: [join(TEST_DIR, 'skills')],
      },
    });

    expect(agent.ctx.agentName).toBe('skills-agent');

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();
    const skillsHook = requestHooks.find(h => h.name === 'skills-intercept');
    expect(skillsHook).toBeDefined();
    expect(skillsHook!.priority).toBe(5);
  });

  it('should register skills lifecycle hook for agent.start bridging', () => {
    const agent = createAgent({
      name: 'skills-lifecycle',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      skills: {
        sources: [join(TEST_DIR, 'skills')],
      },
    });

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const lifecycleFns = hooks.getLifecycleHooks('session.start');
    expect(lifecycleFns.length).toBeGreaterThanOrEqual(1);
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
        sources: [join(TEST_DIR, 'skills')],
      },
    });

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();

    expect(requestHooks.length).toBeGreaterThanOrEqual(2);

    const skillsHook = requestHooks.find(h => h.name === 'skills-intercept');
    const memoryHook = requestHooks.find(h => h.name === 'memory-intercept');

    expect(skillsHook).toBeDefined();
    expect(memoryHook).toBeDefined();

    // Skills (priority 5) should come before Memory (priority 10)
    const skillsIdx = requestHooks.indexOf(skillsHook!);
    const memoryIdx = requestHooks.indexOf(memoryHook!);
    expect(skillsIdx).toBeLessThan(memoryIdx);
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
        sources: [join(TEST_DIR, 'skills')],
      },
      summarization: {
        tokenThreshold: 100000,
        preserveRecent: 20,
      },
    });

    const hooks = agent.ctx.hookRegistry as HookRegistry;
    const requestHooks = hooks.getRequestHooks();

    expect(requestHooks.length).toBeGreaterThanOrEqual(3);

    const summarizationHook = requestHooks.find(h => h.name === 'summarization-intercept');
    expect(summarizationHook).toBeDefined();
    expect(summarizationHook!.priority).toBe(20);

    // Verify order: skills(5) < memory(10) < summarization(20)
    const skillsIdx = requestHooks.findIndex(h => h.name === 'skills-intercept');
    const memoryIdx = requestHooks.findIndex(h => h.name === 'memory-intercept');
    const summIdx = requestHooks.findIndex(h => h.name === 'summarization-intercept');
    expect(skillsIdx).toBeLessThan(memoryIdx);
    expect(memoryIdx).toBeLessThan(summIdx);
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
          type: 'observer',
          priority: 100,
          eventTypes: [],
          enabled: true,
          observe() {},
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
    const memoryHook = requestHooks.find(h => h.name === 'memory-intercept');
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
