import { describe, it, expect } from 'vitest';
import { matchProfile, applyProfile } from '../src/model-profile.js';
import type { PipelineContext, ModelProfile } from '@primo-ai/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    agent: {
      config: { model: 'anthropic/claude-3' },
      promptFragments: [],
      toolDeclarations: [
        { name: 'search', description: 'Search' },
        { name: 'read', description: 'Read file' },
      ],
    },
    iteration: { step: 0 },
    session: { input: 'test', sessionId: 's1', custom: {} },
    ...overrides,
  };
}

describe('matchProfile', () => {
  it('matches string pattern using includes', () => {
    const profiles: ModelProfile[] = [
      { modelPattern: 'anthropic' },
    ];
    const result = matchProfile('anthropic/claude-3', profiles);
    expect(result).toBe(profiles[0]);
  });

  it('matches RegExp pattern', () => {
    const profiles: ModelProfile[] = [
      { modelPattern: /^anthropic\// },
    ];
    const result = matchProfile('anthropic/claude-3', profiles);
    expect(result).toBe(profiles[0]);
  });

  it('returns undefined when nothing matches', () => {
    const profiles: ModelProfile[] = [
      { modelPattern: 'openai' },
    ];
    const result = matchProfile('anthropic/claude-3', profiles);
    expect(result).toBeUndefined();
  });

  it('returns first matching profile', () => {
    const profiles: ModelProfile[] = [
      { modelPattern: 'openai' },
      { modelPattern: 'anthropic' },
      { modelPattern: /claude/ },
    ];
    const result = matchProfile('anthropic/claude-3', profiles);
    expect(result).toBe(profiles[1]);
  });
});

describe('applyProfile', () => {
  it('appends systemPromptSuffix to promptFragments', () => {
    const ctx = makeContext();
    const profile: ModelProfile = {
      modelPattern: 'anthropic',
      systemPromptSuffix: ' Always be concise.',
    };
    const result = applyProfile(ctx, profile);
    expect(result.agent.promptFragments).toEqual([' Always be concise.']);
  });

  it('applies toolOverrides — exclude removes from toolDeclarations', () => {
    const ctx = makeContext();
    const profile: ModelProfile = {
      modelPattern: 'anthropic',
      toolOverrides: {
        search: { exclude: true },
      },
    };
    const result = applyProfile(ctx, profile);
    expect(result.agent.toolDeclarations).toEqual([
      { name: 'read', description: 'Read file' },
    ]);
  });

  it('applies toolOverrides — updates description', () => {
    const ctx = makeContext();
    const profile: ModelProfile = {
      modelPattern: 'anthropic',
      toolOverrides: {
        read: { description: 'Read file safely' },
      },
    };
    const result = applyProfile(ctx, profile);
    expect(result.agent.toolDeclarations).toEqual([
      { name: 'search', description: 'Search' },
      { name: 'read', description: 'Read file safely' },
    ]);
  });

  it('adds extraPromptFragments (converted to strings)', () => {
    const ctx = makeContext();
    const profile: ModelProfile = {
      modelPattern: 'anthropic',
      extraPromptFragments: [
        { role: 'system', content: 'Extra context', priority: 1, source: 'profile' },
        { role: 'instruction', content: 'Be helpful', priority: 2, source: 'profile' },
      ],
    };
    const result = applyProfile(ctx, profile);
    expect(result.agent.promptFragments).toEqual(['Extra context', 'Be helpful']);
  });

  it('combines systemPromptSuffix and extraPromptFragments', () => {
    const ctx = makeContext();
    const profile: ModelProfile = {
      modelPattern: 'anthropic',
      systemPromptSuffix: ' Be concise.',
      extraPromptFragments: [
        { role: 'context', content: 'Safety rules', priority: 0, source: 'profile' },
      ],
    };
    const result = applyProfile(ctx, profile);
    expect(result.agent.promptFragments).toEqual(['Safety rules', ' Be concise.']);
  });

  it('preserves existing promptFragments', () => {
    const ctx = makeContext({
      agent: {
        config: { model: 'anthropic/claude-3' },
        promptFragments: ['existing'],
        toolDeclarations: [],
      },
    });
    const profile: ModelProfile = {
      modelPattern: 'anthropic',
      extraPromptFragments: [
        { role: 'system', content: 'new', priority: 1, source: 'profile' },
      ],
    };
    const result = applyProfile(ctx, profile);
    expect(result.agent.promptFragments).toEqual(['existing', 'new']);
  });

  it('does not mutate the original context', () => {
    const ctx = makeContext();
    const originalFragments = [...ctx.agent.promptFragments];
    const originalTools = [...ctx.agent.toolDeclarations];
    const profile: ModelProfile = {
      modelPattern: 'anthropic',
      systemPromptSuffix: ' suffix',
    };
    applyProfile(ctx, profile);
    expect(ctx.agent.promptFragments).toEqual(originalFragments);
    expect(ctx.agent.toolDeclarations).toEqual(originalTools);
  });
});
