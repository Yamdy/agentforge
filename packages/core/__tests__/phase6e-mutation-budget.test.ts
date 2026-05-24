import { describe, it, expect, vi } from 'vitest';
import type { MutationBudgetConfig } from '@primo-ai/sdk';
import { MutationBudgetEngine } from '../src/mutation-budget.js';

const defaultConfig: MutationBudgetConfig = {
  maxMutationsPerHour: 10,
  maxMutationsPerDay: 30,
  maxDiffLinesPerMutation: 50,
  maxFilesPerMutation: 3,
  cooldownMs: 0,
};

describe('MutationBudgetEngine', () => {
  it('creates with default config and zero counts', () => {
    const budget = new MutationBudgetEngine(defaultConfig);
    expect(budget.state.hourlyCount).toBe(0);
    expect(budget.state.dailyCount).toBe(0);
  });

  it('allows mutation within budget', () => {
    const budget = new MutationBudgetEngine(defaultConfig);
    const result = budget.tryConsume({ files: 2, linesPerFile: 30 });
    expect(result.allowed).toBe(true);
    expect(budget.state.hourlyCount).toBe(1);
    expect(budget.state.dailyCount).toBe(1);
  });

  it('rejects mutation exceeding hourly limit', () => {
    const budget = new MutationBudgetEngine({ ...defaultConfig, maxMutationsPerHour: 2 });

    budget.tryConsume({ files: 1, linesPerFile: 10 });
    budget.tryConsume({ files: 1, linesPerFile: 10 });

    const result = budget.tryConsume({ files: 1, linesPerFile: 10 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('hourly');
  });

  it('rejects mutation exceeding daily limit', () => {
    const budget = new MutationBudgetEngine({ ...defaultConfig, maxMutationsPerHour: 100, maxMutationsPerDay: 2 });

    budget.tryConsume({ files: 1, linesPerFile: 10 });
    budget.tryConsume({ files: 1, linesPerFile: 10 });

    const result = budget.tryConsume({ files: 1, linesPerFile: 10 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('daily');
  });

  it('rejects mutation exceeding file limit', () => {
    const budget = new MutationBudgetEngine(defaultConfig);
    const result = budget.tryConsume({ files: 5, linesPerFile: 10 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('files');
  });

  it('rejects mutation exceeding lines limit', () => {
    const budget = new MutationBudgetEngine(defaultConfig);
    const result = budget.tryConsume({ files: 1, linesPerFile: 100 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('lines');
  });

  it('enforces cooldown period', () => {
    const budget = new MutationBudgetEngine({ ...defaultConfig, cooldownMs: 1000 });
    budget.tryConsume({ files: 1, linesPerFile: 10 });

    const result = budget.tryConsume({ files: 1, linesPerFile: 10 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cooldown');
  });

  it('allows mutation after cooldown period', async () => {
    const budget = new MutationBudgetEngine({ ...defaultConfig, cooldownMs: 10 });
    budget.tryConsume({ files: 1, linesPerFile: 10 });

    await new Promise(r => setTimeout(r, 20));

    const result = budget.tryConsume({ files: 1, linesPerFile: 10 });
    expect(result.allowed).toBe(true);
  });

  it('resets hourly counter after hour passes', () => {
    const budget = new MutationBudgetEngine({ ...defaultConfig, maxMutationsPerHour: 2 });
    const now = Date.now();

    budget.forceSetState({
      hourlyCount: 2,
      hourlyResetAt: now - 1,
      dailyCount: 2,
      dailyResetAt: now + 3600000,
      lastMutationAt: 0, // no cooldown
    });

    const result = budget.tryConsume({ files: 1, linesPerFile: 10 });
    expect(result.allowed).toBe(true);
    expect(budget.state.hourlyCount).toBe(1);
  });

  it('emits budget:exceeded event when budget exhausted', () => {
    const events: string[] = [];
    const budget = new MutationBudgetEngine({
      ...defaultConfig,
      maxMutationsPerHour: 1,
      onEvent: (event) => events.push(event),
    });

    budget.tryConsume({ files: 1, linesPerFile: 10 });
    budget.tryConsume({ files: 1, linesPerFile: 10 });

    expect(events).toContain('budget:exceeded');
  });
});
