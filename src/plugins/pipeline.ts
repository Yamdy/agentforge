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
import type { CheckpointPhase, CheckpointFn } from '../core/hooks.js';
import { HookRegistry } from '../core/hooks.js';
import { AgentEventEmitter, serializeError } from '../core/events.js';

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
  getCheckpoints(phase: CheckpointPhase): CheckpointFn[];
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
  ctx: PluginContext
): AppliedPipeline {
  const unregisters: Array<() => void> = [];
  const checkpointMap = new Map<CheckpointPhase, Array<{ priority: number; fn: CheckpointFn }>>();

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

    // ── Recovery hooks ──
    if (plugin.recoveryHooks) {
      for (const rh of plugin.recoveryHooks) {
        unregisters.push(hookRegistry.onRecovery(rh.phase, rh.fn, rh.priority));
      }
    }

    // ── Lifecycle hooks ──
    if (plugin.lifecycleHooks) {
      for (const lh of plugin.lifecycleHooks) {
        unregisters.push(hookRegistry.on(lh.phase, lh.fn, lh.priority));
      }
    }

    // ── System prompt hooks ──
    if (plugin.systemPromptHooks) {
      for (const hook of plugin.systemPromptHooks) {
        unregisters.push(hookRegistry.registerSystemPrompt(hook));
      }
    }

    // ── LLM params hooks ──
    if (plugin.llmParamsHooks) {
      for (const hook of plugin.llmParamsHooks) {
        unregisters.push(hookRegistry.registerLLMParams(hook));
      }
    }

    // ── Message hooks ──
    if (plugin.messageHooks) {
      for (const hook of plugin.messageHooks) {
        unregisters.push(hookRegistry.registerMessage(hook));
      }
    }

    // ── Tool execute hooks ──
    if (plugin.toolExecuteHooks) {
      for (const hook of plugin.toolExecuteHooks) {
        unregisters.push(hookRegistry.registerToolExecute(hook));
      }
    }

    // ── Event subscriptions ──
    if (plugin.eventSubscriptions) {
      for (const sub of plugin.eventSubscriptions) {
        unregisters.push(
          emitter.on(sub.event, event =>
            Promise.resolve(sub.handler(event)).catch((err: unknown) => {
              ctx.logger?.warn('Plugin event subscription error', {
                eventType: sub.event,
                error: serializeError(err),
              });
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
        } catch (err) {
          ctx.logger?.warn('Plugin unregister error', {
            error: serializeError(err),
          });
        }
      }
    },
    getCheckpoints: (phase: CheckpointPhase): CheckpointFn[] => {
      return (checkpointMap.get(phase) ?? []).map(e => e.fn);
    },
  };
}
