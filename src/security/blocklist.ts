/**
 * MPU-M6: Hardcoded Security Blocklists
 *
 * These lists are NOT configurable. They define dangerous commands,
 * sensitive file paths, and blocked network domains that must always
 * be rejected by the SecurityGuard.
 *
 * @module
 */

/**
 * Blocked shell commands (hardcoded, not configurable)
 *
 * Each entry is matched as a substring within the command string.
 */
export const BLOCKED_COMMANDS: readonly string[] = Object.freeze([
  'rm -rf /',
  'rm -rf /*',
  'dd if=',
  'mkfs',
  ':(){:|:&};:',
  'chmod 777',
]);

/**
 * Blocked file system paths (hardcoded, not configurable)
 *
 * Any path starting with or matching these prefixes is blocked.
 */
export const BLOCKED_PATHS: readonly string[] = Object.freeze([
  '/etc/shadow',
  '/etc/passwd',
  '~/.ssh',
  '~/.gnupg',
  '/root',
]);

/**
 * Blocked network domains (hardcoded, not configurable)
 *
 * Any domain containing one of these strings is blocked.
 */
export const BLOCKED_DOMAINS: readonly string[] = Object.freeze([
  '169.254.169.254',
  'metadata.google.internal',
  'localhost',
  '127.0.0.1',
]);

/**
 * Check if a command contains any blocked pattern.
 *
 * @param command - The command string to check
 * @returns true if the command matches any blocked pattern
 */
export function isCommandBlocked(command: string): boolean {
  return BLOCKED_COMMANDS.some(blocked => command.includes(blocked));
}

/**
 * Check if a path matches any blocked path prefix.
 *
 * @param path - The file path to check
 * @returns true if the path is blocked
 */
export function isPathBlocked(path: string): boolean {
  const normalized = path.replace(/\/+$/, '');
  return BLOCKED_PATHS.some(
    blocked => normalized === blocked || normalized.startsWith(blocked + '/')
  );
}

/**
 * Check if a domain contains any blocked domain string.
 *
 * @param domain - The domain or URL to check
 * @returns true if the domain is blocked
 */
export function isDomainBlocked(domain: string): boolean {
  return BLOCKED_DOMAINS.some(blocked => domain.includes(blocked));
}
