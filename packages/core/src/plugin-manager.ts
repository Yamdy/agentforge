import type {
  CompressionStrategy,
  EventType,
  HarnessAPI,
  Hook,
  PluginRegistration,
  PipelineStage,
  Processor,
  ResourceDeclaration,
  ToolDefinition,
} from '@agentforge/sdk';
import type { PipelineRunner } from './pipeline.js';
import type { ToolRegistry } from './tool-registry.js';
import type { ContextBuilder } from './context-builder.js';
import { EventBus } from './event-bus.js';
import { EventSystem } from './event-system.js';
import { HookManager } from './hook-manager.js';

export type PluginFactory = (api: HarnessAPI) => PluginRegistration | void;

export class PluginManager {
  private runner: PipelineRunner;
  private registry: ToolRegistry;
  private contextBuilder?: ContextBuilder;
  private commands = new Map<string, (args: string) => Promise<void>>();
  private _eventSystem = new EventSystem();
  readonly hookManager: HookManager;
  private resources: ResourceDeclaration[] = [];
  private unsubFns: Array<() => void> = [];
  private resourceInstances = new Map<string, unknown>();
  private errors: Array<{ source: string; error: Error }> = [];

  get eventBus(): EventBus {
    return this._eventSystem.bus;
  }

  get eventSystem(): EventSystem {
    return this._eventSystem;
  }

  constructor(runner: PipelineRunner, registry: ToolRegistry, contextBuilder?: ContextBuilder) {
    this.runner = runner;
    this.registry = registry;
    this.contextBuilder = contextBuilder;
    this.hookManager = new HookManager(this.eventBus);
    registry.setHookManager(this.hookManager);
  }

  async loadPlugin(filePath: string): Promise<void> {
    try {
      const module = await import(filePath);
      const factory = module.default ?? module;
      if (typeof factory !== 'function') {
        throw new Error(`Plugin at "${filePath}" does not export a factory function`);
      }
      this.initializePlugin(factory);
    } catch (err) {
      this.errors.push({
        source: filePath,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  initializePlugin(factory: PluginFactory): void {
    const api = this.createHarnessAPI();
    factory(api);
  }

  getCommand(name: string): ((args: string) => Promise<void>) | undefined {
    return this.commands.get(name);
  }

  getErrors(): Array<{ source: string; error: Error }> {
    return this.errors;
  }

  emitEvent(eventType: EventType, ...args: unknown[]): void {
    this.eventBus.emit(eventType, args[0]);
  }

  async initializeAll(): Promise<void> {
    for (const resource of this.resources) {
      try {
        const instance = await resource.start();
        this.resourceInstances.set(resource.id, instance);
      } catch (err) {
        this.errors.push({
          source: `resource:${resource.id}`,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
  }

  private _shutdown = false;

  async shutdown(): Promise<void> {
    if (this._shutdown) return;
    this._shutdown = true;

    for (const resource of [...this.resources].reverse()) {
      const instance = this.resourceInstances.get(resource.id);
      try {
        await resource.stop(instance);
      } catch (err) {
        this.errors.push({
          source: `resource:${resource.id}`,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
    this.resourceInstances.clear();

    for (const unsub of this.unsubFns) unsub();
    this.unsubFns.length = 0;
  }

  private createHarnessAPI(): HarnessAPI {
    return {
      registerProcessor: (stage: PipelineStage, processor: Processor) => {
        this.runner.register(processor);
      },
      registerTool: (tool: ToolDefinition) => {
        this.registry.register(tool);
      },
      unregisterTool: (name: string) => {
        return this.registry.unregister(name);
      },
      registerCommand: (name: string, handler: (args: string) => Promise<void>) => {
        this.commands.set(name, handler);
      },
      registerHook: (hook: Hook) => {
        this.hookManager.register(hook);
      },
      subscribe: (eventType: string, handler: (data?: unknown) => void): (() => void) => {
        const unsub = this.eventBus.subscribe(eventType, handler);
        this.unsubFns.push(unsub);
        return unsub;
      },
      registerResource: (declaration: ResourceDeclaration) => {
        this.resources.push(declaration);
      },
      registerProvider: (_name: string, _factory: unknown) => {
        // Will be implemented when provider registration is needed
      },
      emit: (eventType: string, data?: unknown) => {
        this.emitEvent(eventType, data);
      },
      registerCompressionStrategy: (strategy: CompressionStrategy) => {
        if (this.contextBuilder) {
          this.contextBuilder.setCompressionStrategy(strategy);
        }
      },
    };
  }
}
