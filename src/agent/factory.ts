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
import {
  createLoggingMiddleware,
  createTokenCountingMiddleware,
  createTimeoutMiddleware,
  type Middleware,
  type TimeoutMiddlewareOptions,
  type TokenCountingMiddlewareOptions,
} from '../middleware/index.js';
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
      const cfgModel = this.config.model;
      modelConfig = {
        model: typeof cfgModel.model === 'string' ? cfgModel.model : agentConfig.model,
        provider: typeof cfgModel.provider === 'string' ? cfgModel.provider : 'openai-compatible',
        apiKey: typeof cfgModel.apiKey === 'string' ? cfgModel.apiKey : agentConfig.apiKey,
        baseURL: typeof cfgModel.baseURL === 'string' ? cfgModel.baseURL : agentConfig.baseURL,
        temperature:
          typeof cfgModel.temperature === 'number' ? cfgModel.temperature : agentConfig.temperature,
        maxTokens:
          typeof cfgModel.maxTokens === 'number' ? cfgModel.maxTokens : agentConfig.maxTokens,
        timeout:
          typeof cfgModel.timeout === 'object' && cfgModel.timeout !== null
            ? cfgModel.timeout
            : undefined,
        tlsRejectUnauthorized:
          typeof cfgModel.tlsRejectUnauthorized === 'boolean'
            ? cfgModel.tlsRejectUnauthorized
            : undefined,
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
    const adapter = this.options.adapter ?? (await this.createAdapter(modelConfig, pluginManager));

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

    // Build middleware list: combine user provided + auto-added built-ins
    const middleware = [...(this.options.middleware ?? [])];

    // Always add logging middleware (configurable via env, defaults to enabled in dev)
    const loggingEnabled = process.env.NODE_ENV !== 'production' || true;
    middleware.push(createLoggingMiddleware(loggingEnabled));

    // Add timeout middleware if configured on model
    if (modelConfig.timeout?.total) {
      const timeoutConfig: TimeoutMiddlewareOptions = {
        timeoutMs: modelConfig.timeout.total,
      };
      middleware.push(createTimeoutMiddleware(timeoutConfig));
    }

    // Add token counting middleware by default
    const tokenConfig: TokenCountingMiddlewareOptions = {
      enabled: true,
    };
    middleware.push(createTokenCountingMiddleware(tokenConfig));

    const agent = new Agent(adapter, history, registry, {
      ...agentConfig,
      pluginManager,
      middleware,
      memoryManager,
    });

    this.log.info('Agent created successfully', { name: agentConfig.name });
    return agent;
  }

  private async createAdapter(
    config: ModelConfig,
    pluginManager: PluginManager
  ): Promise<LLMAdapter> {
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
        await pluginManager.trigger(
          'llm.request.before',
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
      timeout: mergedConfig.timeout as
        | { total?: number; firstToken?: number; chunk?: number }
        | undefined,
      tlsRejectUnauthorized: mergedConfig.tlsRejectUnauthorized as boolean | undefined,
      fetch: mergedConfig.fetch as
        | ((input: string | URL | Request, init?: RequestInit) => Promise<Response>)
        | undefined,
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

  static async create(
    config: AgentForgeConfig | AgentConfig,
    options?: AgentFactoryOptions
  ): Promise<Agent> {
    const factory = new AgentFactory(config, options);
    return factory.create();
  }

  static async fromConfig(
    config: AgentForgeConfig | AgentConfig,
    options?: AgentFactoryOptions
  ): Promise<Agent> {
    return this.create(config, options);
  }
}

export async function createAgent(
  config: AgentForgeConfig | AgentConfig,
  options?: AgentFactoryOptions
): Promise<Agent> {
  return AgentFactory.create(config, options);
}
