import { describe, test, expect } from 'vitest';
import { createStep, createWorkflow } from '../../src/workflow/index.js';

describe('Workflow', () => {
  test('should execute sequential steps', async () => {
    const step1 = createStep('step1', async (input: number) => input * 2);
    const step2 = createStep('step2', async (input: number) => input + 10);

    const workflow = createWorkflow({ id: 'test' })
      .step('step1', step1)
      .then('step2', step2)
      .commit();

    const result = await workflow.run(5);
    expect(result).toBe(20);
  });

  test('should execute branch', async () => {
    const step1 = createStep('step1', async (input: number) => input);
    const stepLarge = createStep('large', async (input: number) => input * 100);
    const stepSmall = createStep('small', async (input: number) => input * 2);

    const workflow = createWorkflow({ id: 'branch-test' })
      .step('step1', step1)
      .branch((ctx) => (ctx.getResult('step1') as number) > 10, {
        true: { id: 'large', step: stepLarge },
        false: { id: 'small', step: stepSmall },
      })
      .commit();

    const result1 = await workflow.run(5);
    expect(result1).toBe(10);

    const result2 = await workflow.run(15);
    expect(result2).toBe(1500);
  });
});
