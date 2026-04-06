import { Subject, Observable, filter, map, mergeMap, Subscription } from 'rxjs';
import { Plugin, PluginSchema } from './types.js';
import { PluginContext, createPluginContext } from './context.js';

export interface PluginManagerConfig {
  plugins?: Plugin[];
}

type AnyFunction = (input: any, output: any) => Promise<void>;

export class PluginManager {
  private plugins: Plugin[] = [];
  private context: PluginContext;
  private subjects: Map<string, Subject<any>> = new Map();
  private subscriptions: Subscription = new Subscription();

  constructor(config: PluginManagerConfig = {}, directory: string = process.cwd()) {
    this.context = createPluginContext({ plugins: [] }, directory);
    if (config.plugins) {
      this.plugins = config.plugins;
      this.registerPluginHooks();
    }
  }

  private getOrCreateSubject(event: string): Subject<any> {
    if (!this.subjects.has(event)) {
      this.subjects.set(event, new Subject());
    }
    return this.subjects.get(event)!;
  }

  private registerPluginHooks(): void {
    for (const plugin of this.plugins) {
      if (plugin.hooks) {
        for (const [eventName, hook] of Object.entries(plugin.hooks)) {
          if (hook) {
            this.subscribe(eventName, hook as AnyFunction, plugin.name);
          }
        }
      }
    }
  }

  private subscribe(event: string, handler: AnyFunction, pluginName: string): void {
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
  }

  register(plugin: Plugin): void {
    const validated = PluginSchema.parse(plugin);
    this.plugins.push(validated);
    this.context.logger.info('Plugin registered', { name: validated.name });

    if (validated.hooks) {
      for (const [eventName, hook] of Object.entries(validated.hooks)) {
        if (hook) {
          this.subscribe(eventName, hook as AnyFunction, validated.name);
        }
      }
    }
  }

  unregister(name: string): void {
    const index = this.plugins.findIndex(p => p.name === name);
    if (index !== -1) {
      this.plugins.splice(index, 1);
      this.context.logger.info('Plugin unregistered', { name });
    }
  }

  list(): Plugin[] {
    return [...this.plugins];
  }

  get(name: string): Plugin | undefined {
    return this.plugins.find(p => p.name === name);
  }

  on(event: string, handler: AnyFunction): Subscription {
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

  async trigger(event: string, input: any, output: any): Promise<any> {
    const subject = this.getOrCreateSubject(event);
    subject.next({ event, input, output });
    return output;
  }

  observable(event: string): Observable<{ input: any; output: any }> {
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
  }
}

export function createPluginManager(config?: PluginManagerConfig, directory?: string): PluginManager {
  return new PluginManager(config, directory);
}
