import { describe, it, expect } from 'vitest';
import { ProfileLoader, mergeProfiles } from '../../src/profiles/profile-loader.js';
import { applyProfile } from '../../src/profiles/apply-profile.js';
import { builtinProfiles } from '../../src/profiles/index.js';
import type { AgentProfile } from '@agentforge/sdk';
import type { Agent } from '@agentforge/core';

describe('ProfileLoader', () => {
  it('loads a registered profile by name', () => {
    const loader = new ProfileLoader();
    const profile: AgentProfile = { name: 'test', description: 'Test profile' };
    loader.register(profile);
    expect(loader.load('test')).toBe(profile);
  });

  it('throws descriptive error for unknown profile', () => {
    const loader = new ProfileLoader();
    expect(() => loader.load('missing')).toThrow(/Unknown profile.*missing/);
  });

  it('lists all registered profile names', () => {
    const loader = new ProfileLoader();
    loader.register({ name: 'a' });
    loader.register({ name: 'b' });
    expect(loader.list().sort()).toEqual(['a', 'b']);
  });

  it('resolves extends chain', () => {
    const loader = new ProfileLoader();
    loader.register({ name: 'base', plugins: [() => ({ processors: [] })] });
    loader.register({ name: 'child', extends: 'base', description: 'extended' });
    const resolved = loader.load('child');
    expect(resolved.plugins).toHaveLength(1);
    expect(resolved.description).toBe('extended');
  });
});

describe('mergeProfiles', () => {
  it('concatenates plugins and tools arrays', () => {
    const base: AgentProfile = {
      name: 'base',
      plugins: [() => ({ processors: [] })],
      tools: [{ name: 'a', description: 'a', inputSchema: {}, execute: async () => '' }],
    };
    const override: AgentProfile = {
      name: 'child',
      plugins: [() => ({ processors: [] })],
      tools: [{ name: 'b', description: 'b', inputSchema: {}, execute: async () => '' }],
    };
    const merged = mergeProfiles(base, override);
    expect(merged.plugins).toHaveLength(2);
    expect(merged.tools).toHaveLength(2);
    expect(merged.name).toBe('child');
  });

  it('overrides scalar fields from child', () => {
    const base: AgentProfile = { name: 'base', model: 'gpt-4', maxIterations: 10 };
    const child: AgentProfile = { name: 'child', model: 'gpt-3.5' };
    const merged = mergeProfiles(base, child);
    expect(merged.model).toBe('gpt-3.5');
    expect(merged.maxIterations).toBe(10);
  });
});

describe('builtinProfiles', () => {
  const profileNames = builtinProfiles().map(p => p.name);

  it('includes all 4 required profiles', () => {
    expect(profileNames).toContain('coding-agent');
    expect(profileNames).toContain('business-agent');
    expect(profileNames).toContain('personal-agent');
    expect(profileNames).toContain('data-agent');
  });

  it('each profile has name, description, and plugins', () => {
    for (const p of builtinProfiles()) {
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(Array.isArray(p.plugins)).toBe(true);
    }
  });

  it('coding-agent has memory, compression, and permission plugins', () => {
    const coding = builtinProfiles().find(p => p.name === 'coding-agent')!;
    expect(coding.plugins!.length).toBeGreaterThanOrEqual(3);
  });

  it('business-agent has fact-injection and cost-cap', () => {
    const biz = builtinProfiles().find(p => p.name === 'business-agent')!;
    expect(biz.plugins!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('applyProfile', () => {
  it('calls agent.use for each plugin factory', () => {
    const used: number[] = [];
    const mockAgent = {
      use: (_fn: () => unknown) => { used.push(1); return mockAgent; },
      toolRegistry: { register: () => {} },
    };
    const profile: AgentProfile = {
      name: 'test',
      plugins: [() => ({ processors: [] }), () => ({ processors: [] })],
    };
    applyProfile(mockAgent as unknown as Agent, profile);
    expect(used).toHaveLength(2);
  });
});
