/**
 * General array utility functions
 */

/**
 * Chunk an array into smaller arrays of the specified size
 */
export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) {
    return [];
  }
  
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Flatten a nested array one level deep
 */
export function flatten<T>(array: (T | T[])[]): T[] {
  const result: T[] = [];
  for (const item of array) {
    if (Array.isArray(item)) {
      result.push(...item);
    } else {
      result.push(item);
    }
  }
  return result;
}

/**
 * Remove duplicate values from an array
 */
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

/**
 * Group an array by a key getter function
 */
export function groupBy<T, K extends string | number | symbol>(
  array: T[],
  getKey: (item: T) => K
): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  
  for (const item of array) {
    const key = getKey(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  
  return result;
}

/**
 * Get the last element of an array
 */
export function last<T>(array: T[]): T | undefined {
  return array[array.length - 1];
}
