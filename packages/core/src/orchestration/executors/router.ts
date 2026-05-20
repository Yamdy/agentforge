import type {
  RouterConfig,
  OrchestrationStepResult,
  PipelineContext,
  AgentLike,
} from '@primo-ai/sdk';
import type { Agent } from '../../agent.js';

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
 * AgentRouter routes input to different agents based on classification.
 * Supports conditional orchestration patterns.
 */
export class AgentRouter {
  private readonly routes: Map<string, Agent>;
  private readonly defaultAgent?: Agent;
  private readonly classifier: (input: string, context: PipelineContext) => string | Promise<string>;

  constructor(config: RouterConfig, agentFactory?: (config: AgentLike) => Agent) {
    this.routes = new Map();
    this.classifier = config.classifier;

    // Convert route configs to Agent instances
    for (const [key, agentLike] of Object.entries(config.routes)) {
      if (isAgentInstance(agentLike)) {
        this.routes.set(key, agentLike);
      } else if (agentFactory) {
        this.routes.set(key, agentFactory(agentLike));
      } else {
        throw new Error(
          `Route "${key}" is an AgentConfig but no agentFactory provided. ` +
          `Pass Agent instances or provide a factory function.`
        );
      }
    }

    // Handle default agent
    if (config.default) {
      if (isAgentInstance(config.default)) {
        this.defaultAgent = config.default;
      } else if (agentFactory) {
        this.defaultAgent = agentFactory(config.default);
      } else {
        throw new Error(
          `Default route is an AgentConfig but no agentFactory provided.`
        );
      }
    }
  }

  /**
   * Route input to appropriate agent based on classifier.
   * @param input Input string to classify
   * @param context Pipeline context for classification
   * @returns The selected agent
   * @throws Error if no matching route and no default agent
   */
  async route(input: string, context: PipelineContext): Promise<Agent> {
    const routeKey = await this.classifier(input, context);
    const agent = this.routes.get(routeKey);

    if (!agent) {
      if (this.defaultAgent) {
        return this.defaultAgent;
      }
      throw new Error(
        `No route found for key "${routeKey}" and no default agent configured. ` +
        `Available routes: ${Array.from(this.routes.keys()).join(', ')}`
      );
    }

    return agent;
  }

  /**
   * Get all available route keys.
   */
  getRouteKeys(): string[] {
    return Array.from(this.routes.keys());
  }

  /**
   * Check if a route exists for the given key.
   */
  hasRoute(key: string): boolean {
    return this.routes.has(key) || !!this.defaultAgent;
  }
}

/**
 * Execute a router step.
 * Routes input to appropriate agent and executes it.
 */
export async function executeRouter(
  router: AgentRouter,
  input: string,
  context: PipelineContext,
  options?: { signal?: AbortSignal }
): Promise<OrchestrationStepResult> {
  try {
    const agent = await router.route(input, context);
    const result = await agent.run(input, options);

    return {
      stepName: 'routed',
      response: result.response,
      tokenUsage: result.tokenUsage,
      sessionId: result.sessionId,
    };
  } catch (error) {
    return {
      stepName: 'routed',
      response: '',
      tokenUsage: { input: 0, output: 0 },
      sessionId: '',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
