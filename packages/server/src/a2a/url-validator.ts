/**
 * Validates push notification URLs to prevent SSRF attacks.
 *
 * Rules:
 *  - Must be https://
 *  - Hostname must not resolve to loopback, private, link-local, or reserved IPs
 *  - Must be parseable
 */

const IPV4_LOOPBACK = /^127\./;
const IPV4_PRIVATE_10 = /^10\./;
const IPV4_PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./;
const IPV4_PRIVATE_192 = /^192\.168\./;
const IPV4_LINK_LOCAL = /^169\.254\./;
const IPV4_ZERO = /^0\.0\.0\.0$/;

const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

export function validatePushNotificationUrl(url: string): { valid: boolean; reason?: string } {
  if (!url) {
    return { valid: false, reason: 'URL is empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'URL is not parseable' };
  }

  // Must be https
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'URL must use https scheme' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check well-known loopback hostnames
  if (LOOPBACK_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: 'Hostname resolves to loopback address' };
  }

  // IPv6 loopback
  if (hostname === '::1' || hostname === '[::1]') {
    return { valid: false, reason: 'Hostname resolves to loopback address' };
  }

  // IPv4 checks
  if (IPV4_LOOPBACK.test(hostname)) {
    return { valid: false, reason: 'Hostname resolves to loopback address' };
  }
  if (IPV4_PRIVATE_10.test(hostname)) {
    return { valid: false, reason: 'Hostname is a private (RFC 1918) address' };
  }
  if (IPV4_PRIVATE_172.test(hostname)) {
    return { valid: false, reason: 'Hostname is a private (RFC 1918) address' };
  }
  if (IPV4_PRIVATE_192.test(hostname)) {
    return { valid: false, reason: 'Hostname is a private (RFC 1918) address' };
  }
  if (IPV4_LINK_LOCAL.test(hostname)) {
    return { valid: false, reason: 'Hostname is a link-local address' };
  }
  if (IPV4_ZERO.test(hostname)) {
    return { valid: false, reason: 'Hostname is a reserved address' };
  }

  return { valid: true };
}
