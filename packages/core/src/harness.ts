import type {
  CompressionStrategy,
  CompositeHook,
  HarnessAPI,
  Hook,
  Processor,
  ResourceDeclaration,
  StageMutation,
  StageName,
  ToolDefinition,
} from '@primo-ai/sdk';
import type { PipelineRunner } from './pipeline.js';
import type { ToolRegistry } from './tool-registry.js';
import type { ContextBuilder } from './context-builder.js';
import type { HookManager } from './hook-manager.js';
import type { EventBus } from './event-bus.js';
import type { EventSystem } from './event-system.js';
import type { MutabilityPolicyEngine } from './mutability-policy.js';

export interface HarnessDeps {
  runner: PipelineRunner;
  registry: ToolRegistry;
  hookManager: HookManager;
  eventSystem: EventSystem;
  eventBus: EventBus;
  contextBuilder?: ContextBuilder;
  emitEvent: (eventType: string, data?: unknown) => void;
  registerProvider: (name: string, factory: unknown) => void;
  mutateStages?: (mutation: StageMutation) => void;
}

export class HarnessAPIImpl implements HarnessAPI {
  private commands = new Map<string, (args: string) => Promise<void>>();
  private resources: ResourceDeclaration[] = [];
  private unsubFns: Array<() => void> = [];
  private mutabilityPolicy?: MutabilityPolicyEngine;

  constructor(private deps: HarnessDeps) {}

  setMutabilityPolicy(policy: MutabilityPolicyEngine): void {
    this.mutabilityPolicy = policy;
  }

  registerProcessor(stage: StageName, processor: Processor): void {
    this.deps.runner.register(processor);
  }

  registerTool(tool: ToolDefinition): void {
    this.deps.registry.register(tool);
  }

  unregisterTool(name: string): boolean {
    return this.deps.registry.unregister(name);
  }

  registerCommand(name: string, handler: (args: string) => Promise<void>): void {
    this.commands.set(name, handler);
  }

  registerHook(hook: Hook | CompositeHook): void {
    this.deps.hookManager.register(hook);
  }

  subscribe(eventType: string, handler: (data?: unknown) => void): () => void {
    const unsub = this.deps.eventBus.subscribe(eventType, handler);
    this.unsubFns.push(unsub);
    return unsub;
  }

  registerResource(declaration: ResourceDeclaration): void {
    this.resources.push(declaration);
  }

  registerProvider(name: string, factory: unknown): void {
    this.deps.registerProvider(name, factory);
  }

  registerCompressionStrategy(strategy: CompressionStrategy): void {
    if (this.deps.contextBuilder) {
      this.deps.contextBuilder.setCompressionStrategy(strategy);
    }
  }

  emit(eventType: string, data?: unknown): void {
    this.deps.emitEvent(eventType, data);
  }

  insertStage(phase: 'preLoop' | 'loop' | 'postLoop', after: StageName, newStage: StageName): void {
    if (!this.mutabilityPolicy?.canApplyDirectly('pipeline')) {
      throw new Error('Pipeline mutation not allowed by current mutability policy');
    }
    this.deps.mutateStages?.({ type: 'insert', phase, after, stage: newStage });
  }

  removeStage(phase: 'preLoop' | 'loop' | 'postLoop', stage: StageName): void {
    if (!this.mutabilityPolicy?.canApplyDirectly('pipeline')) {
      throw new Error('Pipeline mutation not allowed by current mutability policy');
    }
    this.deps.mutateStages?.({ type: 'remove', phase, stage });
  }

  replaceStages(phase: 'preLoop' | 'loop' | 'postLoop', stages: StageName[]): void {
    if (!this.mutabilityPolicy?.canApplyDirectly('pipeline')) {
      throw new Error('Pipeline mutation not allowed by current mutability policy');
    }
    this.deps.mutateStages?.({ type: 'replace', phase, stages });
  }

  getCommands(): Map<string, (args: string) => Promise<void>> {
    return this.commands;
  }

  getResources(): ResourceDeclaration[] {
    return this.resources;
  }

  getUnsubFns(): Array<() => void> {
    return this.unsubFns;
  }
}
