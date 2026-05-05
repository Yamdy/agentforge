/**
 * AgentForge L2 API - createAgent()
 *
 * Configuration-driven Agent factory.
 * Creates a fully configured Agent from a declarative config.
 *
 * @module
 */

import type { AgentContext, AgentState } from '../core/index.js';
import type { LLMAdapter, ToolDefinition } from '../core/interfaces.js';
import { SimpleToolRegistry, createApplicationServices } from '../core/context-builder.js';
import { ConsoleTracer, ConsoleMetrics, NoopTracer, NoopMetrics } from '../core/defaults.js';
import { AgentEventEmitter, generateId, type Message } from '../core/events.js';
import { HookRegistry } from '../core/hooks.js';
import { createAgentLoop, type AgentLoopConfig, type AgentLoop } from '../loop/agent-loop.js';
import { createLLMAdapter } from '../adapters/index.js';
import {
  createPluginManager,
  createPluginContext,
  type Plugin,
  type PluginManager,
} from '../plugins/index.js';
import { PluginLoader } from '../plugins/plugin-loader.js';
import type { PluginSpec } from '../plugins/plugin-loader.js';
import {
  createMemoryPlugin,
  createSkillsPlugin,
  createSummarizationPlugin,
  createQuotaPlugin,
  createRateLimitPlugin,
  createQualityGatePlugin,
  createCircuitBreakerPlugin,
} from '../plugins/index.js';
import { FileBasedMemory } from '../memory/index.js';
import { createMemorySearchTool } from '../tools/memory-search.js';
import { PlanNotebook } from '../planning/plan-notebook.js';
import { LLMPlanner } from '../planning/llm-planner.js';
import type { Planner } from '../planning/types.js';
import {
  type AgentConfig,
  type Agent as AgentInterface,
  type RunHandlers,
  type TracingConfig,
  AgentConfigError,
} from './types.js';
import { normalizeConfig, type NormalizedAgentConfig } from './config-normalizer.js';

// ============================================================
// createAgent
// ============================================================

export function createAgent(config: AgentConfig, services?: Partial<AgentContext>): AgentInterface {
  const n: NormalizedAgentConfig = normalizeConfig(config);
  const svc = services ?? {};
  const sessionId = svc?.sessionId ?? generateId('session');
  const agentName = svc?.agentName ?? n.name;
  const hookRegistry = new HookRegistry();

  // ── LLM adapter ──
  const modelSpec = `${n.model.provider}/${n.model.model}`;
  const llm: LLMAdapter = svc?.llm ?? createLLMAdapter(modelSpec, n.llmOptions);

  // ── Application services ──
  const appServices = svc?.services ?? createApplicationServices({});
  appServices.tracer ??= new NoopTracer();
  appServices.metrics ??= new NoopMetrics();

  // Metrics
  if (isMetricsObject(n.metrics)) {
    appServices.metrics = n.metrics.customMetrics ?? new ConsoleMetrics();
  } else if (n.metrics === true) {
    appServices.metrics = new ConsoleMetrics();
  } else if (n.preset === 'development') {
    appServices.metrics = new ConsoleMetrics();
  }

  // ── Tool registry ──
  const tools = new SimpleToolRegistry();
  const toolNames = n.toolSpecs.map(t => (typeof t === 'string' ? t : t.name));

  // ── AgentContext ──
  const memoryStub = stubMemoryStore();
  const pauseStub = stubPauseController();
  const ctx: AgentContext = {
    sessionId,
    agentName,
    llm,
    tools,
    memory: svc?.memory ?? memoryStub,
    pauseController: svc?.pauseController ?? pauseStub,
    services: appServices,
    hookRegistry,
    ...(svc?.logger ? { logger: svc.logger } : {}),
    ...(svc?.permissionPolicy ? { permissionPolicy: svc.permissionPolicy } : {}),
    ...(svc?.permissionController ? { permissionController: svc.permissionController } : {}),
    ...(svc?.sandboxExecutor ? { sandboxExecutor: svc.sandboxExecutor } : {}),
    ...(svc?.auditLogger ? { auditLogger: svc.auditLogger } : {}),
    ...(svc?.inputSanitizer ? { inputSanitizer: svc.inputSanitizer } : {}),
    ...(svc?.securityGuard ? { securityGuard: svc.securityGuard } : {}),
    ...(svc?.hitl ? { hitl: svc.hitl } : {}),
    ...(svc?.rateLimiter ? { rateLimiter: svc.rateLimiter } : {}),
    ...(svc?.quota ? { quota: svc.quota } : {}),
    ...(svc?.checkpoint ? { checkpoint: svc.checkpoint } : {}),
    ...(svc?.abortSignal ? { abortSignal: svc.abortSignal } : {}),
    ...(svc?.compactionManager ? { compactionManager: svc.compactionManager } : {}),
    ...(svc?.qualityGate ? { qualityGate: svc.qualityGate } : {}),
    ...(svc?.errorClassifier ? { errorClassifier: svc.errorClassifier } : {}),
    ...(svc?.circuitBreaker ? { circuitBreaker: svc.circuitBreaker } : {}),
    ...(svc?.autoRepairer ? { autoRepairer: svc.autoRepairer } : {}),
    ...(svc?.onError ? { onError: svc.onError } : {}),
    ...(svc?.mcpClients ? { mcpClients: svc.mcpClients } : {}),
    ...(svc?.subagents ? { subagents: svc.subagents } : {}),
    ...(svc?.planner ? { planner: svc.planner } : {}),
    ...(svc?.pluginManager ? { pluginManager: svc.pluginManager } : {}),
  };

  // Validate
  if (ctx.permissionPolicy && !ctx.permissionController) {
    throw new AgentConfigError('permissionPolicy requires permissionController.');
  }

  // Register tools from services
  if (toolNames.length > 0 && svc?.tools) {
    for (const name of toolNames) {
      const def = svc.tools.get(name);
      if (def) tools.register(def);
    }
  }

  // Auto-register memory_search for pointer-indexed compaction
  const compaction = n.compaction;
  if (
    compaction?.strategy === 'pointer-indexed' &&
    compaction.vectorStore &&
    compaction.embeddingModel
  ) {
    for (const t of createMemorySearchTool(compaction.vectorStore, compaction.embeddingModel)) {
      tools.register(t);
    }
  }

  // ── Plugins ──
  const allPlugins: Plugin[] = [...(n.plugins ?? [])];

  if (n.memory?.enabled && n.memory.sources.length > 0) {
    allPlugins.push(createMemoryPlugin(new FileBasedMemory(n.memory), n.memory));
  }
  if (n.skills?.sources && n.skills.sources.length > 0) {
    allPlugins.push(createSkillsPlugin(n.skills.sources));
  }
  if (n.summarization) {
    allPlugins.push(createSummarizationPlugin(n.summarization));
  }

  // Built-in checkpoint plugins (replaces hardcoded CheckpointRegistry registrations)
  allPlugins.push(createQuotaPlugin());
  allPlugins.push(createRateLimitPlugin());
  allPlugins.push(createQualityGatePlugin());
  allPlugins.push(createCircuitBreakerPlugin());

  // ── Shared state for PluginContext wiring ──
  // Created before the agent loop so PluginContext can provide emitter,
  // getState, and addMessages at init time.
  const sharedEmitter = new AgentEventEmitter();
  const stateRef: { current: AgentState | null } = { current: null };
  const pendingMessages: Message[] = [];

  // Shared PluginContext capability closures (used by both built-in and dynamic plugin paths)
  const ctxGetState = (): Readonly<AgentState> => {
    if (!stateRef.current) throw new Error('Agent state not yet initialized');
    return stateRef.current;
  };
  const ctxListTools = (): ToolDefinition[] => {
    const names = ctx.tools.list();
    const defs: ToolDefinition[] = [];
    for (const name of names) {
      const def = ctx.tools.get(name);
      if (def) defs.push(def);
    }
    return defs;
  };
  const ctxAddMessages = (msgs: Message[]): void => {
    pendingMessages.push(...msgs);
  };

  // ── Plugin pipeline ──
  let pluginManager: PluginManager | undefined;
  if (allPlugins.length > 0) {
    pluginManager = createPluginManager();
    const pluginCtx = createPluginContext({
      sessionId,
      agentName,
      ...(appServices.tracer ? { tracer: appServices.tracer } : {}),
      ...(appServices.metrics ? { metrics: appServices.metrics } : {}),
      ...(svc?.logger ? { logger: svc.logger } : {}),
      emitter: sharedEmitter,
      getState: ctxGetState,
      listTools: ctxListTools,
      addMessages: ctxAddMessages,
    });
    pluginManager.setContext(pluginCtx);
    for (const plugin of allPlugins) pluginManager.register(plugin);
  }

  // ── Agent loop ──
  const loopConfig: AgentLoopConfig = {
    model: n.model,
    maxSteps: n.maxSteps,
    maxLLMRepairAttempts: n.maxLLMRepairAttempts,
    parallelToolCalls: n.parallelToolCalls,
    streaming: n.streaming,
    executionMode: n.executionMode,
    systemPrompt: n.systemPrompt,
    history: n.history,
    externalEmitter: sharedEmitter,
    onStateCreated: s => {
      stateRef.current = s;
    },
    pendingMessages,
  };
  if (n.tokenBudget !== undefined) loopConfig.tokenBudget = n.tokenBudget;

  const loop: AgentLoop = createAgentLoop(ctx, loopConfig);

  // Build pipeline now that loop exists (register hooks + event subscriptions)
  if (pluginManager) {
    pluginManager.buildPipeline(hookRegistry, loop.emitter);
    ctx.pluginManager = pluginManager;
  }

  // ── Async init (tracing + dynamic plugins) ──
  let pluginLoadPromise: Promise<void> = Promise.resolve();
  let tracerInitPromise: Promise<void> = Promise.resolve();

  // Tracing
  if (isTracingObject(n.tracing)) {
    if (n.tracing.customTracer) {
      appServices.tracer = n.tracing.customTracer;
    } else if (n.tracing.exporter === 'otel') {
      tracerInitPromise = initOTel(n.tracing as TracingConfig & { exporter: 'otel' }, appServices);
    } else if (n.tracing.exporter !== 'none') {
      appServices.tracer = new ConsoleTracer();
    }
  } else if (n.tracing === true) {
    appServices.tracer = new ConsoleTracer();
  } else if (n.preset === 'development') {
    appServices.tracer = new ConsoleTracer();
  }

  // Dynamic plugins
  const specs: PluginSpec[] = [...(n.pluginSpecs ?? [])];
  if (specs.length > 0) {
    const pluginCtx = createPluginContext({
      sessionId,
      agentName,
      ...(appServices.tracer ? { tracer: appServices.tracer } : {}),
      ...(appServices.metrics ? { metrics: appServices.metrics } : {}),
      ...(svc?.logger ? { logger: svc.logger } : {}),
      emitter: sharedEmitter,
      getState: ctxGetState,
      listTools: ctxListTools,
      addMessages: ctxAddMessages,
    });
    pluginLoadPromise = PluginLoader.loadAll(specs, pluginCtx, hookRegistry, loop.emitter).then(
      () => {}
    );
  }

  // ── Planner (non-react modes) ──
  if (n.executionMode !== 'react') {
    const planner: Planner = ctx.planner ?? new LLMPlanner(llm, 2);
    if (!ctx.planner) ctx.planner = planner;
    const notebook = new PlanNotebook(planner, {
      availableTools: toolNames,
      maxSteps: n.maxSteps,
    });
    notebook.registerTools(ctx.tools);
    hookRegistry.registerRequest(notebook.planHintHook);
  }

  // ── Return Agent interface ──
  return {
    async run(
      input: string,
      handlers?: RunHandlers
    ): Promise<import('../loop/agent-loop.js').RunResult> {
      await tracerInitPromise;
      await pluginLoadPromise;
      if (handlers) {
        if (handlers.onToolCall) loop.on('tool.call', handlers.onToolCall);
        if (handlers.onToolResult) loop.on('tool.result', handlers.onToolResult);
        if (handlers.onComplete) loop.on('agent.complete', e => handlers.onComplete!(e.output));
        if (handlers.onError) loop.on('agent.error', handlers.onError);
        if (handlers.onEvent) loop.onAny(handlers.onEvent);
      }
      return loop.run(input);
    },
    iterate: async function* (input: string) {
      await tracerInitPromise;
      await pluginLoadPromise;
      return yield* loop.iterate(input);
    },
    on: loop.on.bind(loop),
    cancel: loop.cancel.bind(loop),
    pause: () => {
      loop.pause();
      return Promise.resolve();
    },
    resume: loop.resume.bind(loop),
    getState: (): AgentState | null => loop.getState(),
    getStatus: (): string => loop.getStatus(),
    onStateChange: (fn: (from: string, to: string) => void): (() => void) => loop.onStateChange(fn),
    ctx,
    destroy: loop.destroy.bind(loop),
  };
}

// ============================================================
// Helpers
// ============================================================

function stubMemoryStore(): import('../core/interfaces.js').MemoryStore {
  return { add: () => {}, getAll: () => [], getRecent: () => [], clear: () => {}, count: () => 0 };
}

function stubPauseController(): import('../core/interfaces.js').PauseController {
  return {
    pause: () => {},
    resume: () => {},
    isPaused: () => false,
    onResume: () => () => {},
  };
}

function isTracingObject(
  t: boolean | import('./types.js').TracingConfig | undefined
): t is import('./types.js').TracingConfig {
  return typeof t === 'object' && t !== null;
}

function isMetricsObject(
  m: boolean | import('./types.js').MetricsConfig | undefined
): m is import('./types.js').MetricsConfig {
  return typeof m === 'object' && m !== null;
}

async function initOTel(
  tracing: import('./types.js').TracingConfig & { exporter: 'otel' },
  appServices: import('../core/index.js').ApplicationServices
): Promise<void> {
  try {
    const { OTelTracer } = await import('../observability/tracers/otel-tracer.js');
    const otelTracer = new OTelTracer();
    const otelConfig: import('../observability/tracers/otel-tracer.js').OTelConfig = {
      endpoint: tracing.endpoint ?? '',
    };
    if (tracing.serviceName !== undefined) otelConfig.serviceName = tracing.serviceName;
    if (tracing.headers !== undefined) otelConfig.headers = tracing.headers;
    if (tracing.sampler !== undefined) otelConfig.sampler = tracing.sampler;
    await otelTracer.configure(otelConfig);
    appServices.tracer = otelTracer;
  } catch {
    appServices.tracer = new ConsoleTracer();
  }
}
