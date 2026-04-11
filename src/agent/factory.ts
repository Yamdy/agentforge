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
import type { MemoryManager } from '../memory/manager.js';
import type { MemoryManagerConfig } from '../memory/types.js';
import { createMemory } from '../memory/manager.js';

export interface AgentFactoryOptions {
  adapter?: LLMAdapter;
  history?: HistoryManager;
  registry?: ToolRegistry;
  pluginManager?: PluginManager;
  middleware?: Middleware[];
  registerBuiltinTools?: boolean;
  memoryManager?: MemoryManager;
  memoryConfig?: MemoryManagerConfig;
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

  async create(): Promise<Agent> {
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

    const pluginManager = this.options.pluginManager ?? new PluginManager();
    const adapter = this.options.adapter ?? await this.createAdapter(modelConfig, pluginManager);

    let memoryManager = this.options.memoryManager;
    let history: HistoryManager;

    if (memoryManager) {
      history = memoryManager;
    } else if (this.options.memoryConfig) {
      memoryManager = createMemory(this.options.memoryConfig);
      await memoryManager.load();
      history = memoryManager;
    } else {
      history = this.options.history ?? this.createHistory();
    }

    const registry = this.options.registry ?? this.createRegistry(agentConfig);

    const agent = new Agent(adapter, history, registry, {
      ...agentConfig,
      pluginManager,
      middleware: this.options.middleware,
      memoryManager,
    });

    this.log.info('Agent created successfully', { name: agentConfig.name });
    return agent;
  }

  private async createAdapter(config: ModelConfig, pluginManager: PluginManager): Promise<LLMAdapter> {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey && !config.baseURL) {
      this.log.warn(
        'No API key provided for LLM adapter. Set OPENAI_API_KEY environment variable or provide it in config.'
      );
    }

    const providerCtx = { model: config.model, apiKey, baseURL: config.baseURL };
    const providerResults = await pluginManager.collectProviders(providerCtx);

    const mergedConfig: Record<string, unknown> = {
      model: config.model,
      apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout,
      tlsRejectUnauthorized: config.tlsRejectUnauthorized,
    };

    const interceptors: RequestInterceptor[] = [];

    for (const result of providerResults) {
      if (result.baseURL) mergedConfig.baseURL = result.baseURL;
      if (result.apiKey) mergedConfig.apiKey = result.apiKey;
      if (result.fetch) mergedConfig.fetch = result.fetch;
      if (result.timeout) mergedConfig.timeout = result.timeout;
      if (result.tlsRejectUnauthorized !== undefined) {
        mergedConfig.tlsRejectUnauthorized = result.tlsRejectUnauthorized;
      }
      if (result.headers) {
        const staticHeaders = result.headers;
        interceptors.push({
          beforeRequest(ctx) {
            return { ...ctx, headers: { ...staticHeaders, ...ctx.headers } };
          },
        });
      }
    }

    const hookInterceptor: RequestInterceptor = {
      async beforeRequest(ctx) {
        const output = { headers: { ...ctx.headers }, body: { ...ctx.body } };
        await pluginManager.trigger('llm.request.before',
          { headers: ctx.headers, body: ctx.body },
          output
        );
        return { ...ctx, headers: output.headers, body: output.body };
      },
    };
    interceptors.push(hookInterceptor);

    return new AIAdapter({
      model: mergedConfig.model as string,
      apiKey: mergedConfig.apiKey as string,
      baseURL: mergedConfig.baseURL as string | undefined,
      timeout: mergedConfig.timeout as { total?: number; firstToken?: number; chunk?: number } | undefined,
      tlsRejectUnauthorized: mergedConfig.tlsRejectUnauthorized as boolean | undefined,
      fetch: mergedConfig.fetch as ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined,
      interceptors,
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

  static async create(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Promise<Agent> {
    const factory = new AgentFactory(config, options);
    return factory.create();
  }

  static async fromConfig(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Promise<Agent> {
    return this.create(config, options);
  }
}

export async function createAgent(
  config: AgentForgeConfig | AgentConfig,
  options?: AgentFactoryOptions
): Promise<Agent> {
  return AgentFactory.create(config, options);
}
