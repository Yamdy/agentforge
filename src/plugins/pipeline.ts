/**
 * AgentForge Plugin Pipeline — Imperative Version
 *
 * Replaces buildPluginPipeline(source, plugins) with:
 * applyPlugins(plugins, hookRegistry, emitter) — registers hooks + event subscriptions.
 *
 * Backward-compat stubs for test files still importing old RxJS pipeline functions.
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import { Observable, of, EMPTY } from 'rxjs';
import { mergeMap, tap } from 'rxjs/operators';
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
function bridgeInterceptor(plugin: InterceptorPlugin, ctx: PluginContext): {
  requestHooks: RequestHook[];
  lifecycleUnregs: Array<() => void>;
} {
  const requestHooks: RequestHook[] = [];
  const lifecycleUnregs: Array<() => void> = [];
  const eventTypes = plugin.eventTypes as readonly string[];

  // ── llm.request → RequestHook ──
  if (eventTypes.length === 0 || eventTypes.includes('llm.request')) {
    requestHooks.push({
      name: `${plugin.name}-intercept`,
      priority: plugin.priority,
      async apply(messages, _state) {
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
  const eventTypes = plugin.eventTypes as readonly string[];
  if (eventTypes.length > 0 && !eventTypes.includes('agent.start')) return [];

  const unregs: Array<() => void> = [];
  unregs.push(
    hookRegistry.on('session.start' as any, async () => {
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
      } catch { /* isolate */ }
    }, plugin.priority)
  );
  return unregs;
}

/**
 * Bridge legacy ObserverPlugin to event subscriptions.
 */
function bridgeObserver(plugin: ObserverPlugin, ctx: PluginContext, emitter: AgentEventEmitter): Array<() => void> {
  const unregs: Array<() => void> = [];
  const eventTypes = plugin.eventTypes as readonly string[];
  const filterSet = eventTypes.length > 0 ? new Set(eventTypes) : null;

  const unreg = emitter.onAny(async (event: AgentEvent) => {
    if (filterSet && !filterSet.has(event.type)) return;
    try {
      await Promise.resolve().then(() => plugin.observe!(event, ctx));
    } catch { /* isolate */ }
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

    if (plugin.lifecycleHooks) {
      for (const h of plugin.lifecycleHooks) {
        unregisters.push(hookRegistry.on(h.name, h.fn, h.priority));
      }
    }

    if (plugin.eventSubscriptions) {
      for (const sub of plugin.eventSubscriptions) {
        unregisters.push(emitter.on(sub.event as AgentEvent['type'], async (event) => {
          try { await Promise.resolve().then(() => sub.handler(event)); } catch { /* isolate */ }
        }));
      }
    }

    // ── Bridge: legacy interceptor → RequestHook + agent.start lifecycle ──
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
      try { unreg(); } catch { /* isolate */ }
    }
  };
}

// ==============================
// Backward-compat (for old tests)
// ==============================

/** @deprecated Use applyPlugins() + HookRegistry instead. */
export function buildPluginPipeline(
  source: Observable<AgentEvent>,
  plugins: readonly Plugin[],
  ctx: PluginContext
): Observable<AgentEvent> {
  const interceptors = (plugins as any[]).filter(
    (p: any) => p.type === 'interceptor' && p.enabled && typeof p.intercept === 'function'
  );
  const observers = (plugins as any[]).filter(
    (p: any) => p.type === 'observer' && p.enabled && typeof p.observe === 'function'
  );

  let pipeline = source;

  for (const ic of interceptors) {
    const eventTypes: string[] = ic.eventTypes || [];
    pipeline = pipeline.pipe(
      mergeMap(async (event: AgentEvent) => {
        if (eventTypes.length > 0 && !eventTypes.includes(event.type)) return event;
        try {
          const result = await Promise.resolve(ic.intercept(event, ctx));
          return result || event;
        } catch { return event; }
      })
    );
  }

  for (const ob of observers) {
    const eventTypes: string[] = ob.eventTypes || [];
    pipeline = pipeline.pipe(
      tap((event: AgentEvent) => {
        if (eventTypes.length > 0 && !eventTypes.includes(event.type)) return;
        try {
          const r = ob.observe(event, ctx);
          if (r instanceof Promise) r.catch(() => {});
        } catch { /* isolate */ }
      })
    );
  }

  return pipeline;
}

/** @deprecated */
export function emptyPipeline(source: Observable<AgentEvent>): Observable<AgentEvent> {
  return source;
}

/** @deprecated */
export function blockingPipeline(_source: Observable<AgentEvent>): Observable<AgentEvent> {
  return EMPTY;
}

/** @deprecated */
export function replacePipeline(
  _source: Observable<AgentEvent>,
  replacement: AgentEvent
): Observable<AgentEvent> {
  return of(replacement);
}
