import type {
  EventType,
  HarnessAPI,
  PluginRegistration,
  StageMutation,
} from '@primo-ai/sdk';
import type { PipelineRunner } from './pipeline.js';
import type { ToolRegistry } from './tool-registry.js';
import type { ContextBuilder } from './context-builder.js';
import { resolve, relative, isAbsolute } from 'node:path';
import { EventBus } from './event-bus.js';
import { EventSystem } from './event-system.js';
import { HookManager } from './hook-manager.js';
import { HarnessAPIImpl } from './harness.js';

export type PluginFactory = (api: HarnessAPI) => PluginRegistration | void;

function validatePluginPath(filePath: string): { valid: boolean; reason?: string } {
  if (/^(@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_-]+$/.test(filePath)) {
    return { valid: true };
  }
  const root = resolve(process.cwd());
  const resolved = resolve(root, filePath);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { valid: false, reason: `Plugin path "${filePath}" resolves outside project root` };
  }
  return { valid: true };
}

export class PluginManager {
  private runner: PipelineRunner;
  private registry: ToolRegistry;
  private contextBuilder?: ContextBuilder;
  private _eventSystem = new EventSystem();
  readonly hookManager: HookManager;
  private _harnessInstances: HarnessAPIImpl[] = [];
  private resourceInstances = new Map<string, unknown>();
  private errors: Array<{ source: string; error: Error }> = [];
  private stageMutator?: (mutation: StageMutation) => void;

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
    const validation = validatePluginPath(filePath);
    if (!validation.valid) {
      this.errors.push({ source: filePath, error: new Error(validation.reason!) });
      return;
    }
    try {
      const module = await import(filePath);
      const factory = module.default ?? module;
      if (typeof factory !== 'function') {
        throw new Error(`Plugin at "${filePath}" does not export a factory function`);
      }
      this.initializePlugin(factory);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.eventBus.emit('plugin:load_error', { source: filePath, error });
      this.errors.push({ source: filePath, error });
    }
  }

  initializePlugin(factory: PluginFactory): void {
    const api = this.createHarnessAPI();
    factory(api);
  }

  async loadPluginsFromConfig(config: { plugins?: Array<{ path: string }> }): Promise<void> {
    const plugins = config.plugins ?? [];
    for (const { path } of plugins) {
      await this.loadPlugin(path);
    }
  }

  getCommand(name: string): ((args: string) => Promise<void>) | undefined {
    for (const h of this._harnessInstances) {
      const cmd = h.getCommands().get(name);
      if (cmd) return cmd;
    }
    return undefined;
  }

  getErrors(): Array<{ source: string; error: Error }> {
    return this.errors;
  }

  setStageMutator(mutator: (mutation: StageMutation) => void): void {
    this.stageMutator = mutator;
  }

  freezeHarnessInstances(): void {
    for (const h of this._harnessInstances) h.freeze();
  }

  emitEvent(eventType: EventType, ...args: unknown[]): void {
    this.eventBus.emit(eventType, args[0]);
  }

  async initializeAll(): Promise<void> {
    const allResources = this._harnessInstances.flatMap(h => h.getResources());
    for (const resource of allResources) {
      try {
        const instance = await resource.start();
        this.resourceInstances.set(resource.id, instance);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.eventBus.emit('plugin:resource_init_error', { source: `resource:${resource.id}`, error });
        this.errors.push({ source: `resource:${resource.id}`, error });
      }
    }
    if (this.errors.length > 0) {
      throw new AggregateError(
        this.errors.map(e => e.error),
        `Plugin initialization failed for ${this.errors.length} resource(s): ${this.errors.map(e => e.source).join(', ')}`,
      );
    }
  }

  private _shutdown = false;

  async shutdown(): Promise<void> {
    if (this._shutdown) return;
    this._shutdown = true;

    const allResources = this._harnessInstances.flatMap(h => h.getResources());
    for (const resource of [...allResources].reverse()) {
      const instance = this.resourceInstances.get(resource.id);
      try {
        await resource.stop(instance);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.eventBus.emit('plugin:shutdown_error', { source: `resource:${resource.id}`, error });
        this.errors.push({ source: `resource:${resource.id}`, error });
      }
    }
    this.resourceInstances.clear();

    for (const h of this._harnessInstances) {
      for (const unsub of h.getUnsubFns()) unsub();
    }
    this._harnessInstances = [];
  }

  private createHarnessAPI(): HarnessAPI {
    const impl = new HarnessAPIImpl({
      runner: this.runner,
      registry: this.registry,
      hookManager: this.hookManager,
      eventSystem: this._eventSystem,
      eventBus: this.eventBus,
      contextBuilder: this.contextBuilder,
      emitEvent: (eventType, data) => this.emitEvent(eventType, data),
      registerProvider: (_name, _factory) => {},
      mutateStages: (mutation) => this.stageMutator?.(mutation),
    });
    this._harnessInstances.push(impl);
    return impl;
  }
}
