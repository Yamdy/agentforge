/**
 * MPU-M6: SecurityGuard
 *
 * Validates commands, file paths, and network domains against
 * blocklists. Default blocklists are hardcoded; additional entries
 * can be injected via {@link BlocklistConfig}.
 *
 * @module
 */

import type { BlocklistConfig } from './blocklist-config.js';
import { mergeBlocklists } from './blocklist-config.js';
import {
  DEFAULT_BLOCKED_COMMANDS,
  DEFAULT_BLOCKED_PATHS,
  DEFAULT_BLOCKED_DOMAINS,
  extractHostname,
  matchesDomain,
} from './blocklist.js';

/**
 * Result of a security check
 */
export interface SecurityCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for denial (only present when allowed=false) */
  reason?: string;
}

/**
 * SecurityGuard validates tool operations against blocklists.
 *
 * Three check dimensions:
 * - **Command**: blocks dangerous shell commands (rm -rf, dd, fork bomb, etc.)
 * - **Path**: blocks sensitive file paths (/etc/shadow, ~/.ssh, /root, etc.)
 * - **Network**: blocks metadata/internal endpoints (169.254.169.254, localhost, etc.)
 *
 * Blocklists are built from hardcoded defaults merged with any additional
 * entries provided via {@link BlocklistConfig}.
 */
export class SecurityGuard {
  private readonly commands: string[];
  private readonly paths: string[];
  private readonly domains: string[];

  /**
   * Create a new SecurityGuard.
   *
   * @param config - Optional additional blocklist entries that extend the defaults
   */
  constructor(config?: BlocklistConfig) {
    this.commands = mergeBlocklists(DEFAULT_BLOCKED_COMMANDS, config?.commands);
    this.paths = mergeBlocklists(DEFAULT_BLOCKED_PATHS, config?.paths);
    this.domains = mergeBlocklists(DEFAULT_BLOCKED_DOMAINS, config?.domains);
  }
  /**
   * Check if a shell command is safe to execute.
   *
   * @param command - The command string to validate
   * @returns SecurityCheckResult with allowed status
   */
  checkCommand(command: string): SecurityCheckResult {
    const blocked = this.commands.find(entry => command.includes(entry));
    if (blocked) {
      return {
        allowed: false,
        reason: `Blocked command pattern: "${blocked}"`,
      };
    }
    return { allowed: true };
  }

  /**
   * Check if a file path is safe to access.
   *
   * @param path - The file path to validate
   * @param mode - Access mode: 'read' or 'write'
   * @returns SecurityCheckResult with allowed status
   */
  checkPath(path: string, mode: 'read' | 'write'): SecurityCheckResult {
    const normalized = path.replace(/\/+$/, '');
    const matched = this.paths.find(
      blocked => normalized === blocked || normalized.startsWith(blocked + '/')
    );
    if (matched) {
      return {
        allowed: false,
        reason: `Blocked ${mode} access to sensitive path: "${matched}"`,
      };
    }
    return { allowed: true };
  }

  /**
   * Check if a network domain is safe to connect to.
   *
   * Extracts the hostname from URL-like inputs and performs
   * proper subdomain matching (like `isDomainBlocked`).
   *
   * @param domain - The domain or URL to validate
   * @returns SecurityCheckResult with allowed status
   */
  checkNetwork(domain: string): SecurityCheckResult {
    if (!domain) return { allowed: true };
    const hostname = extractHostname(domain).toLowerCase();
    const matched = this.domains.find(entry => matchesDomain(hostname, entry.toLowerCase()));
    if (matched) {
      return {
        allowed: false,
        reason: `Blocked network access to restricted domain: "${matched}"`,
      };
    }
    return { allowed: true };
  }
}
