import type {
  SelfRepresentation,
  ModuleInfo,
  ModuleDependency,
  LayerDiagnostic,
  ModificationRecord,
  MutabilityPolicy,
  HealthCheckResult,
} from '@primo-ai/sdk';

// ---------------------------------------------------------------------------
// ECC 12-layer definition (static mapping)
// ---------------------------------------------------------------------------

const ECC_LAYERS: Array<{
  layer: number;
  name: string;
  agentForgeComponent: string;
  codeGated: boolean;
  knownFailurePatterns: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}> = [
  { layer: 1, name: 'System prompt', agentForgeComponent: 'config.systemPrompt', codeGated: false, knownFailurePatterns: ['prompt injection', 'overridden prompt'], riskLevel: 'low' },
  { layer: 2, name: 'Session history', agentForgeComponent: 'PipelineContext.session', codeGated: false, knownFailurePatterns: ['context overflow', 'stale history'], riskLevel: 'low' },
  { layer: 3, name: 'Long-term memory', agentForgeComponent: 'memoryPlugin', codeGated: true, knownFailurePatterns: ['memory admission bypass', 'hallucinated recall'], riskLevel: 'medium' },
  { layer: 4, name: 'Distillation', agentForgeComponent: 'compressionPlugin', codeGated: true, knownFailurePatterns: ['token threshold bypass', 'information loss'], riskLevel: 'medium' },
  { layer: 5, name: 'Active recall', agentForgeComponent: 'contextBuilder', codeGated: false, knownFailurePatterns: ['missing context', 'wrong context order'], riskLevel: 'low' },
  { layer: 6, name: 'Tool selection', agentForgeComponent: 'gateTool + requiredTools', codeGated: true, knownFailurePatterns: ['required tool skipped', 'tool injection'], riskLevel: 'high' },
  { layer: 7, name: 'Tool execution', agentForgeComponent: 'executeTools', codeGated: true, knownFailurePatterns: ['unauthorized tool call', 'tool output tampering'], riskLevel: 'high' },
  { layer: 8, name: 'Tool interpretation', agentForgeComponent: 'processStepOutput', codeGated: false, knownFailurePatterns: ['misinterpretation', 'ignored tool result'], riskLevel: 'low' },
  { layer: 9, name: 'Answer shaping', agentForgeComponent: 'processOutput', codeGated: false, knownFailurePatterns: ['output truncation', 'format violation'], riskLevel: 'low' },
  { layer: 10, name: 'Platform rendering', agentForgeComponent: 'Server HTTP layer', codeGated: false, knownFailurePatterns: ['rendering error', 'encoding issue'], riskLevel: 'low' },
  { layer: 11, name: 'Hidden repair loops', agentForgeComponent: 'fallback-runner + compatRule', codeGated: true, knownFailurePatterns: ['infinite fallback loop', 'rule conflict'], riskLevel: 'medium' },
  { layer: 12, name: 'Persistence', agentForgeComponent: 'checkpointStore', codeGated: false, knownFailurePatterns: ['checkpoint corruption', 'restore failure'], riskLevel: 'medium' },
];

// ---------------------------------------------------------------------------
// SelfRepresentationBuilder
// ---------------------------------------------------------------------------

export interface SelfRepresentationBuilderOptions {
  agent: {
    orchestrator: { stageConfig: { preLoop?: string[]; loop?: string[]; postLoop?: string[] } };
    toolRegistry: { getAll(): Array<{ name: string }> };
    /** Function that returns names of currently loaded plugins. */
    getPluginNames: () => string[];
    state: string;
    config: Record<string, unknown>;
    eventBus: { query?: (filter?: unknown) => Array<{ type: string; payload: Record<string, unknown> }> };
  };
  constitution?: unknown;
  mutabilityPolicy?: MutabilityPolicy;
}

const DEFAULT_MUTABILITY: MutabilityPolicy = {
  pipeline: 'frozen',
  processors: 'frozen',
  plugins: 'frozen',
  tools: 'frozen',
  hotReload: false,
  watchConfig: false,
};

export class SelfRepresentationBuilder {
  private options: SelfRepresentationBuilderOptions;

  constructor(options: SelfRepresentationBuilderOptions) {
    this.options = options;
  }

  build(): SelfRepresentation {
    const { agent, constitution, mutabilityPolicy } = this.options;
    const policy = mutabilityPolicy ?? DEFAULT_MUTABILITY;

    const modules = this.buildModules(agent, policy);
    const dependencies = this.buildDependencies(agent);
    const layerDiagnostics = this.buildLayerDiagnostics();
    const modificationHistory = this.buildModificationHistory(agent);

    return {
      modules,
      dependencies,
      layerDiagnostics,
      constitution: constitution ?? null,
      modificationHistory,
    };
  }

  private buildModules(agent: SelfRepresentationBuilderOptions['agent'], policy: MutabilityPolicy): ModuleInfo[] {
    const modules: ModuleInfo[] = [];
    const stageConfig = agent.orchestrator.stageConfig;

    const allStages = [
      ...(stageConfig.preLoop ?? []),
      ...(stageConfig.loop ?? []),
      ...(stageConfig.postLoop ?? []),
    ];

    // Processor modules
    for (const stage of allStages) {
      modules.push({
        name: stage,
        path: `core/processors/${stage}`,
        responsibility: 'processor',
        mutability: policy.processors,
        exports: ['execute'],
        dependsOn: this.getStageDependencies(stage, allStages),
      });
    }

    // Tool modules
    const tools = agent.toolRegistry.getAll();
    for (const tool of tools) {
      modules.push({
        name: tool.name,
        path: `tools/${tool.name}`,
        responsibility: 'tool',
        mutability: policy.tools,
        exports: ['execute'],
        dependsOn: [],
      });
    }

    // Plugin modules
    for (const pluginId of agent.getPluginNames()) {
      modules.push({
        name: pluginId,
        path: `plugins/${pluginId}`,
        responsibility: 'plugin',
        mutability: policy.plugins,
        exports: ['initialize'],
        dependsOn: [],
      });
    }

    return modules;
  }

  private getStageDependencies(stage: string, allStages: string[]): string[] {
    const idx = allStages.indexOf(stage);
    if (idx <= 0) return [];
    return [allStages[idx - 1]];
  }

  private buildDependencies(agent: SelfRepresentationBuilderOptions['agent']): ModuleDependency[] {
    const deps: ModuleDependency[] = [];
    const stageConfig = agent.orchestrator.stageConfig;

    const phases: Array<{ stages: string[]; phase: string }> = [
      { stages: stageConfig.preLoop ?? [], phase: 'preLoop' },
      { stages: stageConfig.loop ?? [], phase: 'loop' },
      { stages: stageConfig.postLoop ?? [], phase: 'postLoop' },
    ];

    for (const { stages } of phases) {
      for (let i = 1; i < stages.length; i++) {
        deps.push({
          from: stages[i - 1],
          to: stages[i],
          type: 'uses',
        });
      }
    }

    // Phase boundary dependencies
    if (phases[0].stages.length > 0 && phases[1].stages.length > 0) {
      deps.push({
        from: phases[0].stages[phases[0].stages.length - 1],
        to: phases[1].stages[0],
        type: 'uses',
      });
    }
    if (phases[1].stages.length > 0 && phases[2].stages.length > 0) {
      deps.push({
        from: phases[1].stages[phases[1].stages.length - 1],
        to: phases[2].stages[0],
        type: 'uses',
      });
    }

    return deps;
  }

  private buildLayerDiagnostics(): LayerDiagnostic[] {
    return ECC_LAYERS.map(layer => ({
      ...layer,
      lastCheckResult: undefined,
    }));
  }

  private buildModificationHistory(agent: SelfRepresentationBuilderOptions['agent']): ModificationRecord[] {
    const queryFn = agent.eventBus?.query;
    if (!queryFn) return [];

    const events = queryFn({ type: 'mutation' }) ?? [];
    return events
      .filter(e => e.type === 'mutation')
      .map(e => e.payload as unknown as ModificationRecord);
  }
}
