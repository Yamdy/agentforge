/**
 * MPU-M6: Configurable Blocklists
 *
 * Provides types and functions for merging, loading, and validating
 * additional blocklist entries beyond the hardcoded defaults.
 *
 * @module
 */

/**
 * Additional blocklist entries that extend the hardcoded defaults.
 *
 * Each field is optional — when omitted, only the defaults apply.
 */
export interface BlocklistConfig {
  /** Additional blocked commands (substring-matched) */
  commands?: string[];
  /** Additional blocked file paths (prefix-matched) */
  paths?: string[];
  /** Additional blocked network domains (substring-matched) */
  domains?: string[];
}

/**
 * Merge an optional array of additional items into a base array.
 *
 * Preserves order: base items first, then unique additions.
 * Deduplication is case-sensitive.
 *
 * @param base - The base (default) blocklist entries
 * @param additional - Optional additional entries to append
 * @returns Merged array (base + deduplicated additions)
 */
export function mergeBlocklists(base: readonly string[], additional?: string[]): string[] {
  if (!additional || additional.length === 0) {
    return [...base];
  }
  const set = new Set(base);
  const result = [...base];
  for (const item of additional) {
    // Filter out non-strings, empty strings, and whitespace-only entries
    if (typeof item !== 'string' || item.trim() === '') {
      continue;
    }
    if (!set.has(item)) {
      set.add(item);
      result.push(item);
    }
  }
  return result;
}

/**
 * Load a BlocklistConfig from a plain object (e.g., from JSON.parse).
 *
 * Only recognised keys (`commands`, `paths`, `domains`) are extracted.
 * Non-string array entries are silently filtered out.
 *
 * @param source - A plain object potentially containing blocklist fields
 * @returns A normalized BlocklistConfig
 */
export function loadBlocklistConfig(source: Record<string, unknown>): BlocklistConfig {
  const config: BlocklistConfig = {};

  if (Array.isArray(source.commands)) {
    const filtered = (source.commands as unknown[])
      .filter((v): v is string => typeof v === 'string')
      .filter(v => v.trim() !== '');
    if (filtered.length > 0) {
      config.commands = filtered;
    }
  }

  if (Array.isArray(source.paths)) {
    const filtered = (source.paths as unknown[])
      .filter((v): v is string => typeof v === 'string')
      .filter(v => v.trim() !== '');
    if (filtered.length > 0) {
      config.paths = filtered;
    }
  }

  if (Array.isArray(source.domains)) {
    const filtered = (source.domains as unknown[])
      .filter((v): v is string => typeof v === 'string')
      .filter(v => v.trim() !== '');
    if (filtered.length > 0) {
      config.domains = filtered;
    }
  }

  return config;
}

/**
 * Validate a BlocklistConfig for common issues.
 *
 * Checks include:
 * - No empty strings in any array
 * - All entries are strings
 *
 * @param config - The config to validate
 * @returns Validation result with `valid` flag and `errors` list
 */
export function validateBlocklistConfig(config: BlocklistConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  const checkArray = (label: string, arr: string[] | undefined): void => {
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      const entry = arr[i];
      if (typeof entry !== 'string') {
        errors.push(`${label}[${i}] is not a string (got ${typeof entry})`);
      } else if (entry === '') {
        errors.push(`${label}[${i}] is an empty string`);
      }
    }
  };

  checkArray('commands', config.commands);
  checkArray('paths', config.paths);
  checkArray('domains', config.domains);

  return {
    valid: errors.length === 0,
    errors,
  };
}
