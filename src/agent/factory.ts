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
import type { LLMAdapter, HistoryManager, RequestInterceptor } from '../types';
import type { Middleware } from '../middleware/index.js';
import { allTools } from '../tools/index.js';

export interface AgentFactoryOptions {
  adapter?: LLMAdapter;
  history?: HistoryManager;
  registry?: ToolRegistry;
  pluginManager?: PluginManager;
  middleware?: Middleware[];
  registerBuiltinTools?: boolean;
  interceptors?: RequestInterceptor[];
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

  create(): Agent {
    const agentConfig =
      'agent' in this.config ? this.config.agent : validateAgentConfig(this.config);

    let modelConfig: ModelConfig;
    if ('model' in this.config && this.config.model && typeof this.config.model === 'object') {
      const cfgModel = this.config.model as Record<string, unknown>;
      modelConfig = {
        model: (cfgModel.model as string) || agentConfig.model,
        provider: (cfgModel.provider as string) ?? 'openai-compatible',
        apiKey: (cfgModel.apiKey as string) || agentConfig.apiKey,
        baseURL: (cfgModel.baseURL as string) || agentConfig.baseURL,
        temperature: (cfgModel.temperature as number) ?? agentConfig.temperature,
        maxTokens: (cfgModel.maxTokens as number) ?? agentConfig.maxTokens,
        timeout: cfgModel.timeout as { total?: number; firstToken?: number; chunk?: number } | undefined,
        tlsRejectUnauthorized: cfgModel.tlsRejectUnauthorized as boolean | undefined,
      };
    } else {
      modelConfig = {
        model: agentConfig.model,
        provider: 'openai-compatible',
        apiKey: agentConfig.apiKey,
        baseURL: agentConfig.baseURL,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
      };
    }

    const adapter = this.options.adapter ?? this.createAdapter(modelConfig);
    const history = this.options.history ?? this.createHistory();
    const registry = this.options.registry ?? this.createRegistry(agentConfig);
    const pluginManager = this.options.pluginManager ?? new PluginManager();

    const agent = new Agent(adapter, history, registry, {
      ...agentConfig,
      pluginManager,
      middleware: this.options.middleware,
    });

    this.log.info('Agent created successfully', { name: agentConfig.name });
    return agent;
  }

  private createAdapter(config: ModelConfig): LLMAdapter {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey && !config.baseURL) {
      this.log.warn(
        'No API key provided for LLM adapter. Set OPENAI_API_KEY environment variable or provide it in config.'
      );
    }

    return new AIAdapter({
      model: config.model,
      apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout,
      tlsRejectUnauthorized: config.tlsRejectUnauthorized,
      interceptors: this.options.interceptors,
    });
  }

  private createHistory(): HistoryManager {
    return new InMemoryHistory();
  }

  private createRegistry(_config: AgentConfig): ToolRegistry {
    const registry = new ToolRegistry();

    if (this.options.registerBuiltinTools) {
      registry.register(allTools);
      this.log.debug('Registered all built-in tools', { count: allTools.length });
    }

    return registry;
  }

  static create(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Agent {
    const factory = new AgentFactory(config, options);
    return factory.create();
  }

  static fromConfig(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Agent {
    return this.create(config, options);
  }
}

export function createAgent(
  config: AgentForgeConfig | AgentConfig,
  options?: AgentFactoryOptions
): Agent {
  return AgentFactory.create(config, options);
}
