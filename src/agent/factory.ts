import { Agent } from './agent.js';
import { AIAdapter } from '../adapters/ai.js';
import { ToolRegistry } from '../registry.js';
import { InMemoryHistory } from '../history.js';
import { PluginManager } from '../plugin/index.js';
import { createLogger } from '../logger/index.js';
import {
  AgentForgeConfig,
  AgentConfig,
  ModelConfig,
  validateAgentConfig,
} from '../config/index.js';
import type { LLMAdapter, HistoryManager } from '../types';
import type { Middleware } from '../middleware/index.js';
import { allTools } from '../tools/index.js';

export interface AgentFactoryOptions {
  /**
   * Pre-configured adapter (will override config settings)
   */
  adapter?: LLMAdapter;
  /**
   * Pre-configured history manager
   */
  history?: HistoryManager;
  /**
   * Pre-configured tool registry
   */
  registry?: ToolRegistry;
  /**
   * Pre-configured plugin manager
   */
  pluginManager?: PluginManager;
  /**
   * Additional middleware to add
   */
  middleware?: Middleware[];
  /**
   * Auto-register built-in tools
   */
  registerBuiltinTools?: boolean;
}

export class AgentFactory {
  private config: AgentForgeConfig | AgentConfig;
  private options: AgentFactoryOptions;
  private log = createLogger('agent-factory');

  constructor(config: AgentForgeConfig | AgentConfig, options: AgentFactoryOptions = {}) {
    this.config = config;
    this.options = {
      registerBuiltinTools: true,
      ...options,
    };
  }

  /**
   * Create a new Agent instance with the provided configuration
   */
  create(): Agent {
    // Get validated agent config
    const agentConfig =
      'agent' in this.config ? this.config.agent : validateAgentConfig(this.config);

    // Merge model config from top-level if it exists
    let modelConfig: ModelConfig;
    if ('model' in this.config && this.config.model && typeof this.config.model === 'object') {
      modelConfig = {
        model: this.config.model.model || agentConfig.model,
        apiKey: this.config.model.apiKey || agentConfig.apiKey,
        baseURL: this.config.model.baseURL || agentConfig.baseURL,
        temperature: this.config.model.temperature ?? agentConfig.temperature,
        maxTokens: this.config.model.maxTokens ?? agentConfig.maxTokens,
      };
    } else {
      modelConfig = {
        model: agentConfig.model,
        apiKey: agentConfig.apiKey,
        baseURL: agentConfig.baseURL,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
      };
    }

    // Create or use provided adapter
    const adapter = this.options.adapter ?? this.createAdapter(modelConfig);

    // Create or use provided history
    const history = this.options.history ?? this.createHistory();

    // Create or use provided registry
    const registry = this.options.registry ?? this.createRegistry(agentConfig);

    // Create or use provided plugin manager
    const pluginManager = this.options.pluginManager ?? new PluginManager();

    // Create agent
    const agent = new Agent(adapter, history, registry, {
      ...agentConfig,
      pluginManager,
      middleware: this.options.middleware,
    });

    this.log.info('Agent created successfully', { name: agentConfig.name });

    return agent;
  }

  /**
   * Create LLM adapter from config
   */
  private createAdapter(config: ModelConfig): LLMAdapter {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey && !config.baseURL) {
      this.log.warn(
        'No API key provided for LLM adapter. Set OPENAI_API_KEY environment variable or provide it in config.'
      );
    }

    const adapter = new AIAdapter({
      model: config.model,
      apiKey,
      baseURL: config.baseURL,
    });

    return adapter;
  }

  /**
   * Create history manager
   */
  private createHistory(): HistoryManager {
    return new InMemoryHistory();
  }

  /**
   * Create and configure tool registry
   */
  private createRegistry(config: AgentConfig): ToolRegistry {
    const registry = new ToolRegistry();

    // Register built-in tools if enabled
    if (this.options.registerBuiltinTools) {
      registry.register(allTools);
      this.log.debug('Registered all built-in tools', { count: allTools.length });
    }

    // TODO: Implement tool registration from config
    // For now, it's expected that users register additional tools manually

    return registry;
  }

  /**
   * Static helper to create an agent quickly
   */
  static create(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Agent {
    const factory = new AgentFactory(config, options);
    return factory.create();
  }

  /**
   * Static helper to create an agent from a loaded configuration
   */
  static fromConfig(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Agent {
    return this.create(config, options);
  }
}

/**
 * Create an agent using the factory
 */
export function createAgent(
  config: AgentForgeConfig | AgentConfig,
  options?: AgentFactoryOptions
): Agent {
  return AgentFactory.create(config, options);
}
