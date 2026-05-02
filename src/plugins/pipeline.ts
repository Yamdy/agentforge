/**
 * AgentForge Plugin Pipeline — Imperative Version
 *
 * Replaces buildPluginPipeline(source, plugins) with:
 * applyPlugins(plugins, hookRegistry, emitter) — registers hooks + event subscriptions.
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import type { AgentEvent } from '../core/events.js';
import type { Plugin, PluginContext, InterceptorPlugin, ObserverPlugin } from './plugin.js';
import { HookRegistry, type RequestHook } from '../core/hooks.js';
import { AgentEventEmitter } from '../core/events.js';

// ==============================
// Bridge: old intercept → RequestHook
// ==============================

/**
 * Create RequestHook + lifecycle hooks from a legacy InterceptorPlugin.
 * Handles both llm.request (→ RequestHook) and agent.start (→ lifecycle hook for side effects).
 */
function bridgeInterceptor(
  plugin: InterceptorPlugin,
  ctx: PluginContext
): {
  requestHooks: RequestHook[];
  lifecycleUnregs: Array<() => void>;
} {
  const requestHooks: RequestHook[] = [];
  const lifecycleUnregs: Array<() => void> = [];
  const eventTypes = plugin.eventTypes;

  // ── llm.request → RequestHook ──
  if (eventTypes.length === 0 || eventTypes.includes('llm.request')) {
    requestHooks.push({
      name: `${plugin.name}-intercept`,
      priority: plugin.priority,
      async apply(messages, _state) {
        try {
          const syntheticEvent: any = {
            type: 'llm.request',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            messages,
          };
          const result = await Promise.resolve(plugin.intercept!(syntheticEvent, ctx));
          if (result && typeof result === 'object' && 'messages' in result) {
            return result.messages;
          }
        } catch {
          /* isolate */
        }
        return messages;
      },
    });
  }

  return { requestHooks, lifecycleUnregs };
}

/**
 * Bridge agent.start for legacy interceptors that need initialization.
 * Returns lifecycle hook registrations that fire on session.start,
 * calling intercept() for its side effects.
 */
function bridgeAgentStart(
  plugin: InterceptorPlugin,
  ctx: PluginContext,
  hookRegistry: HookRegistry
): Array<() => void> {
  const eventTypes = plugin.eventTypes;
  if (eventTypes.length > 0 && !eventTypes.includes('agent.start')) return [];

  const unregs: Array<() => void> = [];
  unregs.push(
    hookRegistry.on(
      'session.start',
      async () => {
        try {
          const syntheticEvent: any = {
            type: 'agent.start',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            agentName: ctx.agentName,
            input: '',
            model: { provider: '', model: '' },
          };
          await Promise.resolve(plugin.intercept!(syntheticEvent, ctx));
        } catch {
          /* isolate */
        }
      },
      plugin.priority
    )
  );
  return unregs;
}

/**
 * Bridge legacy ObserverPlugin to event subscriptions.
 */
function bridgeObserver(
  plugin: ObserverPlugin,
  ctx: PluginContext,
  emitter: AgentEventEmitter
): Array<() => void> {
  const unregs: Array<() => void> = [];
  const eventTypes = plugin.eventTypes;
  const filterSet = eventTypes.length > 0 ? new Set(eventTypes) : null;

  const unreg = emitter.onAny((event: AgentEvent) => {
    if (filterSet && !filterSet.has(event.type)) return;
    void Promise.resolve()
      .then(() => plugin.observe!(event, ctx))
      .catch(() => {
        /* isolate */
      });
  });
  unregs.push(unreg);
  return unregs;
}

// ==============================
// New Imperative API
// ==============================

/**
 * Apply all plugins: register their hooks and event subscriptions.
 * Also bridges legacy InterceptorPlugin/ObserverPlugin to the new system.
 */
export function applyPlugins(
  plugins: readonly Plugin[],
  hookRegistry: HookRegistry,
  emitter: AgentEventEmitter,
  ctx: PluginContext
): () => void {
  const unregisters: Array<() => void> = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    // ── New-style hooks ──
    if (plugin.requestHooks) {
      for (const hook of plugin.requestHooks) {
        unregisters.push(hookRegistry.registerRequest(hook));
      }
    }

    if (plugin.toolHooks) {
      for (const hook of plugin.toolHooks) {
        unregisters.push(hookRegistry.registerTool(hook));
      }
    }

    if (plugin.toolProviderHooks) {
      for (const hook of plugin.toolProviderHooks) {
        unregisters.push(hookRegistry.registerToolProvider(hook));
      }
    }

    if (plugin.lifecycleHooks) {
      for (const h of plugin.lifecycleHooks) {
        unregisters.push(hookRegistry.on(h.name, h.fn, h.priority));
      }
    }

    if (plugin.eventSubscriptions) {
      for (const sub of plugin.eventSubscriptions) {
        unregisters.push(
          emitter.on(sub.event, event => {
            void Promise.resolve()
              .then(() => sub.handler(event))
              .catch(() => {
                /* isolate */
              });
          })
        );
      }
    }

    // ── Bridge: legacy interceptor → RequestHook + agent.start lifecycle ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = plugin as any;
    if (p.type === 'interceptor' && typeof p.intercept === 'function' && !plugin.requestHooks) {
      const bridged = bridgeInterceptor(p as InterceptorPlugin, ctx);
      for (const hook of bridged.requestHooks) {
        unregisters.push(hookRegistry.registerRequest(hook));
      }
      unregisters.push(...bridgeAgentStart(p as InterceptorPlugin, ctx, hookRegistry));
    }

    // ── Bridge: legacy observer → event subscription ──
    if (p.type === 'observer' && typeof p.observe === 'function' && !plugin.eventSubscriptions) {
      unregisters.push(...bridgeObserver(p as ObserverPlugin, ctx, emitter));
    }
  }

  return () => {
    for (const unreg of unregisters) {
      try {
        unreg();
      } catch {
        /* isolate */
      }
    }
  };
}
