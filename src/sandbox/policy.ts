import path from 'path';
import picomatch from 'picomatch';
import type { SandboxPolicy } from './types.js';

export interface PolicyOptions {
  allowedPaths?: string[];
  deniedPaths?: string[];
  timeout?: number;
  maxOutputSize?: number;
}

/**
 * Default sensitive path patterns that are always denied.
 * These protect credential files from LLM access even when not explicitly configured.
 * Patterns use glob syntax matched against absolute paths.
 * Default patterns are globs matching anywhere in the path, don't need full resolution.
 */
const DEFAULT_DENY_PATTERNS: string[] = [
  // SSH keys and config
  '**/.ssh/*',
  // AWS credentials
  '**/.aws/credentials',
  '**/.aws/config',
  // GCP credentials
  '**/.config/gcloud/*',
  // Azure credentials
  '**/.azure/*',
  // GPG keys
  '**/.gnupg/*',
  // Docker credentials
  '**/.docker/config.json',
  // Kubernetes credentials
  '**/.kube/config',
  // OpenHarness-style credentials
  '**/.openharness/*credentials*.json',
  // Git configuration with potential credentials
  '**/.git/config',
  // Environment files with potential secrets
  '**/.env',
  '**/.env.*',
  '**/*.env',
  '**/*.env.*',
];

/**
 * Create a sandbox security policy
 * @param options Policy options
 * @returns Complete sandbox policy configuration
 */
export function createPolicy(options: PolicyOptions): SandboxPolicy {
  // Combine user denied paths with default sensitive patterns
  // User custom denied paths that look like absolute paths need to be normalized
  const deniedPaths = [
    ...DEFAULT_DENY_PATTERNS,
    ...(options.deniedPaths ?? []).map((p) => {
      // If it starts with / it's a glob pattern or absolute path.
      // For absolute exact matches we need to normalize them to the current OS format.
      // Globs can remain as-is since picomatch will match against normalized path.
      if (p.includes('*')) {
        // Already a glob pattern, keep as-is - it matches against normalized path
        return p;
      }
      // Exact path, normalize it properly
      let normalized = path.resolve(p);
      normalized = normalized.replace(/\\/g, '/');
      return normalized;
    }),
  ];

  // Pre-normalize all allowed paths to consistent format (forward slashes)
  const normalizedAllowedPaths = (options.allowedPaths ?? [process.cwd()]).map((p) => {
    let normalized = path.resolve(p);
    normalized = normalized.replace(/\\/g, '/');
    return normalized;
  });

  return {
    allowedPaths: normalizedAllowedPaths,
    deniedPaths,
    timeout: options.timeout ?? 60000,
    maxOutputSize: options.maxOutputSize ?? 1024 * 1024,
  };
}

/**
 * Normalize a path (resolves relative, converts to forward slashes)
 * @param filePath Original file path
 * @returns Normalized absolute path with forward slashes
 */
function normalizeAndNormalizeSlashes(filePath: string): string {
  let normalized = path.resolve(filePath);
  normalized = normalized.replace(/\\/g, '/');
  return normalized;
}

/**
 * Check if a path is allowed by the policy
 * @param policy Sandbox policy
 * @param filePath Path to check
 * @returns True if allowed, false if denied
 */
export function isPathAllowed(policy: SandboxPolicy, filePath: string): boolean {
  // Normalize path and convert backslashes to forward slashes
  const normalizedPath = normalizeAndNormalizeSlashes(filePath);

  // Check blacklist glob patterns first (higher priority)
  for (const pattern of policy.deniedPaths) {
    if (picomatch.isMatch(normalizedPath, pattern)) {
      return false;
    }
  }

  // Check whitelist prefix matching - allowed paths already normalized
  for (const normalizedAllowed of policy.allowedPaths) {
    if (normalizedPath.startsWith(normalizedAllowed)) {
      return true;
    }
  }

  return false;
}
