/**
 * AgentForge Plugin Loader — File-Based Plugin Loading
 *
 * Loads plugins from local filesystem paths only. NPM-based plugins must
 * be pre-installed as project dependencies and loaded via file path
 * (e.g., "file://./node_modules/my-plugin" or "./plugins/my-plugin").
 *
 * Plugin Conventions:
 * - Local paths: specify as "file://./path" or "./relative/path"
 * - Plugin entry: package.json exports["./agentforge"] > agentforge field > main
 * - Version compat: package.json engines.agentforge (semver range)
 *
 * @module
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin, PluginContext } from './plugin.js';
import { HookRegistry } from '../core/hooks.js';
import type { AgentEventEmitter } from '../core/events.js';

// ============================================================
// Types
// ============================================================

/**
 * Plugin specifier for file-based loading.
 *
 * Supported format: "file://./path" or "./relative/path"
 * NPM packages must be pre-installed and referenced by local path.
 */
export interface PluginSpec {
  /** File path specifier: "file://./local" or "./relative/path" */
  source: string;
  /** Options passed to the plugin's server() factory */
  options?: Record<string, unknown>;
}

/**
 * Result of parsing a plugin specifier.
 */
export interface ParsedSpec {
  source: 'file' | 'npm';
  pkg: string;
  version: string;
}

/**
 * Result of loading a single plugin spec.
 */
export interface PluginLoadResult {
  spec: string;
  success: boolean;
  plugin?: Plugin;
  error?: PluginLoadError;
}

/**
 * Structured error from plugin loading.
 */
export interface PluginLoadError {
  code: 'npm_unsupported' | 'entry_not_found' | 'incompatible' | 'load_failed' | 'invalid_spec';
  message: string;
  cause?: unknown;
}

// ============================================================
// Spec Parsing
// ============================================================

/**
 * Parse a plugin specifier string into structured components.
 *
 * @example
 * parsePluginSpec("file://./local")     // { source: "file", pkg: "./local", version: "" }
 * parsePluginSpec("./relative/path")    // { source: "file", pkg: "./relative/path", version: "" }
 * parsePluginSpec("my-plugin@^1.0.0")   // { source: "npm", pkg: "my-plugin@^1.0.0", version: "" }
 */
export function parsePluginSpec(spec: string): ParsedSpec {
  if (spec.startsWith('file://')) {
    return { source: 'file', pkg: spec.slice(7), version: '' };
  }
  if (spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) {
    return { source: 'file', pkg: spec, version: '' };
  }
  // NPM specifiers are no longer supported for runtime installation
  return { source: 'npm', pkg: spec, version: '' };
}

// ============================================================
// Entry Resolution
// ============================================================

/**
 * Plugin package.json structure (subset).
 */
interface PluginPackageJson {
  name?: string;
  version?: string;
  main?: string;
  agentforge?: string;
  exports?: Record<string, string | { import?: string; default?: string }>;
  engines?: Record<string, string>;
}

/**
 * Read and parse package.json from a directory.
 */
async function readPkgJson(dir: string): Promise<PluginPackageJson> {
  const pkgPath = path.join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found in ${dir}`);
  }
  const content = await readFile(pkgPath, 'utf-8');
  return JSON.parse(content) as PluginPackageJson;
}

/**
 * Resolve the entry point file from a package.json object.
 *
 * Priority:
 * 1. exports["./agentforge"]
 * 2. agentforge field
 * 3. main field
 */
export function resolveEntryFromPkgFn(pkg: PluginPackageJson): string | undefined {
  // 1. Check exports["./agentforge"]
  if (pkg.exports) {
    const exportEntry = pkg.exports['./agentforge'];
    if (typeof exportEntry === 'string') {
      return exportEntry;
    }
    if (exportEntry && typeof exportEntry === 'object') {
      if (typeof exportEntry.import === 'string') return exportEntry.import;
      if (typeof exportEntry.default === 'string') return exportEntry.default;
    }
  }

  // 2. Check agentforge field
  if (typeof pkg.agentforge === 'string' && pkg.agentforge.length > 0) {
    return pkg.agentforge;
  }

  // 3. Fall back to main
  if (typeof pkg.main === 'string' && pkg.main.length > 0) {
    return pkg.main;
  }

  return undefined;
}

/**
 * Resolve the entry file path from an installed plugin directory.
 */
async function resolveEntry(installDir: string): Promise<string> {
  const pkg = await readPkgJson(installDir);
  const entry = resolveEntryFromPkgFn(pkg);
  if (!entry) {
    throw new Error(
      `Plugin at ${installDir} has no entry point. ` +
        `Set exports["./agentforge"], "agentforge" field, or "main" in package.json.`
    );
  }
  return path.join(installDir, entry);
}

// ============================================================
// Compatibility Check
// ============================================================

/**
 * Check if a plugin is compatible with current AgentForge version.
 *
 * Reads engines.agentforge from package.json and validates against
 * the current version using semver. 0.x versions are always compatible.
 *
 * @param pkg - Plugin package.json content
 * @param agentforgeVersion - Current AgentForge version
 * @throws Error if incompatible
 */
function checkCompatibilityFn(
  pkg: { engines?: Record<string, string> },
  agentforgeVersion: string
): void {
  const range = pkg.engines?.agentforge;
  if (!range) return;

  // Always allow during 0.x (pre-stable)
  if (agentforgeVersion.startsWith('0.')) return;

  // Simple semver: only exact match for now
  // For richer semver, users can install 'semver' package
  const minVersion = range
    .replace(/[^0-9.]/g, '')
    .split('.')
    .map(Number);
  const curVersion = agentforgeVersion
    .replace(/[^0-9.]/g, '')
    .split('.')
    .map(Number);

  for (let i = 0; i < Math.max(minVersion.length, curVersion.length); i++) {
    const min = minVersion[i] ?? 0;
    const cur = curVersion[i] ?? 0;
    if (cur < min) {
      throw new Error(`Plugin requires agentforge ${range} but running ${agentforgeVersion}`);
    }
    if (cur > min) return; // current version is newer
  }
}

// ============================================================
// Plugin Loader Class
// ============================================================

/**
 * PluginLoader — file-based plugin loading.
 *
 * Plugins must be pre-installed on the filesystem. Runtime npm installation
 * has been removed to eliminate the supply-chain risk of executing arbitrary
 * install scripts.
 */
export class PluginLoader {
  static checkCompatibility = checkCompatibilityFn;
  static resolveEntryFromPkg = resolveEntryFromPkgFn;
  static parseSpec = parsePluginSpec;

  /**
   * Load all plugin specs and register their hooks into the HookRegistry.
   *
   * Each spec is processed independently — failures are isolated and
   * reported as error results rather than crashing the agent.
   */
  static async loadAll(
    specs: PluginSpec[],
    ctx: PluginContext,
    hooks: HookRegistry,
    emitter: AgentEventEmitter
  ): Promise<PluginLoadResult[]> {
    const results: PluginLoadResult[] = [];

    for (const spec of specs) {
      try {
        const parsed = parsePluginSpec(spec.source);

        if (parsed.source === 'npm') {
          const barePkg = parsed.pkg.replace(/@[^@]*$/, '');
          results.push({
            spec: spec.source,
            success: false,
            error: {
              code: 'npm_unsupported',
              message: `Runtime npm installation is no longer supported. Pre-install "${barePkg}" as a project dependency and reference it by local path (e.g. "file://./node_modules/${barePkg}").`,
            },
          });
          continue;
        }

        // File source: resolve relative to CWD
        const installDir = path.isAbsolute(parsed.pkg)
          ? parsed.pkg
          : path.resolve(process.cwd(), parsed.pkg);

        // Read package.json
        const pkgData = await readPkgJson(installDir);

        // Check compatibility
        try {
          checkCompatibilityFn(pkgData, '0.0.0');
        } catch (compatErr) {
          results.push({
            spec: spec.source,
            success: false,
            error: {
              code: 'incompatible',
              message: compatErr instanceof Error ? compatErr.message : String(compatErr),
              cause: compatErr,
            },
          });
          continue;
        }

        // Resolve entry point
        const entry = await resolveEntry(installDir);

        // Dynamic import of the plugin module
        const importPath = pathToFileURL(entry).href;
        let mod: Record<string, unknown>;
        try {
          mod = (await import(importPath)) as Record<string, unknown>;
        } catch (importErr) {
          results.push({
            spec: spec.source,
            success: false,
            error: {
              code: 'load_failed',
              message: `Failed to import plugin module at ${entry}: ${importErr instanceof Error ? importErr.message : String(importErr)}`,
              cause: importErr,
            },
          });
          continue;
        }

        // Call the plugin factory function
        const server = mod.server as
          | ((input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Plugin>)
          | undefined;
        if (typeof server !== 'function') {
          results.push({
            spec: spec.source,
            success: false,
            error: {
              code: 'entry_not_found',
              message: `Plugin at ${spec.source} does not export a server() function. Expected: export const server = async (input) => ({ ... })`,
            },
          });
          continue;
        }

        const pluginInput = {
          sessionId: ctx.sessionId,
          agentName: ctx.agentName,
          directory: process.cwd(),
        };

        const plugin = await server(pluginInput, spec.options);

        // Register plugin hooks
        if (plugin.requestHooks) {
          for (const hook of plugin.requestHooks) {
            hooks.registerRequest(hook);
          }
        }
        if (plugin.toolHooks) {
          for (const hook of plugin.toolHooks) {
            hooks.registerTool(hook);
          }
        }
        if (plugin.toolProviderHooks) {
          for (const hook of plugin.toolProviderHooks) {
            hooks.registerToolProvider(hook);
          }
        }
        if (plugin.eventSubscriptions) {
          for (const sub of plugin.eventSubscriptions) {
            emitter.on(sub.event, event =>
              Promise.resolve(sub.handler(event)).catch(() => {
                /* isolate */
              })
            );
          }
        }

        // Initialize plugin if it has init
        if (plugin.init) {
          try {
            await plugin.init(ctx);
          } catch {
            /* isolate */
          }
        }

        results.push({
          spec: spec.source,
          success: true,
          plugin,
        });
      } catch (err) {
        results.push({
          spec: spec.source,
          success: false,
          error: {
            code: 'load_failed',
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          },
        });
      }
    }

    return results;
  }
}
