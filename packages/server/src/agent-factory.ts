import { createAgent } from '@primo512109/agentforge';
import type { Agent, Message, L1AgentConfig, DefaultHITLController } from '@primo512109/agentforge';

/**
 * Options for creating an ephemeral agent.
 */
export interface AgentFactoryOptions {
  /** Conversation history for multi-turn context */
  history?: Message[];
  /** HITL controller for human-in-the-loop interactions */
  hitlController?: DefaultHITLController;
}

/**
 * Factory for creating ephemeral agents from L1 configs.
 *
 * IMPORTANT: We use `createAgent()` directly instead of `loadAgentFromConfig()`
 * because `loadAgentFromConfig()` does NOT support the `history` field —
 * it validates against `L1AgentConfigSchema` which has no `history` property.
 * Multi-turn conversation requires passing accumulated session history to
 * each newly created agent, so we must convert L1→L2 config manually and
 * use `createAgent()` which does support `history`.
 */
export class AgentFactory {
  /**
   * Creates an ephemeral agent from an L1 config with optional history.
   *
   * Each chat turn creates a new agent with accumulated session history.
   * The agent is destroyed after the response stream completes.
   */
  async create(
    config: L1AgentConfig,
    options?: AgentFactoryOptions,
  ): Promise<Agent> {
    // Convert L1 config to L2 AgentConfig
    // Only include defined optional fields (exactOptionalPropertyTypes)
    const agentConfig: Record<string, unknown> = {
      name: config.name,
      model: config.model,
      maxSteps: config.maxSteps,
      streaming: config.streaming,
      parallelToolCalls: config.parallelToolCalls,
    };

    if (config.systemPrompt !== undefined) {
      agentConfig.systemPrompt = config.systemPrompt;
    }
    if (config.timeout !== undefined) {
      agentConfig.timeout = config.timeout;
    }
    if (config.preset !== undefined) {
      agentConfig.preset = config.preset;
    }
    if (config.tools.length > 0) {
      agentConfig.tools = config.tools;
    }
    if (config.retry !== undefined) {
      agentConfig.retry = config.retry.maxAttempts;
      agentConfig.retryDelay = config.retry.delayMs;
    }

    // History from session (multi-turn conversation)
    if (options?.history && options.history.length > 0) {
      agentConfig.history = options.history;
    }

    // HITL support — pass controller if provided
    if (options?.hitlController) {
      agentConfig.hitl = { controller: options.hitlController };
    }

    return createAgent(agentConfig as unknown as Parameters<typeof createAgent>[0]);
  }
}