/**
 * MPU-M6: Security Blocklists
 *
 * These lists define dangerous commands, sensitive file paths, and blocked
 * network domains. They serve as hardcoded defaults; the SecurityGuard can
 * accept additional blocklist entries via BlocklistConfig.
 *
 * @module
 */

/**
 * Blocked shell commands (default, hardcoded)
 *
 * Each entry is matched as a substring within the command string.
 */
export const DEFAULT_BLOCKED_COMMANDS: readonly string[] = Object.freeze([
  'rm -rf /',
  'rm -rf /*',
  'dd if=',
  'mkfs',
  ':(){:|:&};:',
  'chmod 777',
]);

/**
 * Blocked file system paths (default, hardcoded)
 *
 * Any path starting with or matching these prefixes is blocked.
 */
export const DEFAULT_BLOCKED_PATHS: readonly string[] = Object.freeze([
  '/etc/shadow',
  '/etc/passwd',
  '~/.ssh',
  '~/.gnupg',
  '/root',
]);

/**
 * Blocked network domains (default, hardcoded)
 *
 * Any domain containing one of these strings is blocked.
 */
export const DEFAULT_BLOCKED_DOMAINS: readonly string[] = Object.freeze([
  '169.254.169.254',
  'metadata.google.internal',
  'localhost',
  '127.0.0.1',
  '::1',
]);

/** @deprecated Use DEFAULT_BLOCKED_COMMANDS instead */
export const BLOCKED_COMMANDS = DEFAULT_BLOCKED_COMMANDS;
/** @deprecated Use DEFAULT_BLOCKED_PATHS instead */
export const BLOCKED_PATHS = DEFAULT_BLOCKED_PATHS;
/** @deprecated Use DEFAULT_BLOCKED_DOMAINS instead */
export const BLOCKED_DOMAINS = DEFAULT_BLOCKED_DOMAINS;

/**
 * Check if a command contains any blocked pattern.
 *
 * @param command - The command string to check
 * @returns true if the command matches any blocked pattern
 */
export function isCommandBlocked(command: string): boolean {
  return DEFAULT_BLOCKED_COMMANDS.some(blocked => command.includes(blocked));
}

/**
 * Check if a path matches any blocked path prefix.
 *
 * @param path - The file path to check
 * @returns true if the path is blocked
 */
export function isPathBlocked(path: string): boolean {
  const normalized = path.replace(/\/+$/, '');
  return DEFAULT_BLOCKED_PATHS.some(
    blocked => normalized === blocked || normalized.startsWith(blocked + '/')
  );
}

/**
 * Extract a hostname from a domain string that may be a URL.
 */
export function extractHostname(input: string): string {
  try {
    const url = new URL(input.includes('://') ? input : `http://${input}`);
    return url.hostname || input;
  } catch {
    return input;
  }
}

/**
 * Check if a string looks like an IPv4 address (exact match only).
 */
function isIpAddress(s: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(s);
}

/**
 * Check if a hostname matches a domain (exact or subdomain).
 * For example, 'api.example.com' matches 'example.com',
 * but 'myexample.com' does NOT match 'example.com'.
 *
 * IP addresses are exact-match only — no subdomain concept for IPs.
 */
export function matchesDomain(hostname: string, domain: string): boolean {
  if (hostname === domain) return true;
  // IP addresses don't have subdomains — exact match only
  if (isIpAddress(domain)) return false;
  if (hostname.endsWith('.' + domain)) return true;
  return false;
}

/**
 * Check if a domain is blocked.
 *
 * Extracts the hostname from URL-like inputs and performs
 * proper subdomain matching. Blocks 'localhost' and
 * 'sub.localhost', but NOT 'my-localhost.example.com'.
 *
 * @param domain - The domain or URL to check
 * @returns true if the domain is blocked
 */
export function isDomainBlocked(domain: string): boolean {
  if (!domain) return false;
  const hostname = extractHostname(domain).toLowerCase();
  return DEFAULT_BLOCKED_DOMAINS.some(blocked => matchesDomain(hostname, blocked.toLowerCase()));
}
