import { describe, it, expect, beforeEach } from 'vitest';
import { WorkingMemoryImpl } from '../src/memory/working-memory.js';

describe('WorkingMemoryImpl', () => {
  let wm: WorkingMemoryImpl;

  beforeEach(() => {
    wm = new WorkingMemoryImpl();
  });

  describe('userProfile', () => {
    it('returns empty defaults initially', () => {
      const profile = wm.getProfile();
      expect(profile.preferences).toEqual({});
      expect(profile.goals).toEqual([]);
      expect(profile.constraints).toEqual([]);
    });

    it('sets and gets name', () => {
      wm.setProfileField('name', 'Alice');
      expect(wm.getProfile().name).toBe('Alice');
    });

    it('sets and gets preferences', () => {
      wm.setProfileField('preferences', { language: 'zh-CN' });
      expect(wm.getProfile().preferences).toEqual({ language: 'zh-CN' });
    });

    it('adds a goal', () => {
      wm.addGoal('learn Rust');
      wm.addGoal('build memory system');
      expect(wm.getProfile().goals).toEqual(['learn Rust', 'build memory system']);
    });

    it('deduplicates goals', () => {
      wm.addGoal('learn Rust');
      wm.addGoal('learn Rust');
      expect(wm.getProfile().goals).toEqual(['learn Rust']);
    });

    it('removes a goal', () => {
      wm.addGoal('learn Rust');
      wm.addGoal('build system');
      wm.removeGoal('learn Rust');
      expect(wm.getProfile().goals).toEqual(['build system']);
    });

    it('adds a constraint', () => {
      wm.addConstraint('must support streaming');
      expect(wm.getProfile().constraints).toEqual(['must support streaming']);
    });

    it('removes a constraint', () => {
      wm.addConstraint('c1');
      wm.addConstraint('c2');
      wm.removeConstraint('c1');
      expect(wm.getProfile().constraints).toEqual(['c2']);
    });
  });

  describe('taskState', () => {
    it('returns defaults initially', () => {
      const state = wm.getTaskState();
      expect(state.currentGoal).toBe('');
      expect(state.progress).toBe(0);
      expect(state.blockers).toEqual([]);
      expect(state.nextSteps).toEqual([]);
    });

    it('sets current goal', () => {
      wm.setCurrentGoal('implement TDD workflow');
      expect(wm.getTaskState().currentGoal).toBe('implement TDD workflow');
    });

    it('updates progress', () => {
      wm.updateProgress(75);
      expect(wm.getTaskState().progress).toBe(75);
    });

    it('clamps progress to 0-100 range', () => {
      wm.updateProgress(-10);
      expect(wm.getTaskState().progress).toBe(0);
      wm.updateProgress(150);
      expect(wm.getTaskState().progress).toBe(100);
    });

    it('adds and removes blockers', () => {
      wm.addBlocker('waiting for API key');
      wm.addBlocker('need design review');
      expect(wm.getTaskState().blockers).toHaveLength(2);
      wm.removeBlocker('waiting for API key');
      expect(wm.getTaskState().blockers).toEqual(['need design review']);
    });

    it('sets next steps', () => {
      wm.setNextSteps(['write tests', 'run build', 'review']);
      expect(wm.getTaskState().nextSteps).toEqual(['write tests', 'run build', 'review']);
    });

    it('resets task state', () => {
      wm.setCurrentGoal('test');
      wm.updateProgress(50);
      wm.addBlocker('blocked');
      wm.resetTaskState();
      const state = wm.getTaskState();
      expect(state.currentGoal).toBe('');
      expect(state.progress).toBe(0);
      expect(state.blockers).toEqual([]);
    });
  });

  describe('injection', () => {
    it('generates markdown injection for thread scope', () => {
      wm.setProfileField('name', 'Alice');
      wm.addGoal('build system');
      wm.setCurrentGoal('implement phase 1');
      wm.updateProgress(30);

      const injection = wm.toInjection('thread');
      expect(injection).toContain('Alice');
      expect(injection).toContain('build system');
      expect(injection).toContain('implement phase 1');
      expect(injection).toContain('30%');
    });

    it('generates compact injection for resource scope', () => {
      wm.setProfileField('name', 'Alice');
      const injection = wm.toInjection('resource');
      expect(injection).toContain('Alice');
      expect(injection.length).toBeLessThan(200);
    });

    it('returns minimal injection when no data set', () => {
      const injection = wm.toInjection('thread');
      expect(injection).toBeDefined();
      expect(injection.length).toBeGreaterThan(0);
    });
  });

  describe('serialization', () => {
    it('round-trips to plain object', () => {
      wm.setProfileField('name', 'Alice');
      wm.addGoal('test');
      wm.setCurrentGoal('build');

      const data = wm.toJSON();
      const restored = WorkingMemoryImpl.fromJSON(data);

      expect(restored.getProfile().name).toBe('Alice');
      expect(restored.getProfile().goals).toEqual(['test']);
      expect(restored.getTaskState().currentGoal).toBe('build');
    });
  });
});
