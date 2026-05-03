/**
 * AgentForge L2 API - createAgent()
 *
 * Configuration-driven Agent factory.
 * Creates a fully configured Agent from a declarative config.
 *
 * Imperative implementation with while(true) loop.
 * Plugins register via HookRegistry, events via AgentEventEmitter.
 *
 * @module
 */

import type { AgentContext, AgentLoopState } from '../core/index.js';
import type { LLMAdapter } from '../core/interfaces.js';
import { SimpleToolRegistry, createApplicationServices } from '../core/context-builder.js';
import { ConsoleTracer, ConsoleMetrics, NoopTracer, NoopMetrics } from '../core/defaults.js';
import { generateId } from '../core/events.js';
import { AgentEventEmitter } from '../core/events.js';
import { HookRegistry } from '../core/hooks.js';
import { createAgentLoop, type AgentLoopConfig, type AgentLoop } from '../loop/agent-loop.js';
import { createLLMAdapter, parseModelSpec } from '../adapters/index.js';
import { createPluginManager, createPluginContext, type Plugin } from '../plugins/index.js';
import { PluginLoader } from '../plugins/plugin-loader.js';
import type { PluginSpec } from '../plugins/plugin-loader.js';
import {
  createMemoryPlugin,
  createSkillsPlugin,
  createSummarizationPlugin,
} from '../plugins/index.js';
import { FileBasedMemory } from '../memory/index.js';
import { createMemorySearchTool } from '../tools/memory-search.js';
import { PlanNotebook } from '../planning/plan-notebook.js';
import {
  type AgentConfig,
  type Agent as AgentInterface,
  type RunHandlers,
  DEFAULT_AGENT_CONFIG,
  AgentConfigError,
} from './types.js';

// ============================================================
// Resolved Config
// ============================================================

interface ResolvedConfig {
  name: string;
  model: { provider: string; model: string };
  llmOptions: Record<string, unknown> | undefined;
  maxSteps: number;
  maxLLMRepairAttempts: number;
  parallelToolCalls: boolean;
  streaming: boolean;
  tokenBudget: number | undefined;
  fallbackModel: { provider: string; model: string } | undefined;
  toolNames: string[];
  systemPrompt: string | undefined;
  history: import('../core/events.js').Message[] | undefined;
}

function resolveConfig(raw: AgentConfig): ResolvedConfig {
  const defaults = DEFAULT_AGENT_CONFIG;
  const rawModel = raw.model as { provider?: string; model?: string } | string;

  let model: { provider: string; model: string };
  if (typeof rawModel === 'string') {
    model = parseModelSpec(rawModel);
  } else if (rawModel && typeof rawModel === 'object') {
    model = {
      provider: rawModel.provider ?? 'openai',
      model: rawModel.model ?? 'gpt-4o',
    };
  } else {
    model = { provider: 'openai', model: 'gpt-4o' };
  }

  return {
    name: raw.name ?? defaults.name ?? 'agent',
    model,
    llmOptions: raw.llmOptions,
    maxSteps: raw.maxSteps ?? defaults.maxSteps ?? 10,
    maxLLMRepairAttempts: raw.maxLLMRepairAttempts ?? defaults.maxLLMRepairAttempts ?? 3,
    parallelToolCalls: raw.parallelToolCalls ?? defaults.parallelToolCalls ?? true,
    streaming: raw.streaming ?? defaults.streaming ?? false,
    tokenBudget: raw.tokenBudget,
    fallbackModel: undefined,
    toolNames: (raw.tools ?? []).map(t => (typeof t === 'string' ? t : t.name)),
    systemPrompt: raw.systemPrompt,
    history: raw.history,
  };
}

// ============================================================
// createAgent
// ============================================================

export function createAgent(config: AgentConfig, services?: Partial<AgentContext>): AgentInterface {
  const resolved = resolveConfig(config);
  const sessionId = generateId('session');
  const hookRegistry = new HookRegistry();

  // ── Build LLM adapter ──
  let llm: LLMAdapter;
  if (services?.llm) {
    llm = services.llm;
  } else {
    const modelSpec =
      typeof config.model === 'string'
        ? config.model
        : `${config.model?.provider ?? 'openai'}/${config.model?.model ?? 'gpt-4o'}`;
    llm = createLLMAdapter(modelSpec, services as unknown as Record<string, unknown>);
  }

  // ── Wire tracing/metrics ──
  const appServices = services?.services ?? createApplicationServices({});

  // Set Noop defaults if not configured
  if (!appServices.tracer) appServices.tracer = new NoopTracer();
  if (!appServices.metrics) appServices.metrics = new NoopMetrics();

  // Handle metrics config
  if (config.metrics) {
    if (typeof config.metrics === 'object' && config.metrics.customMetrics) {
      appServices.metrics = config.metrics.customMetrics;
    } else if (config.metrics === true || typeof config.metrics === 'object') {
      appServices.metrics = new ConsoleMetrics();
    }
  } else if (config.preset === 'development') {
    appServices.metrics = new ConsoleMetrics();
  }

  // ── Build tool registry ──
  const tools = new SimpleToolRegistry();

  // ── Build AgentContext ──
  const memoryStub: import('../core/interfaces.js').MemoryStore = {
    add: () => {},
    getAll: () => [],
    getRecent: () => [],
    clear: () => {},
    count: () => 0,
  };
  const pauseStub: import('../core/interfaces.js').PauseController = {
    pause: () => {},
    resume: () => {},
    isPaused: () => false,
    onResume: () => () => {},
  };
  const ctx: AgentContext = {
    sessionId,
    agentName: resolved.name,
    memory: services?.memory ?? memoryStub,
    pauseController: services?.pauseController ?? pauseStub,
    services: appServices,
    llm,
    tools,
    hookRegistry,
    ...services,
  };

  // ── Validate: permissionPolicy requires permissionController ──
  if (ctx.permissionPolicy && !ctx.permissionController) {
    throw new AgentConfigError(
      'permissionPolicy requires permissionController. Without a controller, HITL "ask" decisions cannot be resolved.'
    );
  }

  // ── Register tools ──
  if (resolved.toolNames.length > 0 && services?.tools) {
    for (const name of resolved.toolNames) {
      const def = services.tools.get(name);
      if (def) tools.register(def);
    }
  }

  // ── Auto-register memory_search for pointer-indexed compaction ──
  if (
    config.compaction?.strategy === 'pointer-indexed' &&
    config.compaction.vectorStore &&
    config.compaction.embeddingModel
  ) {
    const memTools = createMemorySearchTool(
      config.compaction.vectorStore,
      config.compaction.embeddingModel
    );
    for (const t of memTools) {
      tools.register(t);
    }
  }

  // ── Plugins ──
  const allPlugins: Plugin[] = [...(config.plugins ?? [])];

  if (config.memory?.enabled && config.memory.sources.length > 0) {
    const memory = new FileBasedMemory(config.memory);
    allPlugins.push(createMemoryPlugin(memory, config.memory));
  }

  if (config.skills?.sources && config.skills.sources.length > 0) {
    allPlugins.push(createSkillsPlugin(config.skills.sources));
  }

  if (config.summarization) {
    allPlugins.push(createSummarizationPlugin(config.summarization));
  }

  // ── Create Agent Loop (before plugins so they can register on the emitter) ──
  const loopConfig: AgentLoopConfig = {
    model: resolved.model,
    maxSteps: resolved.maxSteps,
    maxLLMRepairAttempts: resolved.maxLLMRepairAttempts,
    parallelToolCalls: resolved.parallelToolCalls,
    streaming: resolved.streaming,
    systemPrompt: resolved.systemPrompt,
    history: resolved.history,
  };
  if (resolved.tokenBudget !== undefined) loopConfig.tokenBudget = resolved.tokenBudget;
  if (resolved.fallbackModel !== undefined) loopConfig.fallbackModel = resolved.fallbackModel;

  const loop: AgentLoop = createAgentLoop(ctx, loopConfig);

  // ── Build plugin pipeline (after loop so observer bridge uses real emitter) ──
  if (allPlugins.length > 0) {
    const manager = createPluginManager();
    const pluginCtx = createPluginContext({
      sessionId,
      agentName: resolved.name,
      ...(appServices.tracer ? { tracer: appServices.tracer } : {}),
      ...(appServices.metrics ? { metrics: appServices.metrics } : {}),
    });
    manager.setContext(pluginCtx);
    for (const plugin of allPlugins) {
      manager.register(plugin);
    }
    // Adapter: loop.on/onAny → AgentEventEmitter interface
    const emitterAdapter = {
      on: loop.on.bind(loop) as (type: string, fn: (e: unknown) => void) => () => void,
      onAny: loop.onAny.bind(loop),
      emit: () => Promise.resolve(),
      clear: () => {},
    } as const;
    manager.buildPipeline(hookRegistry, emitterAdapter as unknown as AgentEventEmitter);
  }

  // ── Dynamic Plugin Loading (pluginSpecs: PluginSpec[]) ──
  // Store loading promise so run() can await it before starting
  let pluginLoadPromise: Promise<void> = Promise.resolve();
  // Store OTel initialization promise for exporter='otel' path
  let tracerInitPromise: Promise<void> = Promise.resolve();

  // Handle tracing config (must happen BEFORE plugin loading since plugins use tracer)
  if (config.tracing) {
    if (typeof config.tracing === 'object' && config.tracing.customTracer) {
      // exporter === 'custom'
      appServices.tracer = config.tracing.customTracer;
    } else if (typeof config.tracing === 'object' && config.tracing.exporter === 'none') {
      // exporter === 'none' — explicitly disable, keep NoopTracer (already set above)
    } else if (typeof config.tracing === 'object' && config.tracing.exporter === 'otel') {
      // exporter === 'otel' — lazy-load OTel SDK, store promise for await in run()
      const tracing = config.tracing;
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
      tracerInitPromise = import('../observability/tracers/otel-tracer.js')
        .then(async ({ OTelTracer }) => {
          const otelTracer = new OTelTracer();
          const otelConfig: import('../observability/tracers/otel-tracer.js').OTelConfig = {
            endpoint: tracing.endpoint ?? '',
          };
          if (tracing.serviceName !== undefined) otelConfig.serviceName = tracing.serviceName;
          if (tracing.headers !== undefined) otelConfig.headers = tracing.headers;
          if (tracing.sampler !== undefined) otelConfig.sampler = tracing.sampler;
          await otelTracer.configure(otelConfig);
          appServices.tracer = otelTracer;
        })
        .catch((_err: unknown) => {
          // OTel SDK load failed — fall back to ConsoleTracer for visibility
          appServices.tracer = new ConsoleTracer();
        });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    } else if (
      config.tracing === true ||
      (typeof config.tracing === 'object' && config.tracing.exporter === 'console')
    ) {
      appServices.tracer = new ConsoleTracer();
    }
  } else if (config.preset === 'development') {
    appServices.tracer = new ConsoleTracer();
  }
  const specs: PluginSpec[] = [...(config.pluginSpecs ?? [])];
  if (specs.length > 0) {
    const pluginCtx = createPluginContext({
      sessionId,
      agentName: resolved.name,
      ...(appServices.tracer ? { tracer: appServices.tracer } : {}),
      ...(appServices.metrics ? { metrics: appServices.metrics } : {}),
    });
    // Use AgentEventEmitter interface directly instead of adapter cast
    pluginLoadPromise = PluginLoader.loadAll(specs, pluginCtx, hookRegistry, {
      on: loop.on.bind(loop),
      onAny: loop.onAny.bind(loop),
      emit: () => Promise.resolve(),
      clear: () => {},
      eventNames: () => [],
      listenerCount: () => 0,
    } as unknown as AgentEventEmitter).then(() => {});
  }

  // ── Register plugin lifecycle hooks on loop emitter ──
  for (const plugin of allPlugins) {
    if (!plugin.enabled) continue;
    if (plugin.requestHooks) {
      for (const hook of plugin.requestHooks) {
        hookRegistry.registerRequest(hook);
      }
    }
    if (plugin.toolHooks) {
      for (const hook of plugin.toolHooks) {
        hookRegistry.registerTool(hook);
      }
    }
    if (plugin.lifecycleHooks) {
      hookRegistry.registerLifecycle(plugin.lifecycleHooks);
    }
  }

  // ── PlanNotebook auto-wiring ──
  if (ctx.planner) {
    const notebook = new PlanNotebook(ctx.planner, {
      availableTools: resolved.toolNames,
      maxSteps: resolved.maxSteps,
    });
    notebook.registerTools(ctx.tools);
    hookRegistry.registerRequest(notebook.planHintHook);
  }

  // ── Return Agent interface ──
  return {
    async run(input: string, handlers?: RunHandlers): Promise<string> {
      // Ensure OTel tracer is initialized (for exporter='otel') and dynamic plugins are loaded
      await tracerInitPromise;
      await pluginLoadPromise;
      if (handlers) {
        if (handlers.onToken) loop.on('llm.stream.text', e => handlers.onToken!(e.delta));
        if (handlers.onToolCall) loop.on('tool.call', handlers.onToolCall);
        if (handlers.onToolResult) loop.on('tool.result', handlers.onToolResult);
        if (handlers.onComplete) loop.on('agent.complete', e => handlers.onComplete!(e.output));
        if (handlers.onError) loop.on('agent.error', handlers.onError);
        if (handlers.onEvent) loop.onAny(handlers.onEvent);
      }
      return loop.run(input);
    },
    on: loop.on.bind(loop),
    cancel: loop.cancel.bind(loop),
    pause: () => {
      loop.pause();
      return Promise.resolve();
    },
    resume: loop.resume.bind(loop),
    getState: (): AgentLoopState | null => loop.getState(),
    getStatus: (): string => loop.getStatus(),
    onStateChange: (fn: (from: string, to: string) => void): (() => void) => loop.onStateChange(fn),

    /** @deprecated Internal context access for backward compat with tests */
    ctx,

    destroy: loop.destroy.bind(loop),
  };
}
