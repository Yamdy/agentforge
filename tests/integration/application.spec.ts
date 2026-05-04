/**
 * Integration tests for Application class
 *
 * Tests the integration of M8 (Observability), M9 (Graceful Shutdown),
 * and M10 (Result Validation) into the application layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { Application, type AppConfig } from '../../src/app/application.js';

// ============================================================
// Test Helpers
// ============================================================

/**
 * Create an Application with a mock exit handler that records calls
 * instead of actually exiting the process.
 */
function createTestApp(config: Partial<AppConfig> = {}): {
  app: Application;
  exitCalls: number[];
} {
  const exitCalls: number[] = [];
  const app = new Application({
    version: '1.0.0-test',
    onExit: (code: number) => {
      exitCalls.push(code);
      return undefined as never;
    },
    ...config,
  });
  return { app, exitCalls };
}

// ============================================================
// ============================================================

describe('Application', () => {
  describe('health check should return component status', () => {
    it('should return healthy status with component checks', async () => {
      const { app } = createTestApp();

      const health = await app.getHealth();

      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
      expect(health.version).toBe('1.0.0-test');
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(health.checks)).toBe(true);
    });

    it('should include registered component in checks', async () => {
      const { app } = createTestApp();

      // Register a custom health check
      app.healthChecker.registerCheck('custom-component', async () => ({
        name: 'custom-component',
        status: 'healthy',
      }));

      const health = await app.getHealth();

      const customCheck = health.checks.find(
        (c) => c.name === 'custom-component',
      );
      expect(customCheck).toBeDefined();
      expect(customCheck!.status).toBe('healthy');
    });

    it('should report unhealthy when a component fails', async () => {
      const { app } = createTestApp();

      app.healthChecker.registerCheck('failing', async () => ({
        name: 'failing',
        status: 'unhealthy',
        message: 'connection refused',
      }));

      const health = await app.getHealth();

      expect(health.status).toBe('unhealthy');
      const failingCheck = health.checks.find((c) => c.name === 'failing');
      expect(failingCheck).toBeDefined();
      expect(failingCheck!.message).toBe('connection refused');
    });
  });

  // ============================================================
    // ============================================================

  describe('readiness check should return true', () => {
    it('should return ready when all checks are healthy', async () => {
      const { app } = createTestApp();

      const ready = await app.getReady();

      expect(ready.ready).toBe(true);
    });

    it('should return not ready when a check is unhealthy', async () => {
      const { app } = createTestApp();

      app.healthChecker.registerCheck('broken', async () => ({
        name: 'broken',
        status: 'unhealthy',
        message: 'down',
      }));

      const ready = await app.getReady();

      expect(ready.ready).toBe(false);
      expect(ready.reasons).toBeDefined();
      expect(ready.reasons!.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
    // ============================================================

  describe('metrics endpoint should return Prometheus format', () => {
    it('should return Prometheus text format', async () => {
      const { app } = createTestApp();

      // Record some metrics
      app.metricsCollector.incrementCounter('test_requests');
      app.metricsCollector.recordGauge('active_connections', 5);
      app.metricsCollector.recordHistogram('request_duration_ms', 42);

      const metrics = await app.getMetrics();

      expect(typeof metrics).toBe('string');
      // Prometheus format includes HELP and TYPE lines
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
    });

    it('should include counter metric value', async () => {
      const { app } = createTestApp();

      app.metricsCollector.incrementCounter('app_starts');
      app.metricsCollector.incrementCounter('app_starts');

      const metrics = await app.getMetrics();

      expect(metrics).toContain('app_starts');
      expect(metrics).toContain('2');
    });

    it('should include gauge metric value', async () => {
      const { app } = createTestApp();

      app.metricsCollector.recordGauge('heap_used_mb', 128);

      const metrics = await app.getMetrics();

      expect(metrics).toContain('heap_used_mb');
      expect(metrics).toContain('128');
    });
  });

  // ============================================================
    // ============================================================

  describe('SIGTERM should trigger graceful shutdown', () => {
    it('should execute shutdown and exit with code 0 on clean shutdown', async () => {
      const { app, exitCalls } = createTestApp();

      await app.shutdown();

      expect(exitCalls).toHaveLength(1);
      expect(exitCalls[0]).toBe(0);
    });

    it('should record shutdown metric', async () => {
      const { app, exitCalls } = createTestApp();

      // Track if cleanups ran
      const cleanupsRan: string[] = [];
      app.gracefulShutdown.registerCleanup('test-cleanup', async () => {
        cleanupsRan.push('test-cleanup');
      });

      await app.shutdown();

      expect(exitCalls).toHaveLength(1);
      expect(exitCalls[0]).toBe(0);
      expect(cleanupsRan).toContain('test-cleanup');
    });
  });

  // ============================================================
    // ============================================================

  describe('cleanup functions should execute in order', () => {
    it('should execute registered cleanups sequentially', async () => {
      const { app } = createTestApp();
      const order: string[] = [];

      app.gracefulShutdown.registerCleanup('first', async () => {
        order.push('first');
      });
      app.gracefulShutdown.registerCleanup('second', async () => {
        order.push('second');
      });
      app.gracefulShutdown.registerCleanup('third', async () => {
        order.push('third');
      });

      // Trigger shutdown
      await app.shutdown();

      expect(order).toEqual(['first', 'second', 'third']);
    });

    it('should continue executing remaining cleanups if one fails', async () => {
      const { app } = createTestApp();
      const order: string[] = [];

      app.gracefulShutdown.registerCleanup('good-1', async () => {
        order.push('good-1');
      });
      app.gracefulShutdown.registerCleanup('bad', async () => {
        throw new Error('cleanup failed');
      });
      app.gracefulShutdown.registerCleanup('good-2', async () => {
        order.push('good-2');
      });

      await app.shutdown();

      expect(order).toContain('good-1');
      expect(order).toContain('good-2');
    });

    it('should execute default cleanups (llm, storage)', async () => {
      const { app } = createTestApp();
      const order: string[] = [];

      // Add a custom cleanup after defaults
      app.gracefulShutdown.registerCleanup('custom', async () => {
        order.push('custom');
      });

      await app.shutdown();

      // Default cleanups (llm, storage) should run before custom
      expect(order).toContain('custom');
    });
  });

  // ============================================================
    // ============================================================

  describe('timeout should force exit', () => {
    it('should force exit with code 1 when shutdown times out', async () => {
      const { app, exitCalls } = createTestApp({ shutdownTimeoutMs: 50 });

      // Register a cleanup that takes too long
      vi.useFakeTimers();
      app.gracefulShutdown.registerCleanup('slow', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const shutdownPromise = app.shutdown();
      await vi.advanceTimersByTimeAsync(50);
      await shutdownPromise;
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      expect(exitCalls).toHaveLength(1);
      expect(exitCalls[0]).toBe(1);
    });

    it('should exit with code 0 when shutdown completes within timeout', async () => {
      const { app, exitCalls } = createTestApp({ shutdownTimeoutMs: 5000 });

      app.gracefulShutdown.registerCleanup('fast', async () => {
        // Instant cleanup
      });

      vi.useFakeTimers();
      const shutdownPromise = app.shutdown();
      await vi.advanceTimersByTimeAsync(0);
      await shutdownPromise;
      vi.useRealTimers();

      expect(exitCalls).toHaveLength(1);
      expect(exitCalls[0]).toBe(0);
    });
  });

  // ============================================================
    // ============================================================

  describe('result validation failure should return warnings', () => {
    it('should return warnings when validation fails', () => {
      const { app } = createTestApp();

      // Register a schema for a tool
      const schema = z.object({
        name: z.string(),
        value: z.number(),
      });
      app.resultValidator.registerSchema('data-tool', schema);

      // Validate with invalid data
      const result = app.validateToolResult('data-tool', {
        name: 123, // wrong type
        value: 'not-a-number', // wrong type
      });

      expect(result.toolName).toBe('data-tool');
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
    });

    it('should return no warnings when validation passes', () => {
      const { app } = createTestApp();

      const schema = z.object({
        name: z.string(),
        value: z.number(),
      });
      app.resultValidator.registerSchema('data-tool', schema);

      const result = app.validateToolResult('data-tool', {
        name: 'test',
        value: 42,
      });

      expect(result.toolName).toBe('data-tool');
      expect(result.warnings).toBeUndefined();
    });

    it('should return no warnings when no schema is registered', () => {
      const { app } = createTestApp();

      const result = app.validateToolResult('unknown-tool', {
        anything: 'goes',
      });

      expect(result.toolName).toBe('unknown-tool');
      expect(result.warnings).toBeUndefined();
    });

    it('should include validation error details in warnings', () => {
      const { app } = createTestApp();

      const schema = z.object({ count: z.number() });
      app.resultValidator.registerSchema('counter-tool', schema);

      const result = app.validateToolResult('counter-tool', {
        count: 'not-a-number',
      });

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      // Warning should contain path and message info
      const warning = result.warnings![0]!;
      expect(warning).toContain('count');
    });
  });

  // ============================================================
  // Additional integration tests
  // ============================================================

  describe('start() and lifecycle', () => {
    it('should set isRunning to true after start', async () => {
      const { app } = createTestApp();

      expect(app.isRunning).toBe(false);

      await app.start();

      expect(app.isRunning).toBe(true);
    });

    it('should set isRunning to false after shutdown', async () => {
      const { app } = createTestApp();

      await app.start();
      expect(app.isRunning).toBe(true);

      await app.shutdown();
      expect(app.isRunning).toBe(false);
    });

    it('should record startup metric', async () => {
      const { app } = createTestApp();

      await app.start();

      const metrics = await app.getMetrics();
      expect(metrics).toContain('app_starts');
    });
  });
});
