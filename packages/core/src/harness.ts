import type {
  CompressionStrategy,
  HarnessAPI,
  Hook,
  PipelineStage,
  Processor,
  ResourceDeclaration,
  ToolDefinition,
} from '@agentforge/sdk';
import type { PipelineRunner } from './pipeline.js';
import type { ToolRegistry } from './tool-registry.js';
import type { ContextBuilder } from './context-builder.js';
import type { HookManager } from './hook-manager.js';
import type { EventBus } from './event-bus.js';
import type { EventSystem } from './event-system.js';

export interface HarnessDeps {
  runner: PipelineRunner;
  registry: ToolRegistry;
  hookManager: HookManager;
  eventSystem: EventSystem;
  eventBus: EventBus;
  contextBuilder?: ContextBuilder;
  emitEvent: (eventType: string, data?: unknown) => void;
  registerProvider: (name: string, factory: unknown) => void;
}

export class HarnessAPIImpl implements HarnessAPI {
  private commands = new Map<string, (args: string) => Promise<void>>();
  private resources: ResourceDeclaration[] = [];
  private unsubFns: Array<() => void> = [];

  constructor(private deps: HarnessDeps) {}

  registerProcessor(stage: PipelineStage, processor: Processor): void {
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

  registerHook(hook: Hook): void {
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
