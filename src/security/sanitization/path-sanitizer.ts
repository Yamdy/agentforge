/**
 * AgentForge Path Sanitizer
 */

import * as pathLib from 'node:path';

export type PathAccessMode = 'read' | 'write';

export interface PathAccessResult {
  allowed: boolean;
  resolvedPath: string;
  denialReason?: string;
  matchedPattern?: string;
}

export interface PathSanitizerConfig {
  workspaceRoot: string;
  deniedPatterns: RegExp[];
  allowSymlinks: boolean;
}

export const DEFAULT_DENIED_PATTERNS: RegExp[] = [
  /\.git\//,
  /\.git$/,
  /\.env(\.|$)/,
  /\/secrets?\//i,
  /\/credentials?\//i,
  /\.pem$/,
  /\.key$/,
  /\.ssh\//,
  /\/etc\/(passwd|shadow|hosts)/,
  /\.htpasswd$/,
];

export class PathSanitizer {
  private readonly config: PathSanitizerConfig;

  constructor(workspaceRoot: string, deniedPatterns?: RegExp[]) {
    this.config = {
      workspaceRoot: pathLib.resolve(workspaceRoot),
      deniedPatterns: deniedPatterns ?? DEFAULT_DENIED_PATTERNS,
      allowSymlinks: false,
    };
  }

  checkAccess(inputPath: string, mode: PathAccessMode = 'read'): PathAccessResult {
    const resolved = pathLib.resolve(this.config.workspaceRoot, inputPath);

    if (!resolved.startsWith(this.config.workspaceRoot)) {
      return {
        allowed: false,
        resolvedPath: resolved,
        denialReason: 'Path traversal: path escapes workspace boundary',
      };
    }

    for (const pattern of this.config.deniedPatterns) {
      if (pattern.test(resolved)) {
        return {
          allowed: false,
          resolvedPath: resolved,
          denialReason: `Path matches denied pattern: ${pattern.source}`,
          matchedPattern: pattern.source,
        };
      }
    }

    if (mode === 'write') {
      const writeDeniedPatterns = [/\.json$/i, /\.ya?ml$/i, /\.toml$/i, /\.lock$/i];
      for (const pattern of writeDeniedPatterns) {
        if (pattern.test(resolved)) {
          const relative = pathLib.relative(this.config.workspaceRoot, resolved);
          if (!relative.includes(pathLib.sep)) {
            return {
              allowed: false,
              resolvedPath: resolved,
              denialReason: `Write access denied for root-level config file: ${pathLib.basename(resolved)}`,
              matchedPattern: pattern.source,
            };
          }
        }
      }
    }

    return { allowed: true, resolvedPath: resolved };
  }

  sanitizePath(inputPath: string): string | null {
    const result = this.checkAccess(inputPath);
    return result.allowed ? result.resolvedPath : null;
  }
}
