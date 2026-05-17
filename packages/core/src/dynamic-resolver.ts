import type { Dynamic, ResolveContext } from '@primo-ai/sdk';

/**
 * Resolve a Dynamic<T> value: if it's a function, call it with the context;
 * otherwise return the static value as-is.
 */
export async function resolveDynamic<T>(
  value: Dynamic<T>,
  ctx: ResolveContext,
): Promise<T> {
  if (typeof value === 'function') {
    return (value as (ctx: ResolveContext) => T | Promise<T>)(ctx);
  }
  return value;
}
