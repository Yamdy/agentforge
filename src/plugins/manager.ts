/**
 * AgentForge Plugin Manager
 *
 * Manages plugin registration, lifecycle, and pipeline construction.
 *
 * Lifecycle:
 * 1. Register plugin -> init() called with context
 * 2. Enable/disable -> marks enabled flag (requires rebuild)
 * 3. Unregister -> destroy() called, removed from registry
 *
 * Pipeline building:
 * - Pipeline is immutable once built
 * - Enable/disable requires rebuilding the pipeline
 * - Use buildPipeline() after changing plugin state
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/07-PLUGIN-SYSTEM.md
 */

import { Observable } from 'rxjs';
import type { AgentEvent } from '../core/events.js';
import type { Plugin, PluginContext, InterceptorPlugin, ObserverPlugin } from './plugin.js';
import { validatePlugin } from './plugin.js';
import { buildPluginPipeline } from './pipeline.js';

// ============================================================
// Plugin Manager
// ============================================================

/**
 * Plugin manager - registration, lifecycle, and pipeline construction
 *
 * Usage:
 * ```typescript
 * const manager = new PluginManager();
 * manager.register(loggingPlugin);
 * manager.register(permissionPlugin);
 *
 * const pipeline = manager.buildPipeline(source, ctx);
 * pipeline.subscribe(event => { ... });
 * ```
 */
export class PluginManager {
  private readonly plugins: Map<string, Plugin> = new Map();
  private pluginContext?: PluginContext;

  /**
   * Register a plugin
   *
   * Validates the plugin and calls init() if context is available.
   *
   * @param plugin - Plugin to register
   * @throws Error if plugin with same name is already registered
   */
  register(plugin: Plugin): void {
    // Validate third-party plugins (Tier 1 safety)
    // Internal plugins skip validation for performance
    if (!this.isInternalPlugin(plugin)) {
      validatePlugin(plugin);
    }

    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    this.plugins.set(plugin.name, plugin);

    // Initialize if context is already set
    if (this.pluginContext && plugin.init) {
      // Safe to ignore promise - init can be async
      void this.safeInit(plugin);
    }
  }

  /**
   * Register multiple plugins
   *
   * @param plugins - Plugins to register
   */
  registerAll(plugins: readonly Plugin[]): void {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  /**
   * Unregister a plugin
   *
   * Calls destroy() on the plugin if defined.
   *
   * @param name - Plugin name to unregister
   */
  unregister(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      if (plugin.destroy) {
        try {
          plugin.destroy();
        } catch {
          // Silently ignore destroy errors
        }
      }
      this.plugins.delete(name);
    }
  }

  /**
   * Enable a plugin
   *
   * Note: Requires rebuilding the pipeline to take effect.
   *
   * @param name - Plugin name to enable
   */
  enable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = true;
    }
  }

  /**
   * Disable a plugin
   *
   * Note: Requires rebuilding the pipeline to take effect.
   *
   * @param name - Plugin name to disable
   */
  disable(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = false;
    }
  }

  /**
   * Check if a plugin is registered
   *
   * @param name - Plugin name
   * @returns True if plugin is registered
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get a plugin by name
   *
   * @param name - Plugin name
   * @returns Plugin or undefined
   */
  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugins
   *
   * @returns Array of all plugins
   */
  getAll(): Plugin[] {
    return [...this.plugins.values()];
  }

  /**
   * Get all enabled plugins
   *
   * @returns Array of enabled plugins
   */
  getActivePlugins(): Plugin[] {
    return [...this.plugins.values()].filter(p => p.enabled);
  }

  /**
   * Get all interceptor plugins
   *
   * @returns Array of interceptor plugins
   */
  getInterceptors(): InterceptorPlugin[] {
    return [...this.plugins.values()].filter(
      (p): p is InterceptorPlugin => p.type === 'interceptor'
    );
  }

  /**
   * Get all observer plugins
   *
   * @returns Array of observer plugins
   */
  getObservers(): ObserverPlugin[] {
    return [...this.plugins.values()].filter(
      (p): p is ObserverPlugin => p.type === 'observer'
    );
  }

  /**
   * Set the plugin context
   *
   * This context is used for all plugin initialization.
   *
   * @param ctx - Plugin context
   */
  setContext(ctx: PluginContext): void {
    this.pluginContext = ctx;
  }

  /**
   * Get the current plugin context
   *
   * @returns Current context or undefined
   */
  getContext(): PluginContext | undefined {
    return this.pluginContext;
  }

  /**
   * Build the plugin pipeline
   *
   * Creates a new pipeline from all active plugins.
   * Must be called after enabling/disabling plugins.
   *
   * @param source - Source observable
   * @param ctx - Plugin context (optional if already set)
   * @returns Pipeline observable
   */
  buildPipeline(
    source: Observable<AgentEvent>,
    ctx?: PluginContext
  ): Observable<AgentEvent> {
    // Update context if provided
    if (ctx) {
      this.pluginContext = ctx;
    }

    const context = this.pluginContext;
    if (!context) {
      throw new Error('Plugin context not set. Call setContext() or pass ctx parameter.');
    }

    // Initialize any plugins that haven't been initialized yet
    for (const plugin of this.getActivePlugins()) {
      if (plugin.init) {
        void this.safeInit(plugin);
      }
    }

    return buildPluginPipeline(source, this.getActivePlugins(), context);
  }

  /**
   * Clear all plugins
   *
   * Calls destroy() on all plugins that define it.
   */
  clear(): void {
    for (const plugin of this.plugins.values()) {
      if (plugin.destroy) {
        try {
          plugin.destroy();
        } catch {
          // Silently ignore destroy errors
        }
      }
    }
    this.plugins.clear();
  }

  /**
   * Get plugin count
   *
   * @returns Total number of registered plugins
   */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * Get active plugin count
   *
   * @returns Number of enabled plugins
   */
  get activeCount(): number {
    return this.getActivePlugins().length;
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Safely initialize a plugin
   *
   * Catches and logs any errors during initialization.
   */
  private async safeInit(plugin: Plugin): Promise<void> {
    if (!plugin.init || !this.pluginContext) return;

    try {
      await plugin.init(this.pluginContext);
    } catch (err) {
      // Log but don't throw - plugin init failure shouldn't crash the system
      console.error(`Plugin "${plugin.name}" init failed:`, err);
    }
  }

  /**
   * Check if plugin is internal (skip validation)
   *
   * Internal plugins are defined within the framework and
   * don't need runtime validation.
   */
  private isInternalPlugin(plugin: Plugin): boolean {
    // Check if plugin was imported from AgentForge internals
    // Internal plugins have a marker symbol
    return '_internal' in plugin;
  }
}

// ============================================================
// Plugin Manager Factory
// ============================================================

/**
 * Create a new plugin manager
 *
 * @returns New PluginManager instance
 */
export function createPluginManager(): PluginManager {
  return new PluginManager();
}
