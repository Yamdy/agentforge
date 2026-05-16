import { describe, it, expect } from 'vitest';
import { LoopOrchestrator } from '../src/loop-orchestrator.js';
import type { StageMutation, StageName } from '@agentforge/sdk';

function makeOrchestrator(): LoopOrchestrator {
  // @ts-expect-error — minimal mock for unit testing applyMutation
  return new LoopOrchestrator(
    { register: () => {}, stream: async function*() {} },
    { register: () => {}, execute: async () => {}, getHookPointDisableIds: () => new Set() },
  );
}

describe('LoopOrchestrator.applyMutation', () => {
  it('inserts a stage after the specified stage', () => {
    const orch = makeOrchestrator();
    const mutation: StageMutation = {
      type: 'insert',
      phase: 'loop',
      after: 'invokeLLM',
      stage: 'myCustomStage',
    };
    orch.applyMutation(mutation);

    // Verify by inserting after the newly added stage
    const verify: StageMutation = {
      type: 'insert',
      phase: 'loop',
      after: 'myCustomStage',
      stage: 'anotherStage',
    };
    expect(() => orch.applyMutation(verify)).not.toThrow();
  });

  it('removes a stage from the specified phase', () => {
    const orch = makeOrchestrator();
    orch.applyMutation({ type: 'remove', phase: 'loop', stage: 'gateLLM' });

    // gateLLM gone — inserting after it should fail
    expect(() => orch.applyMutation({
      type: 'insert', phase: 'loop', after: 'gateLLM', stage: 'x',
    })).toThrow(/not found/);
  });

  it('replaces all stages in a phase', () => {
    const orch = makeOrchestrator();
    orch.applyMutation({ type: 'replace', phase: 'postLoop', stages: ['processOutput', 'myNewStage'] });

    expect(() => orch.applyMutation({
      type: 'insert', phase: 'postLoop', after: 'myNewStage', stage: 'verify',
    })).not.toThrow();
  });

  it('throws when replacing loop phase without invokeLLM', () => {
    const orch = makeOrchestrator();
    expect(() => orch.applyMutation({
      type: 'replace', phase: 'loop', stages: ['prepareStep'],
    })).toThrow(/invokeLLM/);
  });

  it('throws when inserting after non-existent stage', () => {
    const orch = makeOrchestrator();
    expect(() => orch.applyMutation({
      type: 'insert', phase: 'loop', after: 'noSuchStage', stage: 'x',
    })).toThrow(/not found/);
  });

  it('throws when removing non-existent stage', () => {
    const orch = makeOrchestrator();
    expect(() => orch.applyMutation({
      type: 'remove', phase: 'loop', stage: 'noSuchStage',
    })).toThrow(/not found/);
  });

  it('allows preLoop phase mutations', () => {
    const orch = makeOrchestrator();
    expect(() => orch.applyMutation({
      type: 'insert', phase: 'preLoop', after: 'processInput', stage: 'validateInput',
    })).not.toThrow();
  });

  it('allows custom string stage names', () => {
    const orch = makeOrchestrator();
    expect(() => orch.applyMutation({
      type: 'insert', phase: 'loop', after: 'invokeLLM', stage: 'custom:telemetry' as StageName,
    })).not.toThrow();
  });
});
