/**
 * Sensitive Data Filter — Utility class for redacting sensitive fields.
 *
 * Composable utility (not a Plugin) used by TracingPlugin, loggingPlugin,
 * and other observability components to filter sensitive data before
 * it is written to spans, logs, or exported.
 *
 * @module observability/sensitive-data-filter
 */

// ============================================================
// Default Patterns
// ============================================================

const DEFAULT_SENSITIVE_PATTERNS: RegExp[] = [
  /password/i,
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /credit[_-]?card/i,
  /ssn/i,
  /email/i,
  /phone/i,
  /api_key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /private[_-]?key/i,
  /certificate/i,
];

const REDACTED_VALUE = '[REDACTED]';

// ============================================================
// SensitiveDataFilter
// ============================================================

export class SensitiveDataFilter {
  private patterns: RegExp[];

  constructor(extraPatterns: RegExp[] = []) {
    this.patterns = [...DEFAULT_SENSITIVE_PATTERNS, ...extraPatterns];
  }

  /**
   * Check if a key name appears to contain sensitive data.
   */
  isSensitive(key: string): boolean {
    return this.patterns.some(p => p.test(key));
  }

  /**
   * Redact a value if the key is sensitive.
   * Returns the original value for non-sensitive keys.
   */
  filter(key: string, value: unknown): unknown {
    return this.isSensitive(key) ? REDACTED_VALUE : value;
  }

  /**
   * Filter all keys in a flat record.
   * Sensitive values are replaced with '[REDACTED]'.
   */
  filterObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.isSensitive(key) ? REDACTED_VALUE : value;
    }
    return result;
  }

  /**
   * Deep-filter nested objects (max depth: 5 to avoid circular refs).
   */
  filterDeep(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
    if (depth > 5) return obj;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (this.isSensitive(key)) {
        result[key] = REDACTED_VALUE;
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.filterDeep(value as Record<string, unknown>, depth + 1);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
