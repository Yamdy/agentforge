import { describe, it, expect } from 'vitest';
import { validatePushNotificationUrl } from '../../src/a2a/url-validator.js';

describe('validatePushNotificationUrl', () => {
  // 1. Rejects http:// URLs (must be https://)
  it('rejects http:// URLs', () => {
    const result = validatePushNotificationUrl('http://example.com/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/https/i);
  });

  // 2. Rejects loopback addresses
  it('rejects https://127.0.0.1', () => {
    const result = validatePushNotificationUrl('https://127.0.0.1/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/loopback|private|reserved/i);
  });

  it('rejects https://localhost', () => {
    const result = validatePushNotificationUrl('https://localhost/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/loopback|private|reserved/i);
  });

  it('rejects https://[::1] (IPv6 loopback)', () => {
    const result = validatePushNotificationUrl('https://[::1]/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/loopback|private|reserved/i);
  });

  // 3. Rejects RFC 1918 private IPs
  it('rejects 10.x.x.x private IP', () => {
    const result = validatePushNotificationUrl('https://10.0.0.1/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private|reserved/i);
  });

  it('rejects 172.16.x.x private IP', () => {
    const result = validatePushNotificationUrl('https://172.16.0.1/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private|reserved/i);
  });

  it('rejects 192.168.x.x private IP', () => {
    const result = validatePushNotificationUrl('https://192.168.0.1/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private|reserved/i);
  });

  // 4. Rejects link-local / metadata endpoints
  it('rejects 169.254.169.254 (cloud metadata)', () => {
    const result = validatePushNotificationUrl('https://169.254.169.254/latest/meta-data/');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/link.local|private|reserved/i);
  });

  // 5. Rejects non-http(s) schemes
  it('rejects file:// scheme', () => {
    const result = validatePushNotificationUrl('file:///etc/passwd');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/https/i);
  });

  it('rejects ftp:// scheme', () => {
    const result = validatePushNotificationUrl('ftp://evil.com/payload');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/https/i);
  });

  it('rejects javascript: scheme', () => {
    const result = validatePushNotificationUrl('javascript:alert(1)');
    expect(result.valid).toBe(false);
  });

  // 6. Accepts valid public https:// URLs
  it('accepts valid public https:// URL', () => {
    const result = validatePushNotificationUrl('https://example.com/webhook');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('accepts https:// URL with path and query', () => {
    const result = validatePushNotificationUrl('https://api.example.com/v1/notify?token=abc');
    expect(result.valid).toBe(true);
  });

  it('accepts https:// URL with port', () => {
    const result = validatePushNotificationUrl('https://example.com:8443/webhook');
    expect(result.valid).toBe(true);
  });

  it('rejects empty string', () => {
    const result = validatePushNotificationUrl('');
    expect(result.valid).toBe(false);
  });

  it('rejects unparseable URL', () => {
    const result = validatePushNotificationUrl('not-a-url');
    expect(result.valid).toBe(false);
  });

  it('rejects 0.0.0.0', () => {
    const result = validatePushNotificationUrl('https://0.0.0.0/webhook');
    expect(result.valid).toBe(false);
  });
});
