/**
 * AgentForge L2 API - createAgent()
 *
 * Configuration-driven Agent factory.
 * Creates a fully configured Agent from a declarative config.
 *
 * @module
 */

import type { AgentContext, AgentState } from '../core/index.js';
import type { LLMAdapter, ToolRegistry } from '../core/interfaces.js';
import { SimpleToolRegistry, createApplicationServices } from '../core/context-builder.js';
import { ConsoleTracer, ConsoleMetrics, NoopTracer, NoopMetrics } from '../core/defaults.js';
import { generateId } from '../core/events.js';
import { AgentEventEmitter } from '../core/events.js';
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

/**
 * Legacy flat field overrides — supported for convenience on the L2 public API.
 * Mapped to grouped sub-objects during normalization.
 */
interface FlatServiceOverrides {
  llm?: LLMAdapter;
  tools?: ToolRegistry;
  memory?: import('../core/interfaces.js').MemoryStore;
  pauseController?: import('../core/interfaces.js').PauseController;
  services?: import('../core/index.js').ApplicationServices;
  sessionId?: string;
  agentName?: string;
  hookRegistry?: HookRegistry;
  tracer?: import('../core/interfaces.js').Tracer;
  metrics?: import('../core/interfaces.js').Metrics;
  planner?: Planner;
  logger?: import('../core/logger.js').Logger;
  securityGuard?: import('../security/guard.js').SecurityGuard;
  auditLogger?: import('../core/interfaces.js').AuditLogger;
  permissionPolicy?: import('../core/interfaces.js').PermissionPolicy;
  permissionController?: import('../core/interfaces.js').PermissionController;
  sandboxExecutor?: import('../core/interfaces.js').SandboxExecutor;
  inputSanitizer?: import('../core/interfaces.js').InputSanitizer;
  rateLimiter?: import('../core/interfaces.js').RateLimiter;
  quota?: import('../quota/quota-controller.js').QuotaController;
  checkpoint?: import('../core/interfaces.js').CheckpointStorage;
  hitl?: import('../core/interfaces.js').HITLController;
  abortSignal?: AbortSignal;
  mcpClients?: Map<string, import('../core/interfaces.js').MCPClient>;
  subagents?: import('../core/interfaces.js').SubagentRegistry;
  errorClassifier?: import('../contracts/mpu-interfaces.js').ErrorClassifier;
  circuitBreaker?: import('../contracts/mpu-interfaces.js').CircuitBreaker;
  autoRepairer?: import('../contracts/mpu-interfaces.js').AutoRepairer;
  onError?: import('../core/interfaces.js').ErrorHandler;
  healthChecker?: import('../contracts/mpu-interfaces.js').HealthChecker;
  qualityGate?: import('../validation/quality-gate.js').QualityGate;
  compactionManager?: import('../memory/index.js').CompactionManager;
}

/**
 * Grouped sub-object overrides — canonical AgentContext structure.
 */
type AgentContextOverrides = {
  [K in keyof AgentContext]?: Partial<AgentContext[K]>;
};

/** Normalize flat legacy overrides into grouped AgentContextOverrides */
function normalizeServices(
  flat?: FlatServiceOverrides | AgentContextOverrides
): AgentContextOverrides {
  if (!flat) return {};
  // If it already has AgentContext sub-object keys, return as-is
  const subKeys = [
    'identity',
    'core',
    'security',
    'controls',
    'memory',
    'resilience',
    'extensions',
    'harness',
  ];
  if (subKeys.some(k => k in flat)) return flat as AgentContextOverrides;
  // Map flat fields to grouped
  const f = flat as FlatServiceOverrides;
  const result: AgentContextOverrides = {};
  if (
    f.llm !== undefined ||
    f.tools !== undefined ||
    f.memory !== undefined ||
    f.pauseController !== undefined ||
    f.services !== undefined ||
    f.logger !== undefined
  ) {
    result.core = {
      ...(f.llm !== undefined ? { llm: f.llm } : {}),
      ...(f.tools !== undefined ? { tools: f.tools } : {}),
      ...(f.memory !== undefined ? { memory: f.memory } : {}),
      ...(f.pauseController !== undefined ? { pauseController: f.pauseController } : {}),
      ...(f.services !== undefined ? { services: f.services } : {}),
      ...(f.logger !== undefined ? { logger: f.logger } : {}),
    };
  }
  if (f.sessionId !== undefined || f.agentName !== undefined) {
    result.identity = {
      ...(f.sessionId !== undefined ? { sessionId: f.sessionId } : {}),
      ...(f.agentName !== undefined ? { agentName: f.agentName } : {}),
    };
  }
  if (
    f.securityGuard !== undefined ||
    f.auditLogger !== undefined ||
    f.permissionPolicy !== undefined ||
    f.permissionController !== undefined ||
    f.sandboxExecutor !== undefined ||
    f.inputSanitizer !== undefined
  ) {
    result.security = {
      ...(f.securityGuard !== undefined ? { securityGuard: f.securityGuard } : {}),
      ...(f.auditLogger !== undefined ? { auditLogger: f.auditLogger } : {}),
      ...(f.permissionPolicy !== undefined ? { permissionPolicy: f.permissionPolicy } : {}),
      ...(f.permissionController !== undefined
        ? { permissionController: f.permissionController }
        : {}),
      ...(f.sandboxExecutor !== undefined ? { sandboxExecutor: f.sandboxExecutor } : {}),
      ...(f.inputSanitizer !== undefined ? { inputSanitizer: f.inputSanitizer } : {}),
    };
  }
  if (
    f.rateLimiter !== undefined ||
    f.quota !== undefined ||
    f.checkpoint !== undefined ||
    f.hitl !== undefined ||
    f.abortSignal !== undefined
  ) {
    result.controls = {
      ...(f.rateLimiter !== undefined ? { rateLimiter: f.rateLimiter } : {}),
      ...(f.quota !== undefined ? { quota: f.quota } : {}),
      ...(f.checkpoint !== undefined ? { checkpoint: f.checkpoint } : {}),
      ...(f.hitl !== undefined ? { hitl: f.hitl } : {}),
      ...(f.abortSignal !== undefined ? { abortSignal: f.abortSignal } : {}),
    };
  }
  if (f.qualityGate !== undefined || f.compactionManager !== undefined) {
    result.memory = {
      ...(f.qualityGate !== undefined ? { qualityGate: f.qualityGate } : {}),
      ...(f.compactionManager !== undefined ? { compactionManager: f.compactionManager } : {}),
    };
  }
  if (
    f.errorClassifier !== undefined ||
    f.circuitBreaker !== undefined ||
    f.autoRepairer !== undefined ||
    f.onError !== undefined
  ) {
    result.resilience = {
      ...(f.errorClassifier !== undefined ? { errorClassifier: f.errorClassifier } : {}),
      ...(f.circuitBreaker !== undefined ? { circuitBreaker: f.circuitBreaker } : {}),
      ...(f.autoRepairer !== undefined ? { autoRepairer: f.autoRepairer } : {}),
      ...(f.onError !== undefined ? { onError: f.onError } : {}),
    };
  }
  if (f.mcpClients !== undefined || f.subagents !== undefined || f.planner !== undefined) {
    result.extensions = {
      ...(f.mcpClients !== undefined ? { mcpClients: f.mcpClients } : {}),
      ...(f.subagents !== undefined ? { subagents: f.subagents } : {}),
      ...(f.planner !== undefined ? { planner: f.planner } : {}),
    };
  }
  if (f.hookRegistry !== undefined) {
    result.harness = { ...(f.hookRegistry !== undefined ? { hookRegistry: f.hookRegistry } : {}) };
  }
  if (f.tracer !== undefined || f.metrics !== undefined) {
    const existingCore = result.core ?? {};
    const existingServices = existingCore.services ?? {};
    (result as Record<string, unknown>).core = {
      ...existingCore,
      services: {
        ...existingServices,
        ...(f.tracer !== undefined ? { tracer: f.tracer } : {}),
        ...(f.metrics !== undefined ? { metrics: f.metrics } : {}),
      },
    };
  }
  if (f.healthChecker !== undefined) {
    const existingCore = result.core ?? {};
    const existingServices = existingCore.services ?? {};
    (result as Record<string, unknown>).core = {
      ...existingCore,
      services: {
        ...existingServices,
        healthChecker: f.healthChecker,
      },
    };
  }
  return result;
}

export function createAgent(
  config: AgentConfig,
  services?: FlatServiceOverrides | AgentContextOverrides
): AgentInterface {
  const n: NormalizedAgentConfig = normalizeConfig(config);
  const svc = normalizeServices(services);
  const sessionId = svc?.identity?.sessionId ?? generateId('session');
  const agentName = svc?.identity?.agentName ?? n.name;
  const hookRegistry = new HookRegistry();

  // ── LLM adapter ──
  const modelSpec = `${n.model.provider}/${n.model.model}`;
  const llm: LLMAdapter = svc?.core?.llm ?? createLLMAdapter(modelSpec, n.llmOptions);

  // ── Application services ──
  const appServices = svc?.core?.services ?? createApplicationServices({});
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
    identity: { sessionId, agentName },
    core: {
      llm,
      tools,
      memory: svc?.core?.memory ?? memoryStub,
      pauseController: svc?.core?.pauseController ?? pauseStub,
      services: appServices,
      ...(svc?.core?.logger ? { logger: svc.core.logger } : {}),
    },
    security: svc?.security ?? {},
    controls: svc?.controls ?? {},
    memory: svc?.memory ?? {},
    resilience: svc?.resilience ?? {},
    extensions: svc?.extensions ?? {},
    harness: { hookRegistry, ...svc?.harness },
  };

  // Validate
  if (ctx.security.permissionPolicy && !ctx.security.permissionController) {
    throw new AgentConfigError('permissionPolicy requires permissionController.');
  }

  // Register tools from services
  if (toolNames.length > 0 && svc?.core?.tools) {
    for (const name of toolNames) {
      const def = svc.core.tools.get(name);
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

  // ── Plugin pipeline ──
  let pluginManager: PluginManager | undefined;
  if (allPlugins.length > 0) {
    pluginManager = createPluginManager();
    const pluginCtx = createPluginContext({
      sessionId,
      agentName,
      ...(appServices.tracer ? { tracer: appServices.tracer } : {}),
      ...(appServices.metrics ? { metrics: appServices.metrics } : {}),
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
  };
  if (n.tokenBudget !== undefined) loopConfig.tokenBudget = n.tokenBudget;

  const loop: AgentLoop = createAgentLoop(ctx, loopConfig);

  // Build pipeline now that loop exists (register hooks + event subscriptions)
  if (pluginManager) {
    pluginManager.buildPipeline(hookRegistry, emitterBridge(loop));
    ctx.harness.pluginManager = pluginManager;
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
    });
    pluginLoadPromise = PluginLoader.loadAll(
      specs,
      pluginCtx,
      hookRegistry,
      emitterBridge(loop) as unknown as AgentEventEmitter
    ).then(() => {});
  }

  // ── Planner (non-react modes) ──
  if (n.executionMode !== 'react') {
    const planner: Planner = ctx.extensions.planner ?? new LLMPlanner(llm, 2);
    if (!ctx.extensions.planner) ctx.extensions.planner = planner;
    const notebook = new PlanNotebook(planner, {
      availableTools: toolNames,
      maxSteps: n.maxSteps,
    });
    notebook.registerTools(ctx.core.tools);
    hookRegistry.registerRequest(notebook.planHintHook);
  }

  // ── Return Agent interface ──
  return {
    async run(input: string, handlers?: RunHandlers): Promise<string> {
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

function emitterBridge(loop: AgentLoop): AgentEventEmitter {
  return {
    on: loop.on.bind(loop),
    onAny: loop.onAny.bind(loop),
    emit: () => Promise.resolve(),
    clear: () => {},
    eventNames: () => [],
    listenerCount: () => 0,
  } as unknown as AgentEventEmitter;
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
