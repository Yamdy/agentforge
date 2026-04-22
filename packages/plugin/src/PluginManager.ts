import { Effect } from "effect";
import type { Plugin, PluginHooks, PluginContext } from "./types";
import { PluginError } from "./types";

interface RegisteredPlugin {
  plugin: Plugin;
  enabled: boolean;
}

export class PluginManager {
  private plugins: Map<string, RegisteredPlugin> = new Map();
  private hooks: Map<string, Array<Function>> = new Map();
  private services: Map<string, unknown> = new Map();

  constructor(readonly agentForgeVersion: string = "0.1.0") {}

  registerService<T>(serviceId: string, service: T): void {
    this.services.set(serviceId, service);
  }

  getService<T>(serviceId: string): T | undefined {
    return this.services.get(serviceId) as T | undefined;
  }

  install(plugin: Plugin): Effect.Effect<void, PluginError> {
    const self = this;
    return Effect.gen(function* () {
      if (plugin.id && self.plugins.has(plugin.id)) {
        return yield* Effect.fail(new PluginError(`Plugin with id "${plugin.id}" already installed`));
      }

      const context: PluginContext = {
        agentForgeVersion: self.agentForgeVersion,
        config: {},
        registerHook: (event: string, handler: Function) => {
          if (!self.hooks.has(event)) {
            self.hooks.set(event, []);
          }
          self.hooks.get(event)!.push(handler);
        },
        getService: <T>(serviceId: string) => {
          return self.getService<T>(serviceId)!;
        },
      };

      yield* plugin.install(context);
      
      const pluginHooks = plugin.hooks();
      for (const [event, handler] of Object.entries(pluginHooks)) {
        if (handler) {
          if (!self.hooks.has(event)) {
            self.hooks.set(event, []);
          }
          self.hooks.get(event)!.push(handler);
        }
      }

      yield* plugin.initialize();

      self.plugins.set(plugin.id, { plugin, enabled: true });
    }) as unknown as Effect.Effect<void, PluginError>;
  }

  uninstall(pluginId: string): Effect.Effect<void, PluginError> {
    const self = this;
    return Effect.gen(function* () {
      const registered = pluginId && self.plugins.get(pluginId);
      if (!registered) {
        return yield* Effect.fail(new PluginError(`Plugin with id "${pluginId}" not found`));
      }

      yield* registered.plugin.destroy();
      yield* registered.plugin.uninstall();

      pluginId && self.plugins.delete(pluginId);
    }) as unknown as Effect.Effect<void, PluginError>;
  }

  enable(pluginId: string): Effect.Effect<void, PluginError> {
    const self = this;
    return Effect.sync(() => {
      const registered = pluginId && self.plugins.get(pluginId);
      if (!registered) {
        throw new PluginError(`Plugin with id "${pluginId}" not found`);
      }
      registered.enabled = true;
    });
  }

  disable(pluginId: string): Effect.Effect<void, PluginError> {
    const self = this;
    return Effect.sync(() => {
      const registered = pluginId && self.plugins.get(pluginId);
      if (!registered) {
        throw new PluginError(`Plugin with id "${pluginId}" not found`);
      }
      registered.enabled = false;
    });
  }

  get(pluginId: string): Plugin | undefined {
    const registered = this.plugins.get(pluginId);
    return registered?.plugin;
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values()).map((r) => r.plugin);
  }

  listEnabled(): Plugin[] {
    return Array.from(this.plugins.values())
      .filter((r) => r.enabled)
      .map((r) => r.plugin);
  }

  triggerHook(
    event: string,
    ...args: unknown[]
  ): Effect.Effect<void, PluginError> {
    const self = this;
    return Effect.gen(function* () {
      const handlers = self.hooks.get(event) || [];
      for (const handler of handlers) {
        yield* Effect.tryPromise({
          try: async () => {
            await (handler as any)(...args);
          },
          catch: (e) => new PluginError(`Hook error for ${event}`, e),
        });
      }
    }) as unknown as Effect.Effect<void, PluginError>;
  }
}
