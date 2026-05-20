import type {
  OrchestrationStepConfig,
  OrchestrationStepResult,
  OrchestrationResult,
  OrchestrationOptions,
  OrchestrationStepOptions,
  PipelineContext,
  TokenUsage,
  AgentLike,
} from '@primo-ai/sdk';
import type { Agent } from '../agent.js';
import { SequentialExecutor } from './executors/sequential.js';
import { ParallelExecutor } from './executors/parallel.js';
import { AgentRouter, executeRouter } from './executors/router.js';

/**
 * Type guard to check if an AgentLike is an Agent instance.
 */
function isAgentInstance(agentLike: AgentLike): agentLike is Agent {
  return (
    typeof agentLike === 'object' &&
    agentLike !== null &&
    'run' in agentLike &&
    typeof (agentLike as Agent).run === 'function'
  );
}

/**
 * Step definition with resolved Agent instance.
 */
interface ResolvedStep {
  name: string;
  type: 'sequential' | 'parallel' | 'router';
  agent?: Agent;
  agents?: Agent[];
  router?: AgentRouter;
  options?: OrchestrationStepOptions;
}

/**
 * OrchestrationPipeline provides a fluent API for multi-agent orchestration.
 * Supports Sequential, Parallel, and Conditional execution patterns.
 */
export class OrchestrationPipeline {
  private steps: ResolvedStep[] = [];
  private agentFactory?: (config: AgentLike) => Agent;

  constructor(options?: { agentFactory?: (config: AgentLike) => Agent }) {
    this.agentFactory = options?.agentFactory;
  }

  /**
   * Add a sequential step with a single agent.
   */
  step(name: string, agent: AgentLike, options?: OrchestrationStepOptions): this;

  /**
   * Add a parallel step with multiple agents.
   */
  step(
    name: string,
    agents: AgentLike[],
    options?: OrchestrationStepOptions
  ): this;

  /**
   * Add a router step for conditional execution.
   */
  step(name: string, router: AgentRouter, options?: OrchestrationStepOptions): this;

  step(
    name: string,
    agentOrAgentsOrRouter: AgentLike | AgentLike[] | AgentRouter,
    options?: OrchestrationStepOptions
  ): this {
    // Handle router
    if (agentOrAgentsOrRouter instanceof AgentRouter) {
      this.steps.push({
        name,
        type: 'router',
        router: agentOrAgentsOrRouter,
        options,
      });
      return this;
    }

    // Handle array (parallel)
    if (Array.isArray(agentOrAgentsOrRouter)) {
      const resolvedAgents = agentOrAgentsOrRouter.map((a) =>
        this.resolveAgent(a)
      );
      this.steps.push({
        name,
        type: 'parallel',
        agents: resolvedAgents,
        options,
      });
      return this;
    }

    // Handle single agent (sequential)
    this.steps.push({
      name,
      type: 'sequential',
      agent: this.resolveAgent(agentOrAgentsOrRouter),
      options,
    });
    return this;
  }

  /**
   * Execute the pipeline and return results.
   */
  async run(
    input: string,
    options?: OrchestrationOptions
  ): Promise<OrchestrationResult> {
    const results: OrchestrationStepResult[] = [];
    let currentInput = input;
    const totalTokenUsage: TokenUsage = { input: 0, output: 0 };
    const sessionId = options?.sessionId ?? `orchestration-${Date.now()}`;

    for (const step of this.steps) {
      if (options?.signal?.aborted) {
        throw new DOMException('Orchestration pipeline aborted', 'AbortError');
      }

      const result = await this.executeStep(
        step,
        currentInput,
        sessionId,
        options?.signal
      );

      results.push(result);

      // Accumulate token usage
      totalTokenUsage.input += result.tokenUsage.input;
      totalTokenUsage.output += result.tokenUsage.output;

      // Chain output: use step result as next input
      if (result.response && !result.error) {
        currentInput = result.response;
      }

      // Handle errors based on step failure strategy
      if (result.error && step.options?.failureStrategy === 'fail-fast') {
        throw result.error;
      }
    }

    // Aggregate final response
    const finalResult = results[results.length - 1];
    const response = finalResult?.response ?? '';

    return {
      response,
      steps: results,
      totalTokenUsage,
      sessionId,
    };
  }

  private async executeStep(
    step: ResolvedStep,
    input: string,
    sessionId: string,
    signal?: AbortSignal
  ): Promise<OrchestrationStepResult> {
    try {
      switch (step.type) {
        case 'sequential': {
          if (!step.agent) {
            throw new Error(`Step "${step.name}" has no agent configured`);
          }
          const result = await step.agent.run(input, { signal });
          return {
            stepName: step.name,
            response: result.response,
            tokenUsage: result.tokenUsage,
            sessionId: result.sessionId,
          };
        }

        case 'parallel': {
          if (!step.agents || step.agents.length === 0) {
            throw new Error(`Step "${step.name}" has no agents configured`);
          }
          const executor = new ParallelExecutor(step.options);
          const parallelResults = await executor.execute(
            { name: step.name, agents: [] },
            step.agents,
            input,
            { signal }
          );

          // Aggregate parallel results
          const aggregated = await executor.aggregateResults(parallelResults);

          // Sum token usage
          const totalUsage = parallelResults.reduce(
            (acc, r) => ({
              input: acc.input + r.tokenUsage.input,
              output: acc.output + r.tokenUsage.output,
            }),
            { input: 0, output: 0 }
          );

          return {
            stepName: step.name,
            response: aggregated,
            tokenUsage: totalUsage,
            sessionId,
          };
        }

        case 'router': {
          if (!step.router) {
            throw new Error(`Step "${step.name}" has no router configured`);
          }
          const context = {} as PipelineContext;
          return executeRouter(step.router, input, context, { signal });
        }

        default:
          throw new Error(`Unknown step type: ${(step as any).type}`);
      }
    } catch (error) {
      return {
        stepName: step.name,
        response: '',
        tokenUsage: { input: 0, output: 0 },
        sessionId,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private resolveAgent(agentLike: AgentLike): Agent {
    if (isAgentInstance(agentLike)) {
      return agentLike;
    }
    if (this.agentFactory) {
      return this.agentFactory(agentLike);
    }
    throw new Error(
      'AgentLike is an AgentConfig but no agentFactory was provided. ' +
      'Pass Agent instances or provide a factory function in the constructor.'
    );
  }

  /**
   * Get all step names in the pipeline.
   */
  getStepNames(): string[] {
    return this.steps.map((s) => s.name);
  }

  /**
   * Get the number of steps in the pipeline.
   */
  getStepCount(): number {
    return this.steps.length;
  }
}

/**
 * Create a new orchestration pipeline.
 */
export function createPipeline(
  options?: ConstructorParameters<typeof OrchestrationPipeline>[0]
): OrchestrationPipeline {
  return new OrchestrationPipeline(options);
}
