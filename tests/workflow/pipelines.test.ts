import { describe, test, expect, vi } from 'vitest';
import { sequentialPipeline, parallelPipeline } from '../../src/workflow/pipelines/index.js';
import type { Agent } from '../../src/agent/index.js';
import type { Message } from '../../src/types.js';

describe('Pipelines', () => {
  test('sequentialPipeline should execute agents in sequence', async () => {
    const results: string[] = [];

    const createMockAgent = (name: string) =>
      ({
        run: async (input: string) => {
          results.push(name);
          return `${name} response`;
        },
      }) as unknown as Agent;

    const agent1 = createMockAgent('agent1');
    const agent2 = createMockAgent('agent2');
    const agent3 = createMockAgent('agent3');

    const result = await sequentialPipeline([agent1, agent2, agent3]);

    expect(results).toEqual(['agent1', 'agent2', 'agent3']);
  });
});
