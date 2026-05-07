import { describe, it, expect } from 'vitest';
import { workflow } from '../../src/workflow/builder.js';
import type { StepEntry } from '../../src/workflow/types.js';

function step(id: string): StepEntry {
  return { type: 'step', id, prompt: (input: unknown) => `Process: ${String(input)}` };
}

describe('WorkflowBuilder', () => {
  it('builds a linear workflow with .then()', () => {
    const config = workflow('test', { name: 'Test' })
      .then(step('s1'))
      .then(step('s2'))
      .commit();

    expect(config.id).toBe('test');
    expect(config.name).toBe('Test');
    expect(config.steps).toHaveLength(2);
    expect(config.steps[0]!.type).toBe('step');
  });

  it('builds a branch workflow', () => {
    const config = workflow('branch-test')
      .then(step('start'))
      .branch(
        (input) => (input as { x: number }).x > 0,
        (sub) => sub.then(step('positive')),
        (sub) => sub.then(step('negative'))
      )
      .commit();

    expect(config.steps).toHaveLength(2);
    const branch = config.steps[1]!;
    expect(branch.type).toBe('branch');
    if (branch.type === 'branch') {
      expect(branch.then).toHaveLength(1);
      expect(branch.else!).toHaveLength(1);
    }
  });

  it('builds a parallel workflow', () => {
    const config = workflow('parallel-test')
      .parallel([
        (sub) => sub.then(step('a')),
        (sub) => sub.then(step('b')),
      ])
      .commit();

    expect(config.steps[0]!.type).toBe('parallel');
  });

  it('builds a foreach workflow', () => {
    const config = workflow('foreach-test')
      .foreach(
        (input) => (input as { items: unknown[] }).items,
        (sub) => sub.then(step('process'))
      )
      .commit();

    expect(config.steps[0]!.type).toBe('foreach');
  });

  it('supports nested sub-flows', () => {
    const config = workflow('nested-test')
      .branch(
        () => true,
        (sub) => sub
          .then(step('inner1'))
          .parallel([
            (s2) => s2.then(step('p1')),
            (s2) => s2.then(step('p2')),
          ])
      )
      .commit();

    expect(config.steps[0]!.type).toBe('branch');
  });

  it('.commit() validates via WorkflowConfigSchema', () => {
    // Missing name — schema validation will catch this at commit()
    // workflow() with no name defaults to using id as name, so this passes
    const config = workflow('minimal').then(step('s1')).commit();
    expect(config.id).toBe('minimal');
    expect(config.name).toBe('minimal');
  });

  it('throws on .commit() with no steps', () => {
    expect(() => workflow('empty').commit()).toThrow();
  });
});
