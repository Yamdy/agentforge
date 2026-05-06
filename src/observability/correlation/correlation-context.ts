/**
 * Correlation Context — AsyncLocalStorage-based cross-async-boundary context propagation.
 *
 * Carries session-level correlation data (userId, orgId, environment) across
 * async boundaries without passing it through every function signature.
 *
 * @module observability/correlation/correlation-context
 */

import { AsyncLocalStorage } from 'node:async_hooks';

// ============================================================
// Types
// ============================================================

export interface CorrelationContext {
  sessionId: string;
  userId?: string;
  orgId?: string;
  environment?: string;
  runId?: string;
}

// ============================================================
// Storage
// ============================================================

const storage = new AsyncLocalStorage<CorrelationContext>();

// ============================================================
// Public API
// ============================================================

/**
 * Run a callback with the given correlation context.
 * All code within the callback (including awaited async operations)
 * can access this context via `getCorrelationContext()`.
 */
export function runWithCorrelation<T>(ctx: CorrelationContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Run a synchronous callback with the given correlation context.
 */
export function runWithCorrelationSync<T>(ctx: CorrelationContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Get the current correlation context.
 * Returns undefined when called outside of a `runWithCorrelation()` scope.
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

/**
 * Set a field on the current correlation context.
 * No-op when called outside of a `runWithCorrelation()` scope.
 */
export function setCorrelationField<K extends keyof CorrelationContext>(
  key: K,
  value: CorrelationContext[K]
): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx[key] = value;
  }
}
