/**
 * MPU-M6: SecurityGuard
 *
 * Validates commands, file paths, and network domains against
 * hardcoded blocklists. All checks are synchronous and deterministic.
 *
 * @module
 */

import {
  BLOCKED_COMMANDS,
  BLOCKED_PATHS,
  BLOCKED_DOMAINS,
  isCommandBlocked,
  isPathBlocked,
  isDomainBlocked,
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
 * SecurityGuard validates tool operations against hardcoded blocklists.
 *
 * Three check dimensions:
 * - **Command**: blocks dangerous shell commands (rm -rf, dd, fork bomb, etc.)
 * - **Path**: blocks sensitive file paths (/etc/shadow, ~/.ssh, /root, etc.)
 * - **Network**: blocks metadata/internal endpoints (169.254.169.254, localhost, etc.)
 *
 * Blocklists are hardcoded and NOT configurable by design.
 */
export class SecurityGuard {
  /**
   * Check if a shell command is safe to execute.
   *
   * @param command - The command string to validate
   * @returns SecurityCheckResult with allowed status
   */
  checkCommand(command: string): SecurityCheckResult {
    if (isCommandBlocked(command)) {
      const matched = BLOCKED_COMMANDS.find(blocked => command.includes(blocked));
      return {
        allowed: false,
        reason: `Blocked command pattern: "${matched}"`,
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
    if (isPathBlocked(path)) {
      const matched = BLOCKED_PATHS.find(
        blocked =>
          path === blocked || path.startsWith(blocked + '/') || path.replace(/\/+$/, '') === blocked
      );
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
   * @param domain - The domain or URL to validate
   * @returns SecurityCheckResult with allowed status
   */
  checkNetwork(domain: string): SecurityCheckResult {
    if (isDomainBlocked(domain)) {
      const matched = BLOCKED_DOMAINS.find(blocked => domain.includes(blocked));
      return {
        allowed: false,
        reason: `Blocked network access to restricted domain: "${matched}"`,
      };
    }
    return { allowed: true };
  }
}
