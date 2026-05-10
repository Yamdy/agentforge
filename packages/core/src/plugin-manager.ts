import type {
  EventType,
  HarnessAPI,
  Hook,
  HookPoint,
  PluginRegistration,
  PipelineStage,
  Processor,
  ResourceDeclaration,
  ToolDefinition,
} from '@agentforge/sdk';
import type { PipelineRunner } from './pipeline.js';
import type { ToolRegistry } from './tool-registry.js';
import { EventBus } from './event-bus.js';

export type PluginFactory = (api: HarnessAPI) => PluginRegistration | void;

export class PluginManager {
  private runner: PipelineRunner;
  private registry: ToolRegistry;
  private commands = new Map<string, (args: string) => Promise<void>>();
  private eventBus = new EventBus();
  private hooks = new Map<HookPoint, Hook[]>();
  private sortedHooks = new Map<HookPoint, Hook[]>();
  private resources: ResourceDeclaration[] = [];
  private unsubFns: Array<() => void> = [];
  private resourceInstances = new Map<string, unknown>();
  private errors: Array<{ source: string; error: Error }> = [];

  constructor(runner: PipelineRunner, registry: ToolRegistry) {
    this.runner = runner;
    this.registry = registry;
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

  invokeHook(point: HookPoint, data?: unknown): void {
    const hooks = this.getSortedHooks(point);
    for (const hook of hooks) hook.handler(data);
  }

  async invokeWrapHook(point: HookPoint, data: unknown): Promise<unknown> {
    const hooks = this.getSortedHooks(point);
    if (hooks.length === 0) return data;

    let current = data;
    for (const hook of hooks) {
      const result = await hook.handler(current);
      if (result !== undefined) current = result;
    }
    return current;
  }

  private getSortedHooks(point: HookPoint): Hook[] {
    const cached = this.sortedHooks.get(point);
    if (cached) return cached;

    const hooks = this.hooks.get(point) ?? [];
    if (hooks.length <= 1) {
      this.sortedHooks.set(point, hooks);
      return hooks;
    }

    const sorted = [...hooks].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    this.sortedHooks.set(point, sorted);
    return sorted;
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

  async shutdown(): Promise<void> {
    // Stop resources in reverse order
    for (const resource of [...this.resources].reverse()) {
      const instance = this.resourceInstances.get(resource.id);
      try {
        await resource.stop(instance);
      } catch {
        // Best-effort shutdown
      }
    }
    this.resourceInstances.clear();

    // Clean up all subscriptions
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
      registerCommand: (name: string, handler: (args: string) => Promise<void>) => {
        this.commands.set(name, handler);
      },
      registerHook: (hook: Hook) => {
        let list = this.hooks.get(hook.point);
        if (!list) {
          list = [];
          this.hooks.set(hook.point, list);
        }
        list.push(hook);
        this.sortedHooks.delete(hook.point);
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
    };
  }
}
