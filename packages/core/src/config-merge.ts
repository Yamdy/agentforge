/**
 * Deep merge utility for configuration objects.
 *
 * Rules:
 * - Plain objects are merged recursively.
 * - Arrays, primitives, and other types are replaced by the later value.
 * - null/undefined sources are skipped.
 * - The target is NOT mutated; a new object is returned.
 */
export function deepMerge(
  target: Record<string, unknown>,
  ...sources: Record<string, unknown>[]
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key in result) {
    if (isObject(result[key])) {
      result[key] = { ...(result[key] as Record<string, unknown>) };
    }
  }

  for (const source of sources) {
    if (source == null) continue;

    for (const key of Object.keys(source)) {
      const sourceVal = source[key];

      if (sourceVal == null) continue;

      if (isObject(sourceVal) && isObject(result[key])) {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          sourceVal as Record<string, unknown>,
        );
      } else {
        result[key] = sourceVal;
      }
    }
  }

  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
