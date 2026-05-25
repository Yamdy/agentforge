import type {
  AgentConfig,
  AgentRunResult,
  AgentSimpleConfig,
  AutonomousConfig,
  CheckpointStore,
  MutabilityPolicy,
  PipelineContext,
  PipelineStageConfig,
  Processor,
  ReloadResult,
  SelfModificationRequest,
  SessionManager,
  Tool,
  Tracer,
} from '@primo-ai/sdk';
import { PipelineRunner } from './pipeline.js';
import { serialize } from './serialize.js';
import { ToolRegistry } from './tool-registry.js';
import { PluginManager, type PluginFactory } from './plugin-manager.js';
import { LLMInvoker } from './llm-invoker.js';
import { ModelFactory } from './model-factory.js';
import { BuiltInGateway, getDefaultBuiltInGateway } from './gateways/builtin-gateway.js';
import { OTelBridge, createOtlpTracerProvider } from '@primo-ai/observability';
import { AuthError, ModelNotFoundError } from './errors.js';
import { LoopOrchestrator } from './loop-orchestrator.js';
import { JsonlCheckpointStore } from './checkpoint-store.js';
import { echoTool } from '@primo-ai/tools';
import { MutabilityPolicyEngine } from './mutability-policy.js';
import { SelfRepresentationBuilder } from './self-representation.js';
import { applySelfModification, type SelfModificationEngineContext } from './self-modification-engine.js';
import { ConstitutionEngine } from './constitution.js';
import { VerificationGatePipeline } from './verification-gate.js';
import { MutationBudgetEngine } from './mutation-budget.js';
import type { Constitution } from '@primo-ai/sdk';
import {
  processInputProcessor,
  buildContextExtensionPoint,
  prepareStepExtensionPoint,
  createInvokeLLMProcessor,
  processStepOutputProcessor,
  gateToolExtensionPoint,
  createExecuteToolsProcessor,
  createCompressContextProcessor,
  createEvaluateIterationProcessor,
  processOutputProcessor,
} from './processors/index.js';
import { globalProcessorRegistry } from './processor-registry.js';
import type { ProcessorDescriptor, ProcessorDeps } from '@primo-ai/sdk';
import { ContextBuilder } from './context-builder.js';

export interface AgentDependencies {
  runner?: PipelineRunner;
  registry?: ToolRegistry;
  pluginManager?: PluginManager;
  tracer?: Tracer;
  modelFactory?: ModelFactory;
  sessionManager?: SessionManager;
  checkpointStore?: CheckpointStore<ReturnType<typeof serialize>>;
  /** When provided, creates a JsonlCheckpointStore for crash-safe checkpoint persistence */
  checkpointDir?: string;
  /** When true, saves a checkpoint after each completed iteration */
  autoCheckpoint?: boolean;
  contextBuilder?: ContextBuilder;
  /** Override default pipeline stage order. */
  stageConfig?: PipelineStageConfig;
  /** Override which Processor is used for each pipeline stage. Keys are stage names. */
  processorDescriptors?: Record<string, ProcessorDescriptor>;
  /** OTel sampling config passed to auto-detected tracer. Ignored when `tracer` is provided. */
  otelSampler?: 'always_on' | 'always_off' | { ratio: number };
  /** Mutability policy controlling what can change at runtime. */
  mutabilityPolicy?: MutabilityPolicy;
  /** Harness-level config. Agent reads processors, pipeline, etc. from this. */
  harnessConfig?: import('@primo-ai/sdk').HarnessConfig;
}

export interface RunOptions {
  sessionId?: string;
  signal?: globalThis.AbortSignal;
}

/**
 * Auto-detect OTel tracing from environment variables.
 * When OTEL_EXPORTER_OTLP_ENDPOINT is set and OTEL_SDK_DISABLED is not 'true',
 * creates an OTLP tracer and wraps it via OTelBridge.
 * Returns undefined if no OTel configuration is detected or initialization fails.
 */
export function autoDetectOtelTracer(
  sampler?: 'always_on' | 'always_off' | { ratio: number },
): Tracer | undefined {
  if (process.env.OTEL_SDK_DISABLED === 'true') return undefined;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return undefined;
  }
  try {
    const provider = createOtlpTracerProvider({ enabled: true, sampler });
    if (!provider) return undefined;
    return new OTelBridge({ tracerProvider: provider });
  } catch {
    return undefined;
  }
}

const defaultProcessorDescriptors: Record<string, ProcessorDescriptor> = {
  processInput: { builtin: 'processInput' },
  buildContext: { builtin: 'buildContext' },
  prepareStep: { builtin: 'prepareStep' },
  gateLLM: { builtin: 'gateLLM' },
  invokeLLM: { builtin: 'invokeLLM' },
  processStepOutput: { builtin: 'processStepOutput' },
  gateTool: { builtin: 'gateTool' },
  executeTools: { builtin: 'executeTools' },
  compressContext: { builtin: 'compressContext' },
  evaluateIteration: { builtin: 'evaluateIteration' },
  processOutput: { builtin: 'processOutput' },
};

export class Agent {
  private config: AgentConfig;
  private runner: PipelineRunner;
  private registry: ToolRegistry;
  private _pluginManager: PluginManager;
  private _tracer?: Tracer;
  private _autoCheckpoint: boolean;
  private _model: import('ai').LanguageModel | null = null;
  private modelFactory: ModelFactory;
  private orchestrator: LoopOrchestrator;
  private sessionManager?: SessionManager;
  private contextBuilder: ContextBuilder;
  private activeAbortController: AbortController | null = null;
  private lastContext?: PipelineContext;
  private _processorDescriptors?: Record<string, ProcessorDescriptor>;
  private mutabilityPolicyEngine: MutabilityPolicyEngine;
  private _pendingPipelineConfig?: PipelineStageConfig;
  private selfRef: { agent: Agent } = { agent: undefined! };
  private _pendingModifications: SelfModificationRequest[] = [];
  private _gapOptimizationRunning = false;
  private _isInternalRun = false;
  private _engineContext: SelfModificationEngineContext;
  private _harnessConfig?: import('@primo-ai/sdk').HarnessConfig;

  constructor(config: AgentSimpleConfig);
  constructor(config: AgentConfig, deps?: AgentDependencies);
  constructor(config: AgentConfig | AgentSimpleConfig, deps?: AgentDependencies) {
    this.config = config;
    this.modelFactory = deps?.modelFactory ?? new ModelFactory();
    this.modelFactory.registerGateway(getDefaultBuiltInGateway());
    this._tracer = deps?.tracer ?? autoDetectOtelTracer(deps?.otelSampler);
    this.runner = deps?.runner ?? new PipelineRunner({ tracer: this._tracer });
    this.registry = deps?.registry ?? new ToolRegistry();
    this.contextBuilder = deps?.contextBuilder ?? new ContextBuilder({ registry: this.registry });
    this._pluginManager = deps?.pluginManager ?? new PluginManager(this.runner, this.registry, this.contextBuilder);
    this.registry.setHookManager(this._pluginManager.hookManager);
    this.registry.setEventBus(this._pluginManager.eventBus);
    this.runner.setHookManager(this._pluginManager.hookManager);
    this.runner.setEventBus(this._pluginManager.eventBus);
    const store = deps?.checkpointStore ?? (deps?.checkpointDir ? new JsonlCheckpointStore<ReturnType<typeof serialize>>(deps.checkpointDir) : undefined);
    const stageConfig = deps?.stageConfig ?? deps?.harnessConfig?.pipeline as PipelineStageConfig | undefined;
    this.orchestrator = new LoopOrchestrator(this.runner, this._pluginManager.hookManager, store, this._pluginManager.eventBus, stageConfig);
    this.sessionManager = deps?.sessionManager;
    this._autoCheckpoint = deps?.autoCheckpoint ?? false;
    this._harnessConfig = deps?.harnessConfig;
    // Merge processor descriptors: harnessConfig.processors as base, deps.processorDescriptors overrides
    const harnessProcessors = deps?.harnessConfig?.processors as Record<string, ProcessorDescriptor> | undefined;
    if (harnessProcessors || deps?.processorDescriptors) {
      this._processorDescriptors = { ...harnessProcessors, ...deps?.processorDescriptors };
    } else {
      this._processorDescriptors = undefined;
    }
    const mutabilityPolicy = deps?.mutabilityPolicy ?? deps?.harnessConfig?.mutability as MutabilityPolicy | undefined;
    this.mutabilityPolicyEngine = new MutabilityPolicyEngine(mutabilityPolicy);
    this.registerTools();
    this.registerBuiltinProcessors();
    this._pluginManager.setStageMutator((m) => this.orchestrator.applyMutation(m));
    // Self-modification engine context: constitution → verification gates → mutation budget
    const defaultConstitution: Constitution = {
      version: 1,
      protectedPaths: [
        { pattern: 'packages/sdk/src/**', reason: 'SDK types are the contract layer', level: 'absolute' },
        { pattern: 'packages/core/src/constitution.ts', reason: 'Constitution must not modify itself', level: 'absolute' },
      ],
      diffLimits: { maxFilesPerMutation: 3, maxLinesPerFile: 100, maxMutationsPerHour: 10, maxMutationsPerDay: 50, cooldownMs: 5000 },
      immutableInterfaces: [],
      requiredCapabilities: [],
      benchmarkFiles: [],
      approvalMatrix: {
        L0: { description: 'No-op extension point', mode: 'auto' },
        L1: { description: 'Processor replacement', mode: 'auto_with_audit', auditTarget: 'eventBus', auditEvent: 'gap:optimization_complete', auditPayload: ['type', 'target'] },
        L2: { description: 'Plugin registration', mode: 'human_approval' },
        L3: { description: 'Source modification', mode: 'human_approval' },
        L4: { description: 'Constitution-level', mode: 'always_reject' },
      },
    };
    const constitutionEngine = new ConstitutionEngine(defaultConstitution);
    const gatePipeline = new VerificationGatePipeline({ constitutionEngine });
    const budgetEngine = new MutationBudgetEngine({
      maxMutationsPerHour: defaultConstitution.diffLimits.maxMutationsPerHour,
      maxMutationsPerDay: defaultConstitution.diffLimits.maxMutationsPerDay,
      maxDiffLinesPerMutation: defaultConstitution.diffLimits.maxLinesPerFile,
      maxFilesPerMutation: defaultConstitution.diffLimits.maxFilesPerMutation,
      cooldownMs: defaultConstitution.diffLimits.cooldownMs,
    });
    this._engineContext = { constitutionEngine, gatePipeline, budgetEngine };
    this.selfRef.agent = this;
  }

  use(factory: Processor | PluginFactory): void {
    if (typeof factory === 'function') {
      this._pluginManager.initializePlugin(factory as PluginFactory);
    } else {
      this.runner.register(factory as Processor);
    }
  }

  async teardown(): Promise<void> {
    await this._pluginManager.shutdown();
  }

  get pipelineRunner(): PipelineRunner {
    return this.runner;
  }

  get toolRegistry(): ToolRegistry {
    return this.registry;
  }

  get pluginManager(): PluginManager {
    return this._pluginManager;
  }

  get eventBus(): import('./event-bus.js').EventBus {
    return this._pluginManager.eventBus;
  }

  get eventSystem(): import('./event-system.js').EventSystem {
    return this._pluginManager.eventSystem;
  }

  get state(): import('./state-machine.js').AgentState {
    return this.orchestrator.state;
  }

  /** Subscribe to an event type. Returns an unsubscribe function. */
  on(eventType: string, handler: (data?: unknown) => void): () => void {
    return this.eventBus.subscribe(eventType, handler);
  }

  /** Subscribe to an event type for at most one emission. */
  once(eventType: string, handler: (data?: unknown) => void): void {
    this.eventBus.once(eventType, handler);
  }

  /** Remove a specific handler for an event type. */
  off(eventType: string, handler: (data?: unknown) => void): void {
    this.eventBus.unsubscribe(eventType, handler);
  }

  get _contextBuilder(): ContextBuilder {
    return this.contextBuilder;
  }

  async run(input: string, options?: globalThis.AbortSignal | RunOptions): Promise<AgentRunResult> {
    const signal = options instanceof AbortSignal ? options : options?.signal;
    const sessionId = options instanceof AbortSignal ? undefined : options?.sessionId;
    if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');
    this._pluginManager.setMutabilityPolicyOnHarnesses(this.mutabilityPolicyEngine);

    const context = await this.buildContext(input, sessionId);
    const hm = this._pluginManager.hookManager;

    // agent.start hook
    await hm.invoke('agent.start', { sessionId: context.session.sessionId, session: context.session, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    const controller = new AbortController();
    this.activeAbortController = controller;
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      const { context: finalCtx, compatRetries } = await this.orchestrator.runLoop(context, {
        maxIterations: maxIter,
        signal: controller.signal,
        modelString: this.config.model,
        sessionId: context.session.sessionId,
        autoCheckpoint: this._autoCheckpoint,
      });

      this.lastContext = finalCtx;

      return {
        response: finalCtx.iteration.response as string ?? '',
        tokenUsage: finalCtx.session.totalTokenUsage ?? { input: 0, output: 0 },
        sessionId: context.session.sessionId,
        compatRetries,
        content: finalCtx.iteration.content,
      };
    } catch (error) {
      this.autoInvalidateModel(error);
      throw error;
    } finally {
      this.activeAbortController = null;
      // agent.end hook — always fires, even on error; suppress hook errors to preserve original
      try { await hm.invoke('agent.end', { sessionId: context.session.sessionId }, {}); } catch { /* hook error must not mask original */ }
      if (!this._isInternalRun) this.triggerGapOptimizationIfApplicable('afterRun');
    }
  }

  /** Check AutonomousConfig.gapTriggers and start gap optimization if a trigger matches. */
  private triggerGapOptimizationIfApplicable(triggerType: 'afterRun' | 'onError'): void {
    if (this._gapOptimizationRunning) return;
    const autonomous = this._harnessConfig?.autonomous;
    if (!autonomous?.enabled || !autonomous.gapTriggers?.length) return;
    const match = autonomous.gapTriggers.find((t: { type: string }) => t.type === triggerType);
    if (!match) return;
    if (match.type === 'afterRun' && match.minIntervalMs > 0) {
      // Rate-limit: only trigger if enough time has passed since last gap optimization
      const lastGap = (this as any)._lastGapOptimizationTime as number | undefined;
      if (lastGap && Date.now() - lastGap < match.minIntervalMs) return;
    }
    this.startGapOptimization();
    (this as any)._lastGapOptimizationTime = Date.now();
  }

  async resume(sessionId: string, signal?: globalThis.AbortSignal): Promise<AgentRunResult> {
    if (signal?.aborted) throw new DOMException('Agent resume aborted', 'AbortError');

    const hm = this._pluginManager.hookManager;
    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;

    try {
      const { context: finalCtx, compatRetries } = await this.orchestrator.resumeLoop(sessionId, {
        maxIterations: maxIter,
        signal,
        modelString: this.config.model,
        sessionId,
        autoCheckpoint: this._autoCheckpoint,
      });

      // Wire to SessionManager so suspend→resume restores audit trail in place
      if (this.sessionManager) {
        await this.sessionManager.resumeInPlace(sessionId);
      }

      return {
        response: finalCtx.iteration.response as string ?? '',
        tokenUsage: finalCtx.session.totalTokenUsage ?? { input: 0, output: 0 },
        sessionId,
        compatRetries,
        content: finalCtx.iteration.content,
      };
    } catch (error) {
      this.autoInvalidateModel(error);
      throw error;
    } finally {
      try { await hm.invoke('agent.end', { sessionId }, {}); } catch { /* hook error must not mask original */ }
      if (!this._isInternalRun) this.triggerGapOptimizationIfApplicable('afterRun');
    }
  }

  async *stream(input: string, options?: globalThis.AbortSignal | RunOptions): AsyncGenerator<string> {
    const signal = options instanceof AbortSignal ? options : options?.signal;
    const sessionId = options instanceof AbortSignal ? undefined : options?.sessionId;
    if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

    const context = await this.buildContext(input, sessionId);
    const hm = this._pluginManager.hookManager;

    // agent.start hook
    await hm.invoke('agent.start', { sessionId: context.session.sessionId, session: context.session, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    const controller = new AbortController();
    this.activeAbortController = controller;
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      let finalCtx: PipelineContext | undefined;
      for await (const event of this.orchestrator.streamEvents(context, {
        maxIterations: maxIter,
        signal: controller.signal,
        modelString: this.config.model,
        sessionId: context.session.sessionId,
        autoCheckpoint: this._autoCheckpoint,
      })) {
        if (event.type === 'text_delta') yield event.text;
        if (event.type === 'suspended') yield ` [suspended: ${(event as { reason: string }).reason}]`;
        if (event.type === 'complete') finalCtx = (event as { context: PipelineContext }).context;
      }
      this.lastContext = finalCtx;
    } finally {
      this.activeAbortController = null;
      try { await hm.invoke('agent.end', { sessionId: context.session.sessionId }, {}); } catch { /* hook error must not mask original */ }
      if (!this._isInternalRun) this.triggerGapOptimizationIfApplicable('afterRun');
    }
  }

  async *streamEvents(input: string, options?: globalThis.AbortSignal | RunOptions): AsyncGenerator<import('@primo-ai/sdk').StreamEvent> {
    const signal = options instanceof AbortSignal ? options : options?.signal;
    const sessionId = options instanceof AbortSignal ? undefined : options?.sessionId;
    if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

    const context = await this.buildContext(input, sessionId);
    const hm = this._pluginManager.hookManager;

    await hm.invoke('agent.start', { sessionId: context.session.sessionId, session: context.session, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    const controller = new AbortController();
    this.activeAbortController = controller;
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      let finalCtx: PipelineContext | undefined;
      for await (const event of this.orchestrator.streamEvents(context, {
        maxIterations: maxIter,
        signal: controller.signal,
        modelString: this.config.model,
        sessionId: context.session.sessionId,
        autoCheckpoint: this._autoCheckpoint,
      })) {
        if (event.type === 'complete') finalCtx = (event as { context: PipelineContext }).context;
        yield event;
      }
      this.lastContext = finalCtx;
    } finally {
      this.activeAbortController = null;
      try { await hm.invoke('agent.end', { sessionId: context.session.sessionId }, {}); } catch { /* hook error must not mask original */ }
      if (!this._isInternalRun) this.triggerGapOptimizationIfApplicable('afterRun');
    }
  }

  /** Abort a running agent. Idempotent — no-op if agent is not running. */
  abort(): void {
    if (!this.orchestrator.stateMachine.canTransition('cancelled')) return;
    this.orchestrator.stateMachine.transition('cancelled');
    this.activeAbortController?.abort();
    this.activeAbortController = null;
  }

  /** Clear conversation state so the next run/stream starts a fresh session. */
  reset(): void {
    this.lastContext = undefined;
  }

  /** Reload config changes respecting the mutability policy. */
  reload(partial: Partial<import('@primo-ai/sdk').HarnessConfig>): ReloadResult {
    const rejectedKeys: string[] = [];
    const appliedKeys: string[] = [];

    for (const key of Object.keys(partial)) {
      const domain = key as import('@primo-ai/sdk').MutabilityDomain;
      if (domain === 'pipeline' || domain === 'processors' || domain === 'plugins' || domain === 'tools') {
        if (!this.mutabilityPolicyEngine.canApplyViaReload(domain)) {
          rejectedKeys.push(key);
          continue;
        }
      } else {
        // Non-domain keys (e.g. costCap, tokenBudget) are always reloadable
      }
      appliedKeys.push(key);
    }

    // Apply pipeline changes if allowed
    if (partial.pipeline && !rejectedKeys.includes('pipeline')) {
      // Pipeline changes will take effect on next run via stageConfig
      this._pendingPipelineConfig = partial.pipeline;
    }

    const applied = rejectedKeys.length === 0;

    if (applied && appliedKeys.length > 0) {
      this.eventBus.emit('config:reload:applied', { appliedKeys, rejectedKeys: [] });
    }
    if (rejectedKeys.length > 0) {
      this.eventBus.emit('config:reload:rejected', { appliedKeys, rejectedKeys });
    }

    return { applied, rejectedKeys: rejectedKeys.length > 0 ? rejectedKeys : undefined, appliedKeys: appliedKeys.length > 0 ? appliedKeys : undefined };
  }

  /** Clear the cached model so the next run re-resolves from the factory. */
  invalidateModel(): void {
    this._model = null;
  }

  /** Start gap optimization cycle. Emits gap:started, then runs self-analysis and applies modifications. */
  startGapOptimization(): void {
    if (this._gapOptimizationRunning) return;
    this._gapOptimizationRunning = true;
    this.eventBus.emit('gap:started', {});

    const autonomous = this._harnessConfig?.autonomous;
    if (!autonomous?.enabled) return;

    const prompt = autonomous.initialPrompt ?? 'Analyze your own pipeline and identify improvements. Use inspectSelf to examine your current state, then propose changes via replaceProcessor or registerPlugin if beneficial.';
    const maxOptimizations = autonomous.maxOptimizationsPerGap ?? 1;

    // Fire-and-forget: run self-optimization asynchronously
    this.runSelfOptimization(prompt, maxOptimizations).catch(() => {
      this._gapOptimizationRunning = false;
    });
  }

  /** Execute the self-optimization loop: run → collect proposals → apply. */
  private async runSelfOptimization(prompt: string, maxOptimizations: number): Promise<void> {
    this._isInternalRun = true;
    try {
      await this.run(prompt);
      if (this._pendingModifications.length > 0) {
        const toApply = this._pendingModifications.slice(0, maxOptimizations);
        this._pendingModifications = this._pendingModifications.slice(maxOptimizations);
        this._pendingModifications.unshift(...toApply);
        await this.applyPendingModifications();
      }
    } finally {
      this._gapOptimizationRunning = false;
      this._isInternalRun = false;
      this.eventBus.emit('gap:ended', {});
    }
  }

  /** Preempt gap optimization when a user request arrives. Emits gap:preempted. */
  preemptGapOptimization(): void {
    this._gapOptimizationRunning = false;
    this.eventBus.emit('gap:preempted', {});
  }

  /** Apply collected pending modifications from self-reference tools. */
  async applyPendingModifications(): Promise<{ applied: SelfModificationRequest[]; rejected: SelfModificationRequest[] }> {
    const applied: SelfModificationRequest[] = [];
    const rejected: SelfModificationRequest[] = [];

    for (const mod of this._pendingModifications) {
      const result = await applySelfModification(mod, this._engineContext);
      if (result.accepted) {
        applied.push(mod);
        this.eventBus.emit('gap:optimization_complete', { type: mod.type, target: mod.target });
      } else {
        rejected.push(mod);
        this.eventBus.emit('gap:optimization_rejected', { type: mod.type, target: mod.target, reason: result.reason });
      }
    }

    this._pendingModifications = [];
    return { applied, rejected };
  }

  /** Auto-invalidate cached model when the error indicates auth failure or model-not-found. */
  private autoInvalidateModel(error: unknown): void {
    if (isAuthOrNotFoundError(error)) {
      this._model = null;
    }
  }

  private async getLLM(systemPrompt?: string): Promise<LLMInvoker> {
    if (!this._model) {
      this._model = await this.modelFactory.resolve(this.config.model);
    }
    return new LLMInvoker({
      model: this._model,
      system: systemPrompt,
      retryOptions: { maxRetries: 3, baseDelay: 1000 },
      tracer: this._tracer,
    });
  }

  private async buildContext(input: string, sessionId?: string): Promise<PipelineContext> {
    const contextBudget = this.contextBuilder.getBudget();
    // Path 1: In-memory continuation (highest priority)
    if (this.lastContext) {
      return {
        agent: { config: { ...this.config }, promptFragments: [], toolDeclarations: [], contextBudget },
        iteration: { step: 0 },
        session: {
          input,
          sessionId: this.lastContext.session.sessionId,
          messageHistory: [
            ...(this.lastContext.session.messageHistory ?? []),
            { role: 'user', content: input },
          ],
          totalTokenUsage: this.lastContext.session.totalTokenUsage,
          custom: { ...this.lastContext.session.custom },
        },
      };
    }

    // Path 2: Explicit sessionId → restore from sessionManager
    if (sessionId && this.sessionManager) {
      const restored = await this.sessionManager.restore(sessionId);
      return {
        agent: { config: { ...this.config }, promptFragments: [], toolDeclarations: [], contextBudget },
        iteration: { step: 0 },
        session: {
          input,
          sessionId,
          messageHistory: [
            ...(restored.session.messageHistory ?? []),
            { role: 'user', content: input },
          ],
          totalTokenUsage: restored.session.totalTokenUsage,
          custom: { ...(restored.session.custom ?? {}) },
        },
      };
    }

    // Path 3: Fresh context
    return this.createContext(input, sessionId);
  }

  private async createContext(input: string, sessionId?: string): Promise<PipelineContext> {
    let sid = sessionId ?? crypto.randomUUID();
    if (this.sessionManager) {
      const record = await this.sessionManager.start(input);
      sid = record.sessionId;
    }
    const contextBudget = this.contextBuilder.getBudget();
    return {
      agent: { config: { ...this.config }, promptFragments: [], toolDeclarations: [], contextBudget },
      iteration: { step: 0 },
      session: { input, sessionId: sid, custom: {} },
    };
  }

  private registerTools(): void {
    const userToolNames = new Set((this.config.tools ?? []).map(t => t.name));
    if (!userToolNames.has(echoTool.name)) {
      this.registry.register(echoTool as Tool);
    }
    for (const tool of this.config.tools ?? []) {
      this.registry.register(tool as Tool);
    }
    this.registerSelfReferenceTools();
  }

  private registerSelfReferenceTools(): void {
    const self = this.selfRef;

    // inspectSelf — read-only, no approval needed
    this.registry.register({
      name: 'inspectSelf',
      description: 'Inspect the current agent pipeline, processors, tools, and state',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const agent = self.agent;
        const builder = new SelfRepresentationBuilder({
          agent: {
            orchestrator: agent.orchestrator,
            toolRegistry: agent.toolRegistry,
            getPluginNames: () => agent._pluginManager.pluginNames,
            state: agent.state,
            config: agent.config as unknown as Record<string, unknown>,
            eventBus: {
              query: (filter?: unknown) => {
                // Use EventSystem.query() via the replay backend when available
                try {
                  const sessionId = agent.lastContext?.session?.sessionId;
                  if (!sessionId) return [];
                  // Synchronous approximation: return empty for now; full async query
                  // requires SelfRepresentationBuilder to support async (future enhancement)
                  return [];
                } catch {
                  return [];
                }
              },
            },
          },
          mutabilityPolicy: agent.mutabilityPolicyEngine.policy,
        });
        return builder.build();
      },
    });

    // replaceProcessor — requires approval, collects proposal
    this.registry.register({
      name: 'replaceProcessor',
      description: 'Propose replacing a processor in the pipeline. Requires approval.',
      inputSchema: {
        type: 'object',
        properties: {
          stage: { type: 'string', description: 'Pipeline stage to replace' },
          processorCode: { type: 'string', description: 'Code for the new processor' },
        },
        required: ['stage', 'processorCode'],
      },
      requireApproval: true,
      execute: async (input: { stage: string; processorCode: string }) => {
        const agent = self.agent;
        const mod: SelfModificationRequest = {
          type: 'replaceProcessor',
          target: input.stage,
          payload: input.processorCode,
          riskLevel: 'L1',
        };
        (agent as any)._pendingModifications.push(mod);
        return { proposed: true, stage: input.stage };
      },
    });

    // registerPlugin — requires approval, collects proposal
    this.registry.register({
      name: 'registerPlugin',
      description: 'Propose registering a new plugin. Requires approval.',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: { type: 'string', description: 'ID of the plugin to register' },
          config: { type: 'object', description: 'Plugin configuration' },
        },
        required: ['pluginId'],
      },
      requireApproval: true,
      execute: async (input: { pluginId: string; config?: Record<string, unknown> }) => {
        const agent = self.agent;
        const mod: SelfModificationRequest = {
          type: 'registerPlugin',
          target: input.pluginId,
          payload: input.config ?? {},
          riskLevel: 'L1',
        };
        (agent as any)._pendingModifications.push(mod);
        return { proposed: true, pluginId: input.pluginId };
      },
    });

    // endAutonomousLoop — no approval needed, sets flag
    this.registry.register({
      name: 'endAutonomousLoop',
      description: 'Signal the agent to stop the autonomous gap optimization loop',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const agent = self.agent;
        (agent as any)._gapOptimizationRunning = false;
        return { ended: true };
      },
    });
  }

  private registerBuiltinProcessors(): void {
    const deps = this.buildProcessorDeps();
    this.ensureProcessorsRegistered();
    // Merge custom descriptors over defaults: custom takes precedence
    const descriptors = this._processorDescriptors
      ? { ...defaultProcessorDescriptors, ...this._processorDescriptors }
      : defaultProcessorDescriptors;

    for (const [stage, descriptor] of Object.entries(descriptors)) {
      if (stage === 'buildContext') {
        this.runner.register(this.contextBuilder.createProcessor());
        continue;
      }
      if (stage === 'compressContext') {
        this.runner.register(createCompressContextProcessor(this.contextBuilder, this._pluginManager.eventBus));
        continue;
      }
      const processor = globalProcessorRegistry.resolve(descriptor, deps);
      processor.stage = stage as import('@primo-ai/sdk').StageName;
      this.runner.register(processor);
    }
  }

  private buildProcessorDeps(): ProcessorDeps {
    return {
      getLLM: (systemPrompt) => this.getLLM(systemPrompt),
      registry: this.registry,
      hookManager: this._pluginManager.hookManager,
      eventBus: this._pluginManager.eventBus,
      modelString: this.config.model,
    };
  }

  private ensureProcessorsRegistered(): void {
    if (globalProcessorRegistry.has('processInput')) return;
    globalProcessorRegistry.register('processInput', () => processInputProcessor);
    globalProcessorRegistry.register('buildContext', () => buildContextExtensionPoint);
    globalProcessorRegistry.register('prepareStep', () => prepareStepExtensionPoint);
    globalProcessorRegistry.register('gateLLM', () => ({
      stage: 'gateLLM' as const,
      execute: async (ctx) => ctx.state,
      isNoOp: true,
    }));
    globalProcessorRegistry.register('invokeLLM', (deps?: ProcessorDeps) =>
      createInvokeLLMProcessor({
        getLLM: deps?.getLLM as any,
        registry: deps?.registry as any,
        hookManager: deps?.hookManager as any,
        modelString: deps?.modelString ?? '',
      }),
    );
    globalProcessorRegistry.register('processStepOutput', () => processStepOutputProcessor);
    globalProcessorRegistry.register('gateTool', () => gateToolExtensionPoint);
    globalProcessorRegistry.register('executeTools', (deps?: ProcessorDeps) =>
      createExecuteToolsProcessor(deps?.registry as any),
    );
    globalProcessorRegistry.register('compressContext', (deps?: ProcessorDeps) =>
      createCompressContextProcessor(undefined as any, deps?.eventBus as any),
    );
    globalProcessorRegistry.register('evaluateIteration', (deps?: ProcessorDeps) =>
      createEvaluateIterationProcessor({ eventBus: deps?.eventBus as any }),
    );
    globalProcessorRegistry.register('processOutput', () => processOutputProcessor);
  }
}

/**
 * Create an Agent from a simple config. Convenience wrapper for single-agent usage.
 * For advanced usage (Dynamic config, providerOptions, custom dependencies), use `new Agent(config, deps)`.
 */
export function createAgent(config: AgentSimpleConfig): Agent {
  return new Agent(config);
}

function isAuthOrNotFoundError(error: unknown): boolean {
  if (error instanceof AuthError || error instanceof ModelNotFoundError) return true;
  if (!(error instanceof Error)) return false;
  const err = error as Error & { statusCode?: number; status?: number };
  const code = err.statusCode ?? err.status;
  return code === 401 || code === 403 || code === 404;
}
