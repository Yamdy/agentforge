import { Subject, Observable, filter, map, mergeMap, Subscription } from 'rxjs';
import { Plugin, PluginSchema, type ProviderContext, type ProviderResult } from './types.js';
import { PluginContext, createPluginContext } from './context.js';

export interface PluginManagerConfig {
  plugins?: Plugin[];
}

type HookFunction = (input: unknown, output: unknown) => Promise<void>;

export class PluginManager {
  private plugins: Plugin[] = [];
  private context: PluginContext;
  private subjects: Map<string, Subject<{ event: string; input: unknown; output: unknown }>> = new Map();
  private subscriptions: Subscription = new Subscription();
  private pluginSubscriptions: Map<string, Subscription[]> = new Map();

  constructor(config: PluginManagerConfig = {}, directory: string = process.cwd()) {
    this.context = createPluginContext({ plugins: [] }, directory);
    if (config.plugins) {
      this.plugins = config.plugins;
      this.registerPluginHooks();
    }
  }

  private getOrCreateSubject(event: string): Subject<{ event: string; input: unknown; output: unknown }> {
    if (!this.subjects.has(event)) {
      this.subjects.set(event, new Subject());
    }
    return this.subjects.get(event)!;
  }

  private registerPluginHooks(): void {
    for (const plugin of this.plugins) {
      if (plugin.hooks) {
        const subs: Subscription[] = [];
        for (const [eventName, hook] of Object.entries(plugin.hooks)) {
          if (hook) {
            const sub = this.subscribeToEvent(eventName, hook as HookFunction, plugin.name);
            subs.push(sub);
          }
        }
        this.pluginSubscriptions.set(plugin.name, subs);
      }
    }
  }

  private subscribeToEvent(event: string, handler: HookFunction, pluginName: string): Subscription {
    const subject = this.getOrCreateSubject(event);
    const sub = subject
      .pipe(
        mergeMap(async (payload) => {
          try {
            await handler(payload.input, payload.output);
            return { success: true, plugin: pluginName };
          } catch (err) {
            this.context.logger.error(`Hook ${event} failed for plugin ${pluginName}`, {
              error: err instanceof Error ? err.message : String(err),
            });
            return { success: false, plugin: pluginName, error: err };
          }
        })
      )
      .subscribe();

    this.subscriptions.add(sub);
    return sub;
  }

  register(plugin: Plugin): void {
    PluginSchema.parse(plugin);
    this.plugins.push(plugin);
    this.context.logger.info('Plugin registered', { name: plugin.name });

    if (plugin.hooks) {
      const subs: Subscription[] = this.pluginSubscriptions.get(plugin.name) ?? [];
      for (const [eventName, hook] of Object.entries(plugin.hooks)) {
        if (hook) {
          const sub = this.subscribeToEvent(eventName, hook as HookFunction, plugin.name);
          subs.push(sub);
        }
      }
      this.pluginSubscriptions.set(plugin.name, subs);
    }
  }

  unregister(name: string): void {
    const index = this.plugins.findIndex(p => p.name === name);
    if (index !== -1) {
      this.plugins.splice(index, 1);
      const subs = this.pluginSubscriptions.get(name);
      if (subs) {
        subs.forEach(s => s.unsubscribe());
        this.pluginSubscriptions.delete(name);
      }
      this.context.logger.info('Plugin unregistered', { name });
    }
  }

  list(): Plugin[] {
    return [...this.plugins];
  }

  get(name: string): Plugin | undefined {
    return this.plugins.find(p => p.name === name);
  }

  async collectProviders(ctx: ProviderContext): Promise<ProviderResult[]> {
    const results: ProviderResult[] = [];
    for (const plugin of this.plugins) {
      if (plugin.provider) {
        try {
          const result = await plugin.provider(ctx);
          if (result) {
            results.push(result);
            this.context.logger.info('Provider collected', { plugin: plugin.name });
          }
        } catch (err) {
          this.context.logger.error(`Provider failed for plugin ${plugin.name}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return results;
  }

  on(event: string, handler: HookFunction): Subscription {
    const subject = this.getOrCreateSubject(event);
    const sub = subject
      .pipe(
        filter((payload) => payload.event === event),
        map((payload) => ({ input: payload.input, output: payload.output }))
      )
      .subscribe(async ({ input, output }) => {
        try {
          await handler(input, output);
        } catch (err) {
          this.context.logger.error(`Handler for ${event} failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

    this.subscriptions.add(sub);
    return sub;
  }

  async trigger(event: string, input: unknown, output: unknown): Promise<unknown> {
    const hooks = this.getEventHooks(event);
    const modifiedOutput = output;

    for (const hook of hooks) {
      try {
        await hook(input, modifiedOutput);
      } catch (err) {
        this.context.logger.error(`Hook ${event} failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return modifiedOutput;
  }

  private getEventHooks(event: string): HookFunction[] {
    const hooks: HookFunction[] = [];
    for (const plugin of this.plugins) {
      if (plugin.hooks?.[event]) {
        hooks.push(plugin.hooks[event] as HookFunction);
      }
    }
    return hooks;
  }

  observable(event: string): Observable<{ input: unknown; output: unknown }> {
    const subject = this.getOrCreateSubject(event);
    return subject.pipe(
      filter((payload) => payload.event === event),
      map((payload) => ({ input: payload.input, output: payload.output }))
    );
  }

  destroy(): void {
    this.subscriptions.unsubscribe();
    this.subjects.forEach((subject) => subject.complete());
    this.subjects.clear();
    this.pluginSubscriptions.clear();
  }
}

export function createPluginManager(config?: PluginManagerConfig, directory?: string): PluginManager {
  return new PluginManager(config, directory);
}
