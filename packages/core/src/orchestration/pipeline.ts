import type { OrchestrationStepResult, OrchestrationResult, OrchestrationOptions, OrchestrationStepOptions, PipelineContext, TokenUsage, AgentLike } from '@primo-ai/sdk';
import type { Agent } from '../agent.js';
import { ParallelExecutor } from './executors/parallel.js';
import { AgentRouter, executeRouter } from './executors/router.js';

function isAgentInstance(agentLike: AgentLike): agentLike is Agent {
  return typeof agentLike === 'object' && agentLike !== null && 'run' in agentLike && typeof (agentLike as Agent).run === 'function';
}

interface ResolvedStep {
  name: string;
  type: 'sequential' | 'parallel' | 'router';
  agent?: Agent;
  agents?: Agent[];
  router?: AgentRouter;
  options?: OrchestrationStepOptions;
}

export class OrchestrationPipeline {
  private steps: ResolvedStep[] = [];
  private agentFactory?: (config: AgentLike) => Agent;

  constructor(options?: { agentFactory?: (config: AgentLike) => Agent }) { this.agentFactory = options?.agentFactory; }

  step(name: string, agent: AgentLike, options?: OrchestrationStepOptions): this;
  step(name: string, agents: AgentLike[], options?: OrchestrationStepOptions): this;
  step(name: string, router: AgentRouter, options?: OrchestrationStepOptions): this;
  step(name: string, agentOrAgentsOrRouter: AgentLike | AgentLike[] | AgentRouter, options?: OrchestrationStepOptions): this {
    if (agentOrAgentsOrRouter instanceof AgentRouter) { this.steps.push({ name, type: 'router', router: agentOrAgentsOrRouter, options }); return this; }
    if (Array.isArray(agentOrAgentsOrRouter)) { this.steps.push({ name, type: 'parallel', agents: agentOrAgentsOrRouter.map(a => this.resolveAgent(a)), options }); return this; }
    this.steps.push({ name, type: 'sequential', agent: this.resolveAgent(agentOrAgentsOrRouter), options }); return this;
  }

  async run(input: string, options?: OrchestrationOptions): Promise<OrchestrationResult> {
    const results: OrchestrationStepResult[] = [];
    let currentInput = input;
    const totalTokenUsage: TokenUsage = { input: 0, output: 0 };
    const sessionId = options?.sessionId ?? `orchestration-${Date.now()}`;
    for (const step of this.steps) {
      if (options?.signal?.aborted) throw new DOMException('Orchestration pipeline aborted', 'AbortError');
      const result = await this.executeStep(step, currentInput, sessionId, options?.signal);
      results.push(result);
      totalTokenUsage.input += result.tokenUsage.input;
      totalTokenUsage.output += result.tokenUsage.output;
      if (result.response && !result.error) currentInput = result.response;
      if (result.error && step.options?.failureStrategy === 'fail-fast') throw result.error;
    }
    return { response: results[results.length - 1]?.response ?? '', steps: results, totalTokenUsage, sessionId };
  }

  private async executeStep(step: ResolvedStep, input: string, sessionId: string, signal?: AbortSignal): Promise<OrchestrationStepResult> {
    try {
      if (step.type === 'sequential') {
        if (!step.agent) throw new Error(`Step "${step.name}" has no agent`);
        const result = await step.agent.run(input, { signal });
        return { stepName: step.name, response: result.response, tokenUsage: result.tokenUsage, sessionId: result.sessionId };
      }
      if (step.type === 'parallel') {
        if (!step.agents?.length) throw new Error(`Step "${step.name}" has no agents`);
        const executor = new ParallelExecutor(step.options);
        const parallelResults = await executor.execute({ name: step.name, agents: [] }, step.agents, input, { signal });
        const aggregated = await executor.aggregateResults(parallelResults);
        const totalUsage = parallelResults.reduce((acc, r) => ({ input: acc.input + r.tokenUsage.input, output: acc.output + r.tokenUsage.output }), { input: 0, output: 0 });
        return { stepName: step.name, response: aggregated, tokenUsage: totalUsage, sessionId };
      }
      if (step.type === 'router') {
        if (!step.router) throw new Error(`Step "${step.name}" has no router`);
        return executeRouter(step.router, input, {} as PipelineContext, { signal });
      }
      throw new Error('Unknown step type');
    } catch (error) {
      return { stepName: step.name, response: '', tokenUsage: { input: 0, output: 0 }, sessionId, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  private resolveAgent(agentLike: AgentLike): Agent {
    if (isAgentInstance(agentLike)) return agentLike;
    if (this.agentFactory) return this.agentFactory(agentLike);
    throw new Error('AgentLike is an AgentConfig but no agentFactory was provided.');
  }

  getStepNames(): string[] { return this.steps.map(s => s.name); }
  getStepCount(): number { return this.steps.length; }
}

export function createPipeline(options?: ConstructorParameters<typeof OrchestrationPipeline>[0]): OrchestrationPipeline {
  return new OrchestrationPipeline(options);
}
