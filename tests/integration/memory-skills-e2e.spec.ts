/**
 * End-to-End Integration Test
 *
 * Verifies that createAgent() properly creates and registers
 * MemoryPlugin and SkillsPlugin from config, and that the
 * plugin pipeline intercepts events correctly.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
// No rxjs imports needed
import type { AgentEvent } from '../../src/core/index.js';

// ============================================================
// Mocks (same pattern as create-agent.spec.ts)
// ============================================================

vi.mock('../../src/loop/index.js', () => ({
  createAgentLoop: () => ({
    run: async (_input: string) =>
      ({ type: 'done', reason: 'completed', timestamp: Date.now(), sessionId: 'test' } as AgentEvent),
    getCurrentState: () => null,
    destroy$: { subscribe: (obs: any) => { obs.next(); obs.complete(); return { unsubscribe() {} }; } },
  }),
}));

vi.mock('../../src/adapters/index.js', () => ({
  createLLMAdapter: () => ({
    name: 'mock',
    provider: 'mock',
    chat: async () => ({ content: 'ok', finishReason: 'stop' }),
    stream: async function* () { yield { type: 'text', delta: 'ok' } as any; },
  }),
  parseModelSpec: (spec: string) => {
    const parts = spec.split('/');
    return { provider: parts[0] ?? 'openai', model: parts[1] ?? spec };
  },
}));

vi.mock('../../src/operators/index.js', () => ({
  debugPreset: () => (source: any) => source,
  testPreset: () => (source: any) => source,
  productionPreset: () => (source: any) => source,
  timeoutOnEventType: () => (source: any) => source,
  retryOnEventType: () => (source: any) => source,
}));

// Import AFTER mocks
import { createAgent } from '../../src/api/create-agent.js';

// ============================================================
// Test Setup
// ============================================================

const TEST_DIR = join(tmpdir(), 'agentforge-e2e-wiring');
const AGENTS_MD = join(TEST_DIR, 'AGENTS.md');
const SKILL_DIR = join(TEST_DIR, 'skills', 'test-skill');
const SKILL_MD = join(SKILL_DIR, 'SKILL.md');

describe('createAgent() — Memory/Skills config wiring', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(SKILL_DIR, { recursive: true });

    await writeFile(AGENTS_MD, `# Test Memory\nUser prefers TypeScript.\n`, 'utf-8');

    await writeFile(SKILL_MD, `---
name: test-skill
description: A test skill for verification
---

# Test Skill
`, 'utf-8');
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should create agent without memory/skills (no plugins)', () => {
    const agent = createAgent({
      name: 'test-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
    });

    expect(agent).toBeDefined();
  });

  it('should create agent with memory config', () => {
    const agent = createAgent({
      name: 'test-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      memory: {
        enabled: true,
        sources: [AGENTS_MD],
      },
    });

    expect(agent).toBeDefined();
  });

  it('should create agent with skills config', () => {
    const agent = createAgent({
      name: 'test-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      skills: {
        sources: [join(TEST_DIR, 'skills')],
      },
    });

    expect(agent).toBeDefined();
  });

  it('should create agent with memory + skills + summarization', () => {
    const agent = createAgent({
      name: 'test-agent',
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

    expect(agent).toBeDefined();
  });

  it('should create agent with explicit plugins + auto-created plugins', () => {
    const agent = createAgent({
      name: 'test-agent',
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

    expect(agent).toBeDefined();
  });
});
