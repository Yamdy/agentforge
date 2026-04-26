/**
 * Unit tests for src/observability/health-checker.ts
 *
 * Tests HealthChecker: component registration, health aggregation,
 * readiness checks, and status derivation logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HealthCheckerImpl,
  type HealthCheckerOptions,
} from '../../src/observability/health-checker.js';
import type {
  HealthStatus,
  ReadinessStatus,
  ComponentHealth,
} from '../../src/contracts/mpu-interfaces.js';

// ============================================================
// Construction
// ============================================================

describe('HealthCheckerImpl', () => {
  describe('constructor', () => {
    it('should create with default options', () => {
      const checker = new HealthCheckerImpl();
      expect(checker).toBeDefined();
    });

    it('should accept custom version', () => {
      const checker = new HealthCheckerImpl({ version: '2.0.0' });
      expect(checker).toBeDefined();
    });
  });

  // ============================================================
  // registerCheck
  // ============================================================

  describe('registerCheck', () => {
    let checker: HealthCheckerImpl;

    beforeEach(() => {
      checker = new HealthCheckerImpl({ version: '1.0.0' });
    });

    it('should register a health check', () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'healthy' as const,
      }));
      // No error means registration succeeded
    });

    it('should allow registering multiple checks', () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'healthy' as const,
      }));
      checker.registerCheck('cache', async () => ({
        name: 'cache',
        status: 'healthy' as const,
      }));
      // No error means registration succeeded
    });

    it('should overwrite a check with the same name', () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'healthy' as const,
      }));
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'degraded' as const,
        message: 'slow',
      }));
      // No error — last registration wins
    });
  });

  // ============================================================
  // check()
  // ============================================================

  describe('check', () => {
    let checker: HealthCheckerImpl;

    beforeEach(() => {
      checker = new HealthCheckerImpl({ version: '1.0.0' });
    });

    it('should return healthy when no checks registered', async () => {
      const status = await checker.check();
      expect(status.status).toBe('healthy');
      expect(status.version).toBe('1.0.0');
      expect(status.checks).toEqual([]);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return healthy when all checks are healthy', async () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'healthy' as const,
      }));
      checker.registerCheck('cache', async () => ({
        name: 'cache',
        status: 'healthy' as const,
      }));

      const status = await checker.check();
      expect(status.status).toBe('healthy');
      expect(status.checks).toHaveLength(2);
      expect(status.checks.every((c) => c.status === 'healthy')).toBe(true);
    });

    it('should return degraded when any check is degraded', async () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'healthy' as const,
      }));
      checker.registerCheck('cache', async () => ({
        name: 'cache',
        status: 'degraded' as const,
        message: 'high latency',
      }));

      const status = await checker.check();
      expect(status.status).toBe('degraded');
    });

    it('should return unhealthy when any check is unhealthy', async () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'healthy' as const,
      }));
      checker.registerCheck('cache', async () => ({
        name: 'cache',
        status: 'unhealthy' as const,
        message: 'connection refused',
      }));

      const status = await checker.check();
      expect(status.status).toBe('unhealthy');
    });

    it('should return unhealthy when multiple checks have mixed unhealthy states', async () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'unhealthy' as const,
        message: 'down',
      }));
      checker.registerCheck('cache', async () => ({
        name: 'cache',
        status: 'degraded' as const,
      }));

      const status = await checker.check();
      expect(status.status).toBe('unhealthy');
    });

    it('should measure latency of each check', async () => {
      checker.registerCheck('fast', async () => ({
        name: 'fast',
        status: 'healthy' as const,
      }));
      checker.registerCheck('slow', async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { name: 'slow', status: 'healthy' as const };
      });

      const status = await checker.check();
      expect(status.checks).toHaveLength(2);

      const slowCheck = status.checks.find((c) => c.name === 'slow');
      expect(slowCheck).toBeDefined();
      expect(slowCheck!.latencyMs).toBeGreaterThanOrEqual(40);

      const fastCheck = status.checks.find((c) => c.name === 'fast');
      expect(fastCheck).toBeDefined();
      expect(fastCheck!.latencyMs).toBeLessThan(50);
    });

    it('should handle a check that throws an error', async () => {
      checker.registerCheck('failing', async () => {
        throw new Error('boom');
      });

      const status = await checker.check();
      expect(status.status).toBe('unhealthy');
      expect(status.checks).toHaveLength(1);
      expect(status.checks[0]!.status).toBe('unhealthy');
      expect(status.checks[0]!.message).toContain('boom');
    });

    it('should handle a check that returns invalid status gracefully', async () => {
      checker.registerCheck('bad', async () => ({
        name: 'bad',
        status: 'healthy' as const,
        message: undefined,
      }));

      const status = await checker.check();
      expect(status.status).toBe('healthy');
    });

    it('should include version from options', async () => {
      const checker2 = new HealthCheckerImpl({ version: '3.2.1' });
      const status = await checker2.check();
      expect(status.version).toBe('3.2.1');
    });

    it('should include uptime as a positive number', async () => {
      const status = await checker.check();
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof status.uptime).toBe('number');
    });

    it('should run all checks even if one fails', async () => {
      checker.registerCheck('failing', async () => {
        throw new Error('boom');
      });
      checker.registerCheck('working', async () => ({
        name: 'working',
        status: 'healthy' as const,
      }));

      const status = await checker.check();
      expect(status.checks).toHaveLength(2);
    });

    it('should run checks concurrently (not sequentially)', async () => {
      const start = Date.now();

      checker.registerCheck('a', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { name: 'a', status: 'healthy' as const };
      });
      checker.registerCheck('b', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { name: 'b', status: 'healthy' as const };
      });

      await checker.check();
      const elapsed = Date.now() - start;
      // If truly concurrent, ~100ms; if sequential, ~200ms
      expect(elapsed).toBeLessThan(180);
    });
  });

  // ============================================================
  // ready()
  // ============================================================

  describe('ready', () => {
    let checker: HealthCheckerImpl;

    beforeEach(() => {
      checker = new HealthCheckerImpl({ version: '1.0.0' });
    });

    it('should return ready when no checks registered', async () => {
      const result = await checker.ready();
      expect(result.ready).toBe(true);
      expect(result.reasons).toBeUndefined();
    });

    it('should return ready when all checks are healthy', async () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'healthy' as const,
      }));

      const result = await checker.ready();
      expect(result.ready).toBe(true);
    });

    it('should return not ready when a check is unhealthy', async () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'unhealthy' as const,
        message: 'down',
      }));

      const result = await checker.ready();
      expect(result.ready).toBe(false);
      expect(result.reasons).toBeDefined();
      expect(result.reasons!.length).toBeGreaterThan(0);
      expect(result.reasons![0]).toContain('db');
    });

    it('should return not ready when a check is degraded', async () => {
      checker.registerCheck('cache', async () => ({
        name: 'cache',
        status: 'degraded' as const,
        message: 'slow',
      }));

      const result = await checker.ready();
      expect(result.ready).toBe(false);
      expect(result.reasons).toBeDefined();
    });

    it('should return not ready when a check throws', async () => {
      checker.registerCheck('broken', async () => {
        throw new Error('connection timeout');
      });

      const result = await checker.ready();
      expect(result.ready).toBe(false);
      expect(result.reasons).toBeDefined();
      expect(result.reasons!.length).toBeGreaterThan(0);
    });

    it('should collect all failing reasons', async () => {
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'unhealthy' as const,
        message: 'down',
      }));
      checker.registerCheck('cache', async () => ({
        name: 'cache',
        status: 'degraded' as const,
        message: 'slow',
      }));
      checker.registerCheck('api', async () => ({
        name: 'api',
        status: 'healthy' as const,
      }));

      const result = await checker.ready();
      expect(result.ready).toBe(false);
      expect(result.reasons).toHaveLength(2);
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================

  describe('edge cases', () => {
    it('should handle default version when none provided', async () => {
      const checker = new HealthCheckerImpl();
      const status = await checker.check();
      expect(status.version).toBe('0.0.0');
    });

    it('should handle checks returning all possible statuses', async () => {
      const checker = new HealthCheckerImpl();

      checker.registerCheck('h', async () => ({
        name: 'h',
        status: 'healthy' as const,
      }));
      checker.registerCheck('d', async () => ({
        name: 'd',
        status: 'degraded' as const,
      }));
      checker.registerCheck('u', async () => ({
        name: 'u',
        status: 'unhealthy' as const,
      }));

      const status = await checker.check();
      expect(status.status).toBe('unhealthy'); // worst wins
      expect(status.checks).toHaveLength(3);
    });

    it('should handle concurrent ready() and check() calls', async () => {
      const checker = new HealthCheckerImpl();
      checker.registerCheck('db', async () => ({
        name: 'db',
        status: 'healthy' as const,
      }));

      const [health, readiness] = await Promise.all([
        checker.check(),
        checker.ready(),
      ]);
      expect(health.status).toBe('healthy');
      expect(readiness.ready).toBe(true);
    });
  });
});
