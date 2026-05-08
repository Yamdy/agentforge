import type { Plugin } from './types.js';

/**
 * Generic pipeline executor for Plugin hooks.
 *
 * Iterates through all plugins in order. For each plugin that has the
 * requested hook defined, calls it with the current value (and any extra
 * arguments). The return value becomes the input to the next plugin.
 *
 * Plugin isolation: if a plugin throws, the error is caught, a warning is
 * emitted via console.warn, and the pipeline continues with the current value.
 *
 * Return value semantics:
 *   - `undefined` / `void` → observer only, value unchanged
 *   - `null` / `false`    → passed through as-is (caller decides meaning)
 *   - any other value      → replaces current value
 *
 * Special handling for `transformRequest`:
 *   If a plugin returns an object without a `messages` property, the return
 *   value is considered invalid and the value before the plugin is kept.
 */
export async function executePluginHook<T>(
  plugins: Plugin[],
  hookName: keyof Plugin,
  arg: T,
  ...extras: unknown[]
): Promise<T> {
  let current: unknown = arg;

  for (const plugin of plugins) {
    const hook = plugin[hookName];
    if (typeof hook !== 'function') {
      continue;
    }

    try {
      const result = await (
        hook as (this: unknown, ...args: unknown[]) => unknown
      )(current, ...extras);

      // undefined → observer only, skip
      if (result === undefined) {
        continue;
      }

      // Special handling for transformRequest: reject objects without `messages`
      if (
        hookName === 'transformRequest' &&
        typeof result === 'object' &&
        result !== null &&
        !('messages' in result)
      ) {
        continue;
      }

      current = result;
    } catch (err) {
      console.warn(
        `Plugin "${plugin.name}" hook "${hookName}" error:`,
        err,
      );
      // Plugin isolation: continue with the current value
    }
  }

  return current as T;
}
