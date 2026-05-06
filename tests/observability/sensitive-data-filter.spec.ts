/**
 * Unit tests for SensitiveDataFilter — sensitive field redaction.
 *
 * Tests: constructor, isSensitive, filter, filterObject, filterDeep.
 * Pure class with no dependencies — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import { SensitiveDataFilter } from '../../src/observability/sensitive-data-filter.js';

// ============================================================
// Constructor
// ============================================================

describe('SensitiveDataFilter constructor', () => {
  it('creates a filter with default patterns', () => {
    const filter = new SensitiveDataFilter();
    expect(filter).toBeInstanceOf(SensitiveDataFilter);
  });

  it('accepts extra custom patterns', () => {
    const filter = new SensitiveDataFilter([/custom_field/i]);
    expect(filter.isSensitive('custom_field')).toBe(true);
  });

  it('default patterns still work with extra patterns', () => {
    const filter = new SensitiveDataFilter([/custom_field/i]);
    expect(filter.isSensitive('api_key')).toBe(true);
    expect(filter.isSensitive('custom_field')).toBe(true);
  });
});

// ============================================================
// isSensitive
// ============================================================

describe('isSensitive', () => {
  let filter: SensitiveDataFilter;

  beforeEach(() => {
    filter = new SensitiveDataFilter();
  });

  it('detects api_key as sensitive', () => {
    expect(filter.isSensitive('api_key')).toBe(true);
  });

  it('detects password as sensitive', () => {
    expect(filter.isSensitive('password')).toBe(true);
  });

  it('detects Authorization header as sensitive', () => {
    expect(filter.isSensitive('Authorization')).toBe(true);
  });

  it('detects token as sensitive', () => {
    expect(filter.isSensitive('access_token')).toBe(true);
  });

  it('detects secret as sensitive', () => {
    expect(filter.isSensitive('client_secret')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(filter.isSensitive('API_KEY')).toBe(true);
    expect(filter.isSensitive('Password')).toBe(true);
    expect(filter.isSensitive('AUTHORIZATION')).toBe(true);
  });

  it('matches partial field names', () => {
    expect(filter.isSensitive('my_api_key_field')).toBe(true);
    expect(filter.isSensitive('user_password_hash')).toBe(true);
  });

  it('returns false for non-sensitive keys', () => {
    expect(filter.isSensitive('username')).toBe(false);
    expect(filter.isSensitive('model')).toBe(false);
    expect(filter.isSensitive('temperature')).toBe(false);
    expect(filter.isSensitive('step_count')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(filter.isSensitive('')).toBe(false);
  });
});

// ============================================================
// filter
// ============================================================

describe('filter', () => {
  let filter: SensitiveDataFilter;

  beforeEach(() => {
    filter = new SensitiveDataFilter();
  });

  it('redacts value for sensitive key', () => {
    expect(filter.filter('api_key', 'sk-abc123')).toBe('[REDACTED]');
  });

  it('passes through value for non-sensitive key', () => {
    expect(filter.filter('username', 'john')).toBe('john');
  });

  it('redacts regardless of value type', () => {
    expect(filter.filter('password', 12345)).toBe('[REDACTED]');
    expect(filter.filter('api_key', null)).toBe('[REDACTED]');
    expect(filter.filter('secret', { nested: 'data' })).toBe('[REDACTED]');
  });
});

// ============================================================
// filterObject
// ============================================================

describe('filterObject', () => {
  let filter: SensitiveDataFilter;

  beforeEach(() => {
    filter = new SensitiveDataFilter();
  });

  it('returns a new object (does not mutate input)', () => {
    const input = { api_key: 'sk-abc', username: 'john' };
    const result = filter.filterObject(input);
    expect(result).not.toBe(input);
    expect(input.api_key).toBe('sk-abc'); // original unchanged
  });

  it('redacts all sensitive keys in flat object', () => {
    const result = filter.filterObject({
      api_key: 'sk-abc',
      password: 'secret123',
      username: 'john',
      model: 'gpt-4o',
    });
    expect(result).toEqual({
      api_key: '[REDACTED]',
      password: '[REDACTED]',
      username: 'john',
      model: 'gpt-4o',
    });
  });

  it('handles empty object', () => {
    expect(filter.filterObject({})).toEqual({});
  });

  it('handles object with only sensitive keys', () => {
    const result = filter.filterObject({ api_key: 'x', password: 'y' });
    expect(result).toEqual({ api_key: '[REDACTED]', password: '[REDACTED]' });
  });

  it('handles object with only non-sensitive keys', () => {
    const result = filter.filterObject({ username: 'john', model: 'gpt-4o' });
    expect(result).toEqual({ username: 'john', model: 'gpt-4o' });
  });
});

// ============================================================
// filterDeep
// ============================================================

describe('filterDeep', () => {
  let filter: SensitiveDataFilter;

  beforeEach(() => {
    filter = new SensitiveDataFilter();
  });

  it('recurse into nested objects and redacts at all levels', () => {
    const result = filter.filterDeep({
      level1: 'safe',
      auth: {
        api_key: 'sk-nested',
        user: 'john',
        inner: {
          secret: 'deep-secret',
        },
      },
    });
    expect(result).toEqual({
      level1: 'safe',
      auth: {
        api_key: '[REDACTED]',
        user: 'john',
        inner: {
          secret: '[REDACTED]',
        },
      },
    });
  });

  it('respects max depth of 5', () => {
    // Build a deeply nested object beyond depth 5
    let deep: Record<string, unknown> = { api_key: 'level6' };
    for (let i = 0; i < 6; i++) {
      deep = { nested: deep };
    }
    const result = filter.filterDeep(deep) as Record<string, unknown>;
    // Should not throw and should return something
    expect(result).toBeDefined();
    // The key at depth 6+ should not be redacted (stopped recursing)
    let current: Record<string, unknown> = result;
    for (let i = 0; i < 5; i++) {
      current = current.nested as Record<string, unknown>;
    }
    // At depth 5, still recursed — the nested value at this level is the sentinel
    expect(current.nested).toEqual({ '[max-depth]': true });
  });

  it('passes arrays through without recursion', () => {
    const result = filter.filterDeep({
      items: ['api_key_value', 'safe_value'],
      meta: { api_key: 'secret' },
    });
    expect(result).toEqual({
      items: ['api_key_value', 'safe_value'],
      meta: { api_key: '[REDACTED]' },
    });
  });

  it('handles null values gracefully', () => {
    const result = filter.filterDeep({
      safe: null,
      nested: { api_key: null },
    });
    expect(result).toEqual({
      safe: null,
      nested: { api_key: '[REDACTED]' },
    });
  });
});
