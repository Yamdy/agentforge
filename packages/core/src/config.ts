import type { HarnessConfig } from '@primo-ai/sdk';
import { z } from 'zod';
import { deepMerge } from './config-merge.js';
import { ConfigEnvVarError } from './errors.js';

// ---------------------------------------------------------------------------
// ConfigSource — layers to load
// ---------------------------------------------------------------------------

export interface ConfigSource {
  global?: string;
  project?: string;
  env?: string;
  session?: Partial<HarnessConfig>;
}

// ---------------------------------------------------------------------------
// ConfigLoader
// ---------------------------------------------------------------------------

export class ConfigLoader {
  private fileReader: (path: string) => Promise<string>;

  constructor(options?: { fileReader?: (path: string) => Promise<string> }) {
    this.fileReader =
      options?.fileReader ??
      ((path: string) =>
        import('node:fs/promises').then((fs) => fs.readFile(path, 'utf-8')));
  }

  // -------------------------------------------------------------------------
  // JSONC parser — strips comments and trailing commas without touching
  // string contents.
  // -------------------------------------------------------------------------

  parseJsonc(content: string): Record<string, unknown> {
    const stripped = stripJsonc(content);
    try {
      return JSON.parse(stripped) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid JSONC: ${msg}`);
    }
  }

  // -------------------------------------------------------------------------
  // Load — merge multiple layers
  // -------------------------------------------------------------------------

  async load(sources: ConfigSource): Promise<HarnessConfig> {
    const layers: Record<string, unknown>[] = [];

    // 1. Environment (lowest priority)
    if (sources.env) {
      layers.push(this.parseJsonc(sources.env));
    }

    // 2. Global config file
    if (sources.global) {
      try {
        const content = await this.fileReader(sources.global);
        layers.push(this.parseJsonc(content));
      } catch {
        // missing global config is ok
      }
    }

    // 3. Project config file
    if (sources.project) {
      try {
        const content = await this.fileReader(sources.project);
        layers.push(this.parseJsonc(content));
      } catch {
        // missing project config is ok
      }
    }

    // 4. Session (highest priority)
    if (sources.session) {
      layers.push(sources.session as Record<string, unknown>);
    }

    if (layers.length === 0) return {};

    // Merge left to right: later layers win
    const merged = layers.reduce(
      (acc, layer) => deepMerge(acc, layer),
      {} as Record<string, unknown>,
    );

    // Expand environment variable references in string values
    const expanded = expandEnvVars(merged, '');

    const result = HarnessConfigSchema.safeParse(expanded);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid config:\n${issues}`);
    }

    return result.data as HarnessConfig;
  }
}

// ---------------------------------------------------------------------------
// JSONC stripping — character-by-character to respect string boundaries
// ---------------------------------------------------------------------------

function stripJsonc(input: string): string {
  let result = '';
  let i = 0;
  const len = input.length;

  while (i < len) {
    // Inside a string — copy verbatim until closing quote
    if (input[i] === '"') {
      result += input[i];
      i++;
      while (i < len) {
        if (input[i] === '\\' && i + 1 < len) {
          // Escaped character — copy both
          result += input[i] + input[i + 1];
          i += 2;
        } else if (input[i] === '"') {
          result += input[i];
          i++;
          break;
        } else {
          result += input[i];
          i++;
        }
      }
      continue;
    }

    // Single-line comment
    if (input[i] === '/' && i + 1 < len && input[i + 1] === '/') {
      // Skip until end of line
      i += 2;
      while (i < len && input[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Block comment
    if (input[i] === '/' && i + 1 < len && input[i + 1] === '*') {
      i += 2;
      while (i < len && !(input[i] === '*' && i + 1 < len && input[i + 1] === '/')) {
        i++;
      }
      i += 2; // skip */
      continue;
    }

    result += input[i];
    i++;
  }

  // Strip trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, '$1');

  return result;
}

// ---------------------------------------------------------------------------
// Environment variable expansion in config values
// ---------------------------------------------------------------------------

/**
 * Recursively walk a merged config object and expand `${VAR_NAME}` and
 * `${VAR_NAME:-default}` references in every string leaf value.
 *
 * - `$$` escapes to a single literal `$` (the first `$` escapes the second)
 * - Undefined variables with no default throw `ConfigEnvVarError`
 */
function expandEnvVars(
  obj: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (typeof value === 'string') {
      result[key] = expandVarsInString(value, currentPath);
    } else if (Array.isArray(value)) {
      result[key] = expandVarsInArray(value, currentPath);
    } else if (value !== null && typeof value === 'object') {
      result[key] = expandEnvVars(
        value as Record<string, unknown>,
        currentPath,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function expandVarsInArray(arr: unknown[], path: string): unknown[] {
  return arr.map((item, index) => {
    const currentPath = `${path}[${index}]`;
    if (typeof item === 'string') {
      return expandVarsInString(item, currentPath);
    }
    if (Array.isArray(item)) {
      return expandVarsInArray(item, currentPath);
    }
    if (item !== null && typeof item === 'object') {
      return expandEnvVars(item as Record<string, unknown>, currentPath);
    }
    return item;
  });
}

/**
 * Expand `${VAR_NAME}` / `${VAR_NAME:-default}` references inside a single
 * string.  `$$` produces a literal `$`.
 */
function expandVarsInString(value: string, path: string): string {
  let result = '';
  let i = 0;
  while (i < value.length) {
    // $$ escape — produces a single literal $
    if (value[i] === '$' && i + 1 < value.length && value[i + 1] === '$') {
      result += '$';
      i += 2;
      continue;
    }

    // ${...} — environment variable expansion
    if (value[i] === '$' && i + 1 < value.length && value[i + 1] === '{') {
      const close = value.indexOf('}', i + 2);
      if (close !== -1) {
        const inner = value.slice(i + 2, close);
        const colonDashIdx = inner.indexOf(':-');
        let varName: string;
        let defaultValue: string | undefined;
        if (colonDashIdx !== -1) {
          varName = inner.slice(0, colonDashIdx);
          defaultValue = inner.slice(colonDashIdx + 2);
        } else {
          varName = inner;
        }
        const envVal = process.env[varName];
        if (envVal !== undefined) {
          result += envVal;
        } else if (defaultValue !== undefined) {
          result += defaultValue;
        } else {
          throw new ConfigEnvVarError(varName, path);
        }
        i = close + 1;
        continue;
      }
    }

    result += value[i];
    i++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Zod schema for HarnessConfig validation
// ---------------------------------------------------------------------------

const HarnessConfigSchema = z.object({
  agents: z.record(z.string(), z.unknown()).optional(),
  tools: z.object({ enabled: z.array(z.string()).optional(), disabled: z.array(z.string()).optional() }).optional(),
  plugins: z.array(z.string()).optional(),
  session: z.object({ storage: z.enum(['file', 'memory']).optional(), path: z.string().optional() }).optional(),
  modelProfiles: z.array(z.unknown()).optional(),
  modelGateways: z.array(z.object({
    name: z.string(),
    url: z.string(),
    apiKey: z.string().optional(),
  })).optional(),
  skills: z.object({ paths: z.array(z.string()).optional() }).optional(),
  pipeline: z.object({
    preLoop: z.array(z.string()).optional(),
    loop: z.array(z.string()).optional(),
    postLoop: z.array(z.string()).optional(),
  }).optional(),
  processors: z.record(z.string(), z.union([
    z.object({ builtin: z.string() }),
    z.object({ module: z.string(), export: z.string().optional(), config: z.record(z.string(), z.unknown()).optional() }),
  ])).optional(),
}).passthrough();
