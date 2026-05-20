import { describe, it, expectTypeOf } from 'vitest';
import type {
  OrchestrationStepConfig,
  OrchestrationStepOptions,
  RouterConfig,
  OrchestrationStepResult,
  OrchestrationResult,
  AggregatorFunction,
  RouterClassifier,
} from '@primo-ai/sdk';

describe('Orchestration Types', () => {
  describe('OrchestrationStepConfig', () => {
    it('should accept sequential step config', () => {
      const config: OrchestrationStepConfig = {
        name: 'planner',
        agent: { model: 'claude-sonnet-4-6' },
      };
      expectTypeOf(config).toMatchTypeOf<OrchestrationStepConfig>();
    });

    it('should accept parallel step config', () => {
      const config: OrchestrationStepConfig = {
        name: 'research',
        agents: [
          { model: 'claude-sonnet-4-6' },
          { model: 'claude-sonnet-4-6' },
        ],
        options: {
          aggregator: (results) => results.map(r => r.response).join('\n'),
        },
      };
      expectTypeOf(config).toMatchTypeOf<OrchestrationStepConfig>();
    });

    it('should accept router step config', () => {
      const config: OrchestrationStepConfig = {
        name: 'classify',
        router: {
          routes: {
            code: { model: 'claude-sonnet-4-6' },
            research: { model: 'claude-sonnet-4-6' },
          },
          classifier: async () => 'code',
        },
      };
      expectTypeOf(config).toMatchTypeOf<OrchestrationStepConfig>();
    });
  });

  describe('OrchestrationStepOptions', () => {
    it('should accept aggregator function', () => {
      const options: OrchestrationStepOptions = {
        aggregator: (results) => results[0]?.response ?? '',
        failureStrategy: 'continue',
        timeout: 60000,
      };
      expectTypeOf(options).toMatchTypeOf<OrchestrationStepOptions>();
    });
  });

  describe('OrchestrationStepResult', () => {
    it('should track step execution result', () => {
      const result: OrchestrationStepResult = {
        stepName: 'planner',
        response: 'Plan created',
        tokenUsage: { input: 100, output: 50 },
        sessionId: 'session-123',
      };
      expectTypeOf(result).toMatchTypeOf<OrchestrationStepResult>();
    });

    it('should track error in result', () => {
      const result: OrchestrationStepResult = {
        stepName: 'planner',
        response: '',
        tokenUsage: { input: 0, output: 0 },
        sessionId: 'session-123',
        error: new Error('Agent failed'),
      };
      expectTypeOf(result).toMatchTypeOf<OrchestrationStepResult>();
    });
  });

  describe('OrchestrationResult', () => {
    it('should aggregate all step results', () => {
      const result: OrchestrationResult = {
        response: 'Final response',
        steps: [
          {
            stepName: 'planner',
            response: 'Plan',
            tokenUsage: { input: 100, output: 50 },
            sessionId: 'session-1',
          },
        ],
        totalTokenUsage: { input: 100, output: 50 },
        sessionId: 'orchestration-123',
      };
      expectTypeOf(result).toMatchTypeOf<OrchestrationResult>();
    });
  });

  describe('AggregatorFunction', () => {
    it('should be a function that aggregates results', () => {
      const aggregator: AggregatorFunction = (results) => {
        return results.map(r => r.response).join('\n---\n');
      };
      expectTypeOf(aggregator).toMatchTypeOf<AggregatorFunction>();
    });
  });

  describe('RouterClassifier', () => {
    it('should be a function that returns route key', () => {
      const classifier: RouterClassifier = async (input) => {
        if (input.includes('code')) return 'code';
        if (input.includes('research')) return 'research';
        return 'general';
      };
      expectTypeOf(classifier).toMatchTypeOf<RouterClassifier>();
    });
  });
});
