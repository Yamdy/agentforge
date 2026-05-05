/**
 * AgentForge Plugin Pipeline — Imperative Version
 *
 * Applies plugins by registering their hooks and event subscriptions
 * into the HookRegistry and AgentEventEmitter. Also collects checkpoint
 * hooks for the agent loop to execute at lifecycle phases.
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import type { Plugin, PluginContext } from './plugin.js';
import type { LifecyclePhase, CheckpointFn } from '../core/hooks.js';
import { HookRegistry } from '../core/hooks.js';
import { AgentEventEmitter } from '../core/events.js';

// ==============================
// Applied Pipeline
// ==============================

/**
 * Result of applyPlugins — provides cleanup and checkpoint access.
 */
export interface AppliedPipeline {
  /** Remove all registered hooks and subscriptions */
  unregister(): void;
  /** Get checkpoint functions for a lifecycle phase, sorted by priority */
  getCheckpoints(phase: LifecyclePhase): CheckpointFn[];
}

// ==============================
// Apply Plugins
// ==============================

/**
 * Apply all plugins: register their hooks, event subscriptions, and
 * collect checkpoint hooks for execution at lifecycle phases.
 */
export function applyPlugins(
  plugins: readonly Plugin[],
  hookRegistry: HookRegistry,
  emitter: AgentEventEmitter,
  _ctx: PluginContext
): AppliedPipeline {
  const unregisters: Array<() => void> = [];
  const checkpointMap = new Map<LifecyclePhase, Array<{ priority: number; fn: CheckpointFn }>>();

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    // ── Request hooks ──
    if (plugin.requestHooks) {
      for (const hook of plugin.requestHooks) {
        unregisters.push(hookRegistry.registerRequest(hook));
      }
    }

    // ── Tool hooks ──
    if (plugin.toolHooks) {
      for (const hook of plugin.toolHooks) {
        unregisters.push(hookRegistry.registerTool(hook));
      }
    }

    // ── ToolProvider hooks ──
    if (plugin.toolProviderHooks) {
      for (const hook of plugin.toolProviderHooks) {
        unregisters.push(hookRegistry.registerToolProvider(hook));
      }
    }

    // ── Checkpoint hooks ──
    if (plugin.checkpointHooks) {
      for (const ch of plugin.checkpointHooks) {
        let entries = checkpointMap.get(ch.phase);
        if (!entries) {
          entries = [];
          checkpointMap.set(ch.phase, entries);
        }
        entries.push({ priority: ch.priority, fn: ch.check });
        entries.sort((a, b) => a.priority - b.priority);
      }
    }

    // ── Event subscriptions ──
    if (plugin.eventSubscriptions) {
      for (const sub of plugin.eventSubscriptions) {
        unregisters.push(
          emitter.on(sub.event, event =>
            Promise.resolve(sub.handler(event)).catch(() => {
              /* isolate */
            })
          )
        );
      }
    }
  }

  return {
    unregister: () => {
      for (const unreg of unregisters) {
        try {
          unreg();
        } catch {
          /* isolate */
        }
      }
    },
    getCheckpoints: (phase: LifecyclePhase): CheckpointFn[] => {
      return (checkpointMap.get(phase) ?? []).map(e => e.fn);
    },
  };
}
