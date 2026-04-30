/**
 * AgentForge Plugin Manager — Imperative Version
 *
 * Manages plugin registration, lifecycle, and hook activation.
 * Internally wraps a HookRegistry + AgentEventEmitter.
 *
 * No RxJS — plugins register hooks, not intercept event streams.
 *
 * Lifecycle:
 * 1. Register plugin => init() called with context
 * 2. buildPipeline() => registers hooks + event subscriptions
 * 3. Unregister => destroy() called, hooks removed
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import type { AgentEventEmitter } from '../core/events.js';
import { HookRegistry } from '../core/hooks.js';
import type { Plugin, PluginContext } from './plugin.js';
import { validatePlugin } from './plugin.js';
import { applyPlugins } from './pipeline.js';

/**
 * Plugin manager — registration, lifecycle, and hook activation.
 */
export class PluginManager {
  private readonly plugins: Map<string, Plugin> = new Map();
  private pluginContext?: PluginContext;
  /** Combined unregister function from applyPlugins */
  private unregisterHooks?: () => void;

  /**
   * Register a plugin.
   *
   * @param plugin - Plugin to register
   * @throws Error if plugin with same name is already registered
   */
  register(plugin: Plugin): void {
    // Validate third-party plugins (Tier 1 safety)
    if (!this.isInternalPlugin(plugin)) {
      validatePlugin(plugin);
    }

    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    this.plugins.set(plugin.name, plugin);

    // Initialize if context is already set
    if (this.pluginContext && plugin.init) {
      void this.safeInit(plugin);
    }
  }

  /**
   * Register multiple plugins.
   */
  registerAll(plugins: readonly Plugin[]): void {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  /**
   * Unregister a plugin.
   */
  unregister(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      if (plugin.destroy) {
        try { plugin.destroy(); } catch { /* isolate */ }
      }
      this.plugins.delete(name);
    }
  }

  enable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) plugin.enabled = true;
  }

  disable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) plugin.enabled = false;
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  getAll(): Plugin[] {
    return [...this.plugins.values()];
  }

  getActivePlugins(): Plugin[] {
    return [...this.plugins.values()].filter((p) => p.enabled);
  }

  /** @deprecated — all plugins now use lifecycle hooks */
  getInterceptors(): any[] {
    return [...this.plugins.values()].filter((p: any) => p.type === 'interceptor');
  }

  /** @deprecated — all plugins now use lifecycle hooks */
  getObservers(): any[] {
    return [...this.plugins.values()].filter((p: any) => p.type === 'observer');
  }

  setContext(ctx: PluginContext): void {
    this.pluginContext = ctx;
  }

  getContext(): PluginContext | undefined {
    return this.pluginContext;
  }

  /**
   * Build the plugin pipeline — registers all plugin hooks and event subscriptions.
   *
   * @param hookRegistryOrSource - HookRegistry (new API) or deprecated Observable source (old API)
   * @param emitterOrCtx         - EventEmitter (new API) or PluginContext (old API)
   * @param ctx                  - Plugin context (new API only)
   */
  buildPipeline(
    hookRegistryOrSource: HookRegistry | any,
    emitterOrCtx?: AgentEventEmitter | PluginContext,
    ctx?: PluginContext
  ): any {
    // Detect old API: first arg is Observable (has .pipe/.subscribe)
    if (hookRegistryOrSource && typeof hookRegistryOrSource.pipe === 'function') {
      // Old API: initialize plugins first, then return pass-through Observable
      if (this.pluginContext) {
        for (const plugin of this.getActivePlugins()) {
          if (plugin.init) {
            void this.safeInit(plugin);
          }
        }
      }
      return hookRegistryOrSource;
    }

    const hookRegistry = hookRegistryOrSource as HookRegistry;
    const emitter = emitterOrCtx as AgentEventEmitter;
    const context = (ctx ?? (emitterOrCtx && !('emit' in emitterOrCtx!) ? emitterOrCtx : undefined)) as PluginContext | undefined;

    if (context) {
      this.pluginContext = context;
    }

    const resolvedCtx = this.pluginContext;
    if (!resolvedCtx) {
      throw new Error('Plugin context not set. Call setContext() or pass ctx parameter.');
    }

    // Initialize any plugins that haven't been initialized yet
    for (const plugin of this.getActivePlugins()) {
      if (plugin.init) {
        void this.safeInit(plugin);
      }
    }

    // Remove previous hook registrations
    this.unregisterHooks?.();

    // Apply all plugins — register hooks + subscriptions
    this.unregisterHooks = applyPlugins(
      this.getActivePlugins(),
      hookRegistry,
      emitter,
      resolvedCtx
    );
  }

  /**
   * Clear all plugins.
   */
  clear(): void {
    this.unregisterHooks?.();
    for (const plugin of this.plugins.values()) {
      if (plugin.destroy) {
        try { plugin.destroy(); } catch { /* isolate */ }
      }
    }
    this.plugins.clear();
  }

  get size(): number {
    return this.plugins.size;
  }

  get activeCount(): number {
    return this.getActivePlugins().length;
  }

  // ============================================================
  // Private
  // ============================================================

  private async safeInit(plugin: Plugin): Promise<void> {
    if (!plugin.init || !this.pluginContext) return;
    try {
      await plugin.init(this.pluginContext);
    } catch (err) {
      console.error(`Plugin "${plugin.name}" init failed:`, err);
    }
  }

  private isInternalPlugin(plugin: Plugin): boolean {
    return '_internal' in plugin;
  }
}

/**
 * Create a new plugin manager.
 */
export function createPluginManager(): PluginManager {
  return new PluginManager();
}
