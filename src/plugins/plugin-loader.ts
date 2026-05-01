/**
 * AgentForge Plugin Loader — Dynamic Plugin Installation
 *
 * Enables config-driven plugin loading from npm packages or local paths.
 * Plugins are dynamically installed at runtime and their hooks are
 * registered into the HookRegistry.
 *
 * Inspired by OpenCode's plugin loading architecture.
 *
 * Plugin Conventions:
 * - npm packages: specify in config as "pkg-name@^1.0.0"
 * - Local paths: specify as "file://./path" or "./relative/path"
 * - Plugin entry: package.json exports["./agentforge"] > agentforge field > main
 * - Version compat: package.json engines.agentforge (semver range)
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, rm, cp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { Plugin, PluginContext } from './plugin.js';
import { HookRegistry } from '../core/hooks.js';
import type { AgentEventEmitter } from '../core/events.js';

// ============================================================
// Types
// ============================================================

/**
 * Plugin specifier for dynamic loading.
 *
 * Supports two formats:
 * - `"pkg-name@^1.0.0"` — install from npm
 * - `"file://./local-dir"` or `"./local-dir"` — load from filesystem
 */
export interface PluginSpec {
  /** Package specifier: "my-plugin@^1.0.0" or "file://./local" */
  source: string;
  /** Options passed to the plugin's server() factory */
  options?: Record<string, unknown>;
}

/**
 * Result of parsing a plugin specifier.
 */
export interface ParsedSpec {
  /** Source type */
  source: 'npm' | 'file';
  /** Package name or file path (without version) */
  pkg: string;
  /** Version string (npm only, "latest" if not specified) */
  version: string;
}

/**
 * Result of loading a single plugin spec.
 */
export interface PluginLoadResult {
  /** Original spec string */
  spec: string;
  /** Whether the plugin loaded successfully */
  success: boolean;
  /** Plugin instance if loaded successfully */
  plugin?: Plugin;
  /** Error if load failed */
  error?: PluginLoadError;
}

/**
 * Structured error from plugin loading.
 */
export interface PluginLoadError {
  /** Error category */
  code: 'install_failed' | 'entry_not_found' | 'incompatible' | 'load_failed' | 'invalid_spec';
  /** Human-readable message */
  message: string;
  /** Original error for debugging */
  cause?: unknown;
}

// ============================================================
// Spec Parsing
// ============================================================

/**
 * Parse a plugin specifier string into structured components.
 *
 * @example
 * parsePluginSpec("my-plugin@^1.0.0")  // { source: "npm", pkg: "my-plugin", version: "^1.0.0" }
 * parsePluginSpec("@scope/pkg@2.0.0")   // { source: "npm", pkg: "@scope/pkg", version: "2.0.0" }
 * parsePluginSpec("file://./local")     // { source: "file", pkg: "./local", version: "" }
 * parsePluginSpec("./relative/path")    // { source: "file", pkg: "./relative/path", version: "" }
 */
export function parsePluginSpec(spec: string): ParsedSpec {
  // File source detection
  if (spec.startsWith('file://')) {
    return { source: 'file', pkg: spec.slice(7), version: '' };
  }
  if (spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) {
    return { source: 'file', pkg: spec, version: '' };
  }

  // NPM specifier: handle @scope/pkg@version
  if (spec.startsWith('@')) {
    // Split: '@scope/pkg@version' → ['', 'scope', 'pkg@version'] or ['', 'scope', 'pkg']
    const slashIdx = spec.indexOf('/');
    if (slashIdx < 0) {
      return { source: 'npm', pkg: spec, version: 'latest' };
    }
    const scopeAndPkg = spec.slice(0, slashIdx); // @scope
    const rest = spec.slice(slashIdx + 1);       // pkg or pkg@version
    const versionIdx = rest.lastIndexOf('@');
    if (versionIdx > 0) {
      return {
        source: 'npm',
        pkg: `${scopeAndPkg}/${rest.slice(0, versionIdx)}`,
        version: rest.slice(versionIdx + 1),
      };
    }
    return {
      source: 'npm',
      pkg: `${scopeAndPkg}/${rest}`,
      version: 'latest',
    };
  }

  // Plain npm specifier: pkg@version
  const atIndex = spec.lastIndexOf('@');
  if (atIndex > 0) {
    const pkg = spec.slice(0, atIndex);
    // Check if the part after @ looks like a version (contains digits or special chars)
    const version = spec.slice(atIndex + 1);
    if (version.length > 0) {
      return { source: 'npm', pkg, version };
    }
    return { source: 'npm', pkg, version: 'latest' };
  }

  return { source: 'npm', pkg: spec, version: 'latest' };
}

// ============================================================
// Version Resolution
// ============================================================

let _version: string | undefined;

/**
 * Get the current AgentForge version from the installed package.
 */
function getAgentforgeVersion(): string {
  if (_version !== undefined) return _version;
  try {
    const selfDir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(selfDir, '..', '..', 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
      _version = pkg.version ?? '0.0.0';
    } else {
      _version = '0.0.0';
    }
  } catch {
    _version = '0.0.0';
  }
  return _version;
}

/**
 * Read a file synchronously (for bootstrap use).
 * Already imported at top level.
 */

// ============================================================
// NPM Installation
// ============================================================

/**
 * Execute npm install command.
 */
function execNpm(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFile(cmd, args, {
      cwd,
      timeout: 120_000,
      env: { ...process.env, npm_config_loglevel: 'error' },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`npm ${args.join(' ')} failed: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Cache directory for installed plugins.
 */
function getCacheDir(): string {
  const cwd = process.cwd();
  return path.join(cwd, 'node_modules', '.agentforge-plugins');
}

/**
 * Sanitize package name for filesystem use.
 */
function sanitizeDir(pkg: string): string {
  return pkg.replace(/^@/, '').replace(/\//g, '+').replace(/[<>:"|?*]/g, '_');
}

/**
 * Get the install directory for a given package.
 */
function getInstallDir(pkg: string, cacheDir: string): string {
  const sanitized = sanitizeDir(pkg);
  return path.join(cacheDir, sanitized);
}

/**
 * Check if cached version is stale by querying npm registry.
 */
async function isCachedVersionStale(pkg: string, cachedVersion: string): Promise<boolean> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`);
    if (!response.ok) return false;
    const data = await response.json() as { version?: string };
    const latest = data?.version;
    if (!latest) return false;
    return latest !== cachedVersion;
  } catch {
    // Network issues: use cache optimistically
    return false;
  }
}

/**
 * Dynamically install a package from npm into cache directory.
 *
 * Installs directly into the cache dir so that the plugin's node_modules
 * (its dependencies) are preserved and available for resolution.
 */
async function resolveNpm(pkg: string, version: string): Promise<string> {
  const cacheDir = getCacheDir();
  const installDir = getInstallDir(pkg, cacheDir);

  // Check if already installed
  if (existsSync(installDir) && existsSync(path.join(installDir, 'package.json'))) {
    try {
      const cachedPkg = JSON.parse(readFileSync(path.join(installDir, 'package.json'), 'utf-8')) as { version?: string };
      const cachedVersion = cachedPkg.version ?? '0.0.0';
      // Check freshness using npm registry
      if (version && version !== 'latest' && version !== cachedVersion) {
        // Specific version requested, but cached is different — reinstall
      } else {
        const stale = await isCachedVersionStale(pkg, cachedVersion);
        if (!stale) return installDir;
      }
    } catch { /* read error, will reinstall */ }
    // Remove stale cache
    await rm(installDir, { recursive: true, force: true }).catch(() => {});
  }

  // Ensure cache directory exists
  await mkdir(cacheDir, { recursive: true });

  const spec = version && version !== 'latest' ? `${pkg}@${version}` : pkg;

  // Install directly into the cache directory — npm will create node_modules
  // with the plugin AND its dependencies at installDir/node_modules/
  // This ensures the plugin's dependencies are available for resolution.
  await mkdir(installDir, { recursive: true });

  // Create package.json so npm can install into this directory
  const pkgJson = { name: 'agentforge-plugin-cache', private: true };
  await writeFile(path.join(installDir, 'package.json'), JSON.stringify(pkgJson));

  try {
    await execNpm(['install', spec, '--no-save', '--ignore-scripts'], installDir);

    // Find the installed package inside node_modules
    const nodeModules = path.join(installDir, 'node_modules');
    if (!existsSync(nodeModules)) {
      throw new Error(`npm install succeeded but node_modules not found in ${installDir}`);
    }

    // Handle scoped packages: @scope/pkg → node_modules/@scope/pkg
    const parts = pkg.split('/');
    let pkgPath = nodeModules;
    for (const part of parts) {
      pkgPath = path.join(pkgPath, part);
    }

    if (!existsSync(pkgPath)) {
      // Scan for package
      const entries = await readdir(nodeModules);
      for (const entry of entries) {
        if (entry.startsWith('.') || entry.startsWith('@')) continue;
        const candidate = path.join(nodeModules, entry, 'package.json');
        if (existsSync(candidate)) {
          const pkgData = JSON.parse(readFileSync(candidate, 'utf-8')) as { name?: string };
          if (pkgData.name === pkg) {
            pkgPath = path.dirname(candidate);
            break;
          }
        }
      }
    }

    if (!existsSync(pkgPath)) {
      throw new Error(`Package ${pkg} not found in installed node_modules`);
    }

    // Copy the installed package to installDir root, preserving node_modules
    // The node_modules already contains the plugin's dependencies
    for (const entry of await readdir(pkgPath, { withFileTypes: true })) {
      const src = path.join(pkgPath, entry.name);
      const dest = path.join(installDir, entry.name);
      if (entry.isDirectory()) {
        if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
        await cp(src, dest, { recursive: true });
      } else {
        await cp(src, dest, { force: true });
      }
    }

    return installDir;
  } catch (err) {
    // Clean up on failure
    await rm(installDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
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
function checkCompatibilityFn(pkg: { engines?: Record<string, string> }, agentforgeVersion: string): void {
  const range = pkg.engines?.agentforge;
  if (!range) return;

  // Always allow during 0.x (pre-stable)
  if (agentforgeVersion.startsWith('0.')) return;

  // Simple semver: only exact match for now
  // For richer semver, users can install 'semver' package
  const minVersion = range.replace(/[^0-9.]/g, '').split('.').map(Number);
  const curVersion = agentforgeVersion.replace(/[^0-9.]/g, '').split('.').map(Number);

  for (let i = 0; i < Math.max(minVersion.length, curVersion.length); i++) {
    const min = minVersion[i] ?? 0;
    const cur = curVersion[i] ?? 0;
    if (cur < min) {
      throw new Error(
        `Plugin requires agentforge ${range} but running ${agentforgeVersion}`
      );
    }
    if (cur > min) return; // current version is newer
  }
}

// ============================================================
// Plugin Loader Class
// ============================================================

/**
 * PluginLoader — dynamic plugin installation and loading.
 *
 * Provides static methods for parsing plugin specs, checking version
 * compatibility, resolving entry points, and loading plugins from
 * npm packages or local paths at runtime.
 */
export class PluginLoader {
  /**
   * Check version compatibility.
   */
  static checkCompatibility = checkCompatibilityFn;

  /**
   * Resolve entry point from package.json.
   */
  static resolveEntryFromPkg = resolveEntryFromPkgFn;

  /**
   * Parse a plugin specifier string.
   */
  static parseSpec = parsePluginSpec;

  /**
   * Load all plugin specs and register their hooks into the HookRegistry.
   *
   * Each spec is processed independently — failures are isolated and
   * reported as error results rather than crashing the agent.
   *
   * @param specs - Plugin specifiers to load
   * @param ctx - Plugin context for initialization
   * @param hooks - HookRegistry to register hooks into
   * @param emitter - AgentEventEmitter for event subscriptions
   * @returns Array of load results (some may have errors)
   */
  static async loadAll(
    specs: PluginSpec[],
    ctx: PluginContext,
    hooks: HookRegistry,
    emitter: AgentEventEmitter,
  ): Promise<PluginLoadResult[]> {
    const results: PluginLoadResult[] = [];

    for (const spec of specs) {
      try {
        const parsed = parsePluginSpec(spec.source);

        // Resolve the target directory
        let installDir: string;
        if (parsed.source === 'npm') {
          installDir = await resolveNpm(parsed.pkg, parsed.version);
        } else {
          // File source: resolve relative to CWD
          installDir = path.isAbsolute(parsed.pkg)
            ? parsed.pkg
            : path.resolve(process.cwd(), parsed.pkg);
        }

        // Read package.json
        const pkgData = await readPkgJson(installDir);

        // Check compatibility
        try {
          checkCompatibilityFn(pkgData, getAgentforgeVersion());
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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- dynamic import
          mod = await import(importPath);
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
        const server = mod.server as ((input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Plugin>) | undefined;
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
        if (plugin.lifecycleHooks) {
          hooks.registerLifecycle(plugin.lifecycleHooks);
        }
        if (plugin.eventSubscriptions) {
          for (const sub of plugin.eventSubscriptions) {
            emitter.on(sub.event, (event) => {
              void Promise.resolve(sub.handler(event)).catch(() => { /* isolate */ });
            });
          }
        }

        // Initialize plugin if it has init
        if (plugin.init) {
          try {
            await plugin.init(ctx);
          } catch { /* isolate */ }
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
            code: 'install_failed',
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          },
        });
      }
    }

    return results;
  }
}
