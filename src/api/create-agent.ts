/**
 * AgentForge L2 API - createAgent()
 *
 * Configuration-driven Agent factory.
 * Creates a fully configured Agent from a declarative config.
 *
 * Imperative implementation: no RxJS, no operators.
 * Plugins register via HookRegistry, events via AgentEventEmitter.
 *
 * @module
 */

import type { AgentContext, AgentLoopState } from '../core/index.js';
import type { LLMAdapter } from '../core/interfaces.js';
import {
  SimpleToolRegistry,
  createApplicationServices,
} from '../core/context-builder.js';
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
import {
  type AgentConfig,
  type Agent as AgentInterface,
  type RunHandlers,
  DEFAULT_AGENT_CONFIG,
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
    name: raw.name ?? (defaults as any).name ?? 'agent',
    model,
    llmOptions: raw.llmOptions,
    maxSteps: raw.maxSteps ?? (defaults as any).maxSteps ?? 10,
    maxLLMRepairAttempts: raw.maxLLMRepairAttempts ?? (defaults as any).maxLLMRepairAttempts ?? 3,
    parallelToolCalls: raw.parallelToolCalls ?? (defaults as any).parallelToolCalls ?? true,
    streaming: raw.streaming ?? (defaults as any).streaming ?? false,
    tokenBudget: raw.timeout, // Reuse timeout as token budget for now
    fallbackModel: undefined,
    toolNames: (raw.tools ?? []).map(t => (typeof t === 'string' ? t : t.name)),
    systemPrompt: raw.systemPrompt,
    history: raw.history,
  };
}

// ============================================================
// createAgent
// ============================================================

export function createAgent(
  config: AgentConfig,
  services?: Partial<AgentContext>
): AgentInterface {
  const resolved = resolveConfig(config);
  const sessionId = generateId('session');
  const hookRegistry = new HookRegistry();

  // ── Build LLM adapter ──
  let llm: LLMAdapter;
  if (services?.llm) {
    llm = services.llm;
  } else {
    const modelSpec = typeof config.model === 'string'
      ? config.model
      : `${config.model?.provider ?? 'openai'}/${config.model?.model ?? 'gpt-4o'}`;
    llm = createLLMAdapter(modelSpec, services as any);
  }

  // ── Wire tracing/metrics ──
  const appServices = services?.services ?? createApplicationServices({});

  // Set Noop defaults if not configured
  if (!appServices.tracer) appServices.tracer = new NoopTracer();
  if (!appServices.metrics) appServices.metrics = new NoopMetrics();

  // Handle tracing config
  if (config.tracing) {
    if (typeof config.tracing === 'object' && config.tracing.customTracer) {
      appServices.tracer = config.tracing.customTracer;
    } else if (config.tracing === true || (typeof config.tracing === 'object' && config.tracing.exporter !== 'custom')) {
      appServices.tracer = new ConsoleTracer();
    }
  } else if (config.preset === 'development') {
    appServices.tracer = new ConsoleTracer();
  }

  // Handle metrics config
  if (config.metrics) {
    if (typeof config.metrics === 'object' && config.metrics.customMetrics) {
      appServices.metrics = config.metrics.customMetrics;
    } else if (config.metrics === true || (typeof config.metrics === 'object')) {
      appServices.metrics = new ConsoleMetrics();
    }
  } else if (config.preset === 'development') {
    appServices.metrics = new ConsoleMetrics();
  }

  // ── Build tool registry ──
  const tools = new SimpleToolRegistry();

  // ── Build AgentContext ──
  const ctx: AgentContext = {
    sessionId,
    agentName: resolved.name,
    memory: services?.memory ?? ({ load: async () => ({ entries: [] }), formatForPrompt: () => '' } as any),
    pauseController: services?.pauseController ?? {
      isPaused: () => false,
      onResume: () => ({ subscribe: () => ({ unsubscribe: () => {} }) } as any),
    } as any,
    services: appServices,
    llm,
    tools,
    hookRegistry,
    ...services,
  };

  // ── Register tools ──
  if (resolved.toolNames.length > 0 && services?.tools) {
    for (const name of resolved.toolNames) {
      const def = services.tools.get(name);
      if (def) tools.register(def);
    }
  }

  // ── Plugins ──
  const allPlugins: Plugin[] = [...((config as any).plugins ?? [])];

  if (config.memory?.enabled && config.memory.sources.length > 0) {
    const memory = new FileBasedMemory(config.memory);
    allPlugins.push(createMemoryPlugin(memory as any, config.memory) as any);
  }

  if (config.skills?.sources && config.skills.sources.length > 0) {
    allPlugins.push(createSkillsPlugin(config.skills.sources) as any);
  }

  if (config.summarization) {
    allPlugins.push(createSummarizationPlugin(config.summarization) as any);
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
    const emitterAdapter: any = {
      on: loop.on.bind(loop),
      onAny: loop.onAny.bind(loop),
      emit: () => Promise.resolve(),
      clear: () => {},
    };
    manager.buildPipeline(hookRegistry, emitterAdapter);
  }

  // ── Dynamic Plugin Loading (pluginSpecs: PluginSpec[]) ──
  // Store loading promise so run() can await it before starting
  let pluginLoadPromise: Promise<void> = Promise.resolve();
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

  // ── Return Agent interface ──
  return {
    async run(input: string, handlers?: RunHandlers): Promise<string> {
      // Ensure dynamic plugins are loaded before starting
      await pluginLoadPromise;
      if (handlers) {
        if (handlers.onToken) loop.on('llm.stream.text' as any, (e: any) => handlers.onToken!(e.delta));
        if (handlers.onToolCall) loop.on('tool.call' as any, handlers.onToolCall);
        if (handlers.onToolResult) loop.on('tool.result' as any, handlers.onToolResult);
        if (handlers.onComplete) loop.on('agent.complete' as any, (e: any) => handlers.onComplete!(e.output));
        if (handlers.onError) loop.on('agent.error' as any, handlers.onError);
        if (handlers.onEvent) loop.onAny(handlers.onEvent);
      }
      return loop.run(input);
    },
    on: loop.on.bind(loop),
    cancel: loop.cancel.bind(loop),
    pause: () => { loop.pause(); return Promise.resolve(); },
    resume: loop.resume.bind(loop),
    getState: (): AgentLoopState | null => loop.getState(),

    /** @deprecated Internal context access for backward compat with tests */
    ctx,

    destroy: loop.destroy.bind(loop),
  };
}
