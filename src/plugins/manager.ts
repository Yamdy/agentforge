/**
 * AgentForge Plugin Manager — Imperative Version
 *
 * Manages plugin registration, lifecycle, and hook activation.
 * Internally wraps a HookRegistry + AgentEventEmitter.
 *
 * Plugins register hooks, not intercept event streams.
 *
 * Lifecycle:
 * 1. Register plugin => init() called with context
 * 2. buildPipeline() => registers hooks + event subscriptions
 * 3. Unregister => destroy() called, hooks removed
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import { type AgentEventEmitter, serializeError } from '../core/events.js';
import { HookRegistry } from '../core/hooks.js';
import type { LifecyclePhase, CheckpointFn } from '../core/hooks.js';
import type { Plugin, PluginContext } from './plugin.js';
import { applyPlugins, type AppliedPipeline } from './pipeline.js';

/**
 * Plugin manager — registration, lifecycle, and hook activation.
 */
export class PluginManager {
  private readonly plugins: Map<string, Plugin> = new Map();
  private pluginContext?: PluginContext;
  /** Applied pipeline with unregister + checkpoint access */
  private appliedPipeline?: AppliedPipeline;

  /**
   * Register a plugin.
   *
   * @param plugin - Plugin to register
   * @throws Error if plugin with same name is already registered
   */
  register(plugin: Plugin): void {
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
        try {
          plugin.destroy();
        } catch (err) {
          this.pluginContext?.logger?.warn('Plugin destroy error', {
            pluginName: name,
            error: serializeError(err),
          });
        }
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
    return [...this.plugins.values()].filter(p => p.enabled);
  }

  setContext(ctx: PluginContext): void {
    this.pluginContext = ctx;
  }

  getContext(): PluginContext | undefined {
    return this.pluginContext;
  }

  /**
   * Build the plugin pipeline — registers all plugin hooks and event subscriptions.
   */
  buildPipeline(hookRegistry: HookRegistry, emitter: AgentEventEmitter, ctx?: PluginContext): void {
    const context = ctx ?? this.pluginContext;
    if (!context) {
      throw new Error('Plugin context not set. Call setContext() or pass ctx parameter.');
    }

    this.pluginContext = context;

    for (const plugin of this.getActivePlugins()) {
      if (plugin.init) {
        void this.safeInit(plugin);
      }
    }

    this.appliedPipeline?.unregister();

    this.appliedPipeline = applyPlugins(this.getActivePlugins(), hookRegistry, emitter, context);
  }

  /**
   * Get checkpoint functions for a lifecycle phase.
   * Called by the agent loop at pre-llm / post-llm phases.
   */
  getCheckpoints(phase: LifecyclePhase): CheckpointFn[] {
    return this.appliedPipeline?.getCheckpoints(phase) ?? [];
  }

  /**
   * Clear all plugins.
   */
  clear(): void {
    this.appliedPipeline?.unregister();
    for (const plugin of this.plugins.values()) {
      if (plugin.destroy) {
        try {
          plugin.destroy();
        } catch (err) {
          this.pluginContext?.logger?.warn('Plugin destroy error on clear', {
            pluginName: plugin.name,
            error: serializeError(err),
          });
        }
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
}

/**
 * Create a new plugin manager.
 */
export function createPluginManager(): PluginManager {
  return new PluginManager();
}
