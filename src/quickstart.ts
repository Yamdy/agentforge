/**
 * AgentForge Quickstart - Zero-configuration API
 *
 * Provides a Mastra-like DX for creating agents with minimal boilerplate.
 *
 * @example
 * ```typescript
 * import { Agent, tool } from '@primo512109/agentforge/quickstart';
 * import { z } from 'zod';
 *
 * const agent = new Agent({
 *   name: 'cat-expert',
 *   model: 'openai/gpt-4o-mini',
 *   systemPrompt: 'You are a helpful cat expert.',
 *   tools: {
 *     catFact: tool({
 *       description: 'Fetches cat facts',
 *       parameters: z.object({}),
 *       execute: async () => ({ fact: await getCatFact() }),
 *     }),
 *   },
 * });
 *
 * const result = await agent.generate('Tell me a cat fact');
 * console.log(result.text);
 * ```
 */

import { z } from 'zod';
import type { ToolDefinition, ToolContext } from './core/interfaces.js';

// ============================================================
import { createAgent } from './api/create-agent.js';
import type {
  AgentConfig,
  Agent as AgentInterface,
} from './api/types.js';
import {
  getLLMAdapterFactory,
  openaiAdapterFactory,
  anthropicAdapterFactory,
} from './adapters/index.js';

// ============================================================
// Auto-register built-in providers
// ============================================================

let providersRegistered = false;

function ensureProviders(): void {
  if (providersRegistered) return;
  const factory = getLLMAdapterFactory();
  if (!factory.hasProvider('openai')) factory.register('openai', openaiAdapterFactory);
  if (!factory.hasProvider('anthropic')) factory.register('anthropic', anthropicAdapterFactory);
  providersRegistered = true;
}

// ============================================================
// Tool Helper
// ============================================================

/**
 * Create a tool definition with minimal boilerplate.
 *
 * The tool name is automatically set from the key name in the Agent's `tools` record.
 *
 * @example
 * ```typescript
 * const myTool = tool({
 *   description: 'Does something useful',
 *   parameters: z.object({ input: z.string() }),
 *   execute: async (args) => ({ result: `Processed ${args.input}` }),
 * });
 * ```
 */
export function tool(config: {
  description: string;
  parameters: z.ZodType;
  execute: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<string> | string;
}): ToolDefinition {
  return {
    name: '__placeholder__', // Will be overridden by key name in Agent
    description: config.description,
    parameters: config.parameters,
    execute: async (args: unknown, ctx?: ToolContext): Promise<string> => {
      const result = await config.execute(args as Record<string, unknown>, ctx);
      return typeof result === 'string' ? result : JSON.stringify(result);
    },
  };
}

// ============================================================
// Generate Result Type
// ============================================================

/**
 * Result from Agent.generate()
 */
export interface GenerateResult {
  /** The generated text response */
  text: string;
  /** Token usage information (if available) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// ============================================================
// Agent Class
// ============================================================

/**
 * A simplified Agent class with Mastra-like DX.
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   name: 'my-agent',
 *   model: 'openai/gpt-4o-mini',
 *   systemPrompt: 'You are a helpful assistant.',
 *   tools: { myTool },
 * });
 *
 * // Generate mode
 * const result = await agent.generate('Hello');
 * console.log(result.text);
 *
 * // Stream mode
 * await agent.stream('Hello', {
 *   onText: (delta) => process.stdout.write(delta),
 *   onComplete: (result) => console.log('Done:', result),
 * });
 * ```
 */
export class Agent {
  private agent: AgentInterface;

  constructor(config: {
    /** Agent name (used for logging and identification) */
    name: string;
    /**
     * Model specification string.
     * Format: 'provider/model-name' or just 'model-name' (defaults to openai)
     * Examples: 'openai/gpt-4o-mini', 'anthropic/claude-3-5-sonnet', 'gpt-4o'
     */
    model: string;
    /** API key for the model provider (or set via environment variable) */
    apiKey?: string;
    /** Base URL for the API (optional, for custom endpoints) */
    baseUrl?: string;
    /** System prompt / instructions for the agent */
    systemPrompt?: string;
    /** Tools available to the agent (key = tool name, value = tool definition) */
    tools?: Record<string, ToolDefinition>;
    /** Maximum steps before termination (default: 10) */
    maxSteps?: number;
    /** Enable parallel tool execution (default: true) */
    parallelToolCalls?: boolean;
  }) {
    ensureProviders();

    // Parse model string (e.g., 'openai/gpt-4o-mini' → { provider: 'openai', model: 'gpt-4o-mini' })
    const slashIndex = config.model.indexOf('/');
    let providerName: string;
    let modelName: string;

    if (slashIndex !== -1) {
      providerName = config.model.substring(0, slashIndex);
      modelName = config.model.substring(slashIndex + 1);
    } else {
      // No provider specified, default to openai
      providerName = 'openai';
      modelName = config.model;
    }

    // Build tools array with names from keys
    const tools: ToolDefinition[] = config.tools
      ? Object.entries(config.tools).map(([name, t]) => ({ ...t, name }))
      : [];

    // Create agent config - handle exactOptionalPropertyTypes
    const agentConfig: AgentConfig = {
      name: config.name,
      model: {
        provider: providerName,
        model: modelName,
        ...(config.apiKey !== undefined && { apiKey: config.apiKey }),
        ...(config.baseUrl !== undefined && { baseUrl: config.baseUrl }),
      },
      ...(config.systemPrompt !== undefined && { systemPrompt: config.systemPrompt }),
      maxSteps: config.maxSteps ?? 10,
      parallelToolCalls: config.parallelToolCalls ?? true,
      tools,
      streaming: false,
    };

    this.agent = createAgent(agentConfig);
  }

  /**
   * Generate a response (Promise-based).
   *
   * @param input - The user message
   * @returns The generated response with text and optional usage info
   */
  async generate(input: string): Promise<GenerateResult> {
    const text = await this.agent.run(input);
    return { text };
  }

  /**
   * Cancel the current execution.
   */
  cancel(): void {
    this.agent.cancel();
  }

  /**
   * Pause the current execution.
   */
  pause(): Promise<void> {
    return this.agent.pause();
  }

  /**
   * Resume from a pause.
   */
  resume(): void {
    this.agent.resume();
  }
}
