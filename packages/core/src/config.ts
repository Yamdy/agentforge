import type { HarnessConfig } from '@agentforge/sdk';
import { z } from 'zod';
import { deepMerge } from './config-merge.js';

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

    const result = HarnessConfigSchema.safeParse(merged);
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
// Zod schema for HarnessConfig validation
// ---------------------------------------------------------------------------

const HarnessConfigSchema = z.object({
  agents: z.record(z.string(), z.unknown()).optional(),
  tools: z.object({ enabled: z.array(z.string()).optional(), disabled: z.array(z.string()).optional() }).optional(),
  plugins: z.array(z.string()).optional(),
  session: z.object({ storage: z.enum(['file', 'memory']).optional(), path: z.string().optional() }).optional(),
  modelProfiles: z.array(z.unknown()).optional(),
  modelGateways: z.array(z.unknown()).optional(),
}).passthrough();
