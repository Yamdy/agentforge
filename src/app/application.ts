/**
 * Application Entry Point
 *
 * Integrates M8 (Observability), M9 (Graceful Shutdown), and M10 (Result Validation)
 * into a unified application layer.
 *
 * - Health check endpoints: /health, /ready, /metrics
 * - Graceful shutdown with ordered cleanup and timeout
 * - Tool result validation with schema-based checking
 *
 * @module app/application
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { HealthCheckerImpl } from '../observability/health-checker.js';
import { MetricsCollectorImpl } from '../observability/metrics-collector.js';
import { GracefulShutdown } from '../lifecycle/graceful-shutdown.js';
import { ResultValidatorImpl } from '../validation/result-validator.js';
import type {
  HealthChecker,
  HealthStatus,
  ReadinessStatus,
  MetricsCollector,
  ResultValidator,
  ValidationResult,
  CostTracker,
  AuditStore,
} from '../contracts/mpu-interfaces.js';
import { MemoryCostTracker } from '../quota/cost-tracker.js';

/**
 * Application configuration
 */
export interface AppConfig {
  /** Application version (default: '0.0.0') */
  readonly version?: string;
  /** HTTP port for health/metrics endpoints */
  readonly port?: number;
  /** Shutdown timeout in ms (default: 10000) */
  readonly shutdownTimeoutMs?: number;
  /** Custom exit handler (default: process.exit) */
  readonly onExit?: (code: number) => never;
  /** Cost tracker instance */
  readonly costTracker?: CostTracker;
  /** Audit store instance */
  readonly auditStore?: AuditStore;
}

/**
 * Tool result with optional validation warnings
 */
export interface ToolResult {
  /** Tool name */
  readonly toolName: string;
  /** Result data */
  readonly result: unknown;
  /** Validation warnings (present when validation fails) */
  readonly warnings?: readonly string[];
}

/**
 * Application integrating M8 + M9 + M10.
 *
 * Provides health check HTTP endpoints, graceful shutdown management,
 * and tool result validation.
 *
 * @example
 * ```typescript
 * const app = new Application({ version: '1.0.0', port: 3000 });
 * await app.start();
 *
 * // Later, on SIGTERM/SIGINT:
 * await app.shutdown();
 * ```
 */
export class Application {
  readonly healthChecker: HealthChecker;
  readonly metricsCollector: MetricsCollector;
  readonly gracefulShutdown: GracefulShutdown;
  readonly resultValidator: ResultValidator;
  readonly costTracker: CostTracker;
  readonly auditStore: AuditStore | undefined;

  private readonly _version: string;
  private readonly _port: number | undefined;
  private readonly _shutdownTimeoutMs: number;
  private readonly _onExit: (code: number) => never;
  private _httpServer: Server | undefined;
  private _running = false;
  private _signalListenersAttached = false;

  constructor(config: AppConfig = {}) {
    this._version = config.version ?? '0.0.0';
    this._port = config.port;
    this._shutdownTimeoutMs = config.shutdownTimeoutMs ?? 10000;
    this._onExit = config.onExit ?? ((code: number): never => process.exit(code));
    this.auditStore = config.auditStore;

    // M8: Observability
    this.healthChecker = new HealthCheckerImpl({ version: this._version });
    this.metricsCollector = new MetricsCollectorImpl();

    // M9: Graceful Shutdown
    this.gracefulShutdown = new GracefulShutdown();

    // M10: Result Validation
    this.resultValidator = new ResultValidatorImpl();

    // M7: Cost Tracking
    this.costTracker = config.costTracker ?? new MemoryCostTracker();

    // Register default health checks
    this._registerDefaultHealthChecks();

    // Register default cleanup handlers
    this._registerDefaultCleanups();
  }

  /**
   * Start the application.
   *
   * Captures SIGTERM/SIGINT for graceful shutdown and starts HTTP endpoints
   * if a port is configured.
   */
  async start(): Promise<void> {
    this._running = true;

    // Capture exit signals
    this._attachSignalListeners();

    // Start HTTP server if port is configured
    if (this._port !== undefined) {
      await this._startHttpServer(this._port);
    }

    // Record startup metric
    this.metricsCollector.incrementCounter('app_starts');
  }

  /**
   * Execute graceful shutdown.
   *
   * Runs all registered cleanup functions, then exits.
   * Forces exit on timeout.
   */
  async shutdown(): Promise<void> {
    this._running = false;
    this._detachSignalListeners();

    const result = await this.gracefulShutdown.shutdown(this._shutdownTimeoutMs);

    if (!result.success) {
      console.error('Shutdown timed out, forcing exit');
      this._onExit(1);
      return;
    }

    this._onExit(0);
  }

  /**
   * Get health status.
   *
   * @returns Aggregated health status from all registered checks
   */
  async getHealth(): Promise<HealthStatus> {
    return this.healthChecker.check();
  }

  /**
   * Get readiness status.
   *
   * @returns Readiness status (true when all checks are healthy)
   */
  async getReady(): Promise<ReadinessStatus> {
    return this.healthChecker.ready();
  }

  /**
   * Get Prometheus metrics.
   *
   * @returns Prometheus text exposition format string
   */
  async getMetrics(): Promise<string> {
    return this.metricsCollector.getMetrics();
  }

  /**
   * Validate a tool result against registered schemas.
   *
   * If validation fails, returns the result with warnings.
   * If validation passes, returns the result unchanged.
   *
   * @param toolName - Name of the tool
   * @param result - Tool execution result
   * @returns Tool result, possibly with validation warnings
   */
  validateToolResult(toolName: string, result: unknown): ToolResult {
    const validation: ValidationResult = this.resultValidator.validate(toolName, result);

    if (validation.valid) {
      return { toolName, result };
    }

    const warnings: string[] = validation.errors.map(
      e => `[${e.code ?? 'VALIDATION'}] ${e.path}: ${e.message}`
    );

    return { toolName, result, warnings };
  }

  /**
   * Whether the application is currently running.
   */
  get isRunning(): boolean {
    return this._running;
  }

  // ===== Private Methods =====

  /**
   * Register default health checks for core components.
   */
  private _registerDefaultHealthChecks(): void {
    // Storage health check
    this.healthChecker.registerCheck('storage', async () => {
      try {
        if (this.auditStore) {
          await this.auditStore.count();
        }
        return { name: 'storage', status: 'healthy' as const };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { name: 'storage', status: 'unhealthy' as const, message };
      }
    });
  }

  /**
   * Register default cleanup handlers for graceful shutdown.
   */
  private _registerDefaultCleanups(): void {
    // LLM connection cleanup
    this.gracefulShutdown.registerCleanup('llm', async () => {
      // Close LLM connections (placeholder — real adapters implement close)
    });

    // Storage state save
    this.gracefulShutdown.registerCleanup('storage', async () => {
      // Save pending state (placeholder — real storage implements flush)
    });
  }

  /**
   * Attach SIGTERM/SIGINT signal listeners.
   */
  private _attachSignalListeners(): void {
    if (this._signalListenersAttached) return;
    this._signalListenersAttached = true;

    process.on('SIGTERM', () => {
      void this.shutdown();
    });
    process.on('SIGINT', () => {
      void this.shutdown();
    });
  }

  /**
   * Detach signal listeners (for cleanup in tests).
   */
  private _detachSignalListeners(): void {
    if (!this._signalListenersAttached) return;
    this._signalListenersAttached = false;

    process.removeListener('SIGTERM', () => {
      void this.shutdown();
    });
    process.removeListener('SIGINT', () => {
      void this.shutdown();
    });
  }

  /**
   * Start the HTTP server for health/metrics endpoints.
   */
  private async _startHttpServer(port: number): Promise<void> {
    this._httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      void this._handleHttpRequest(req, res);
    });

    return new Promise<void>((resolve, reject) => {
      this._httpServer!.listen(port, () => {
        resolve();
      });
      this._httpServer!.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  /**
   * Handle incoming HTTP requests and route to appropriate handlers.
   */
  private async _handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    let statusCode = 200;
    let responseData: Record<string, unknown>;

    try {
      if (url === '/health') {
        const health = await this.getHealth();
        responseData = health as unknown as Record<string, unknown>;
        statusCode = health.status === 'healthy' ? 200 : 503;
      } else if (url === '/ready') {
        const ready = await this.getReady();
        responseData = ready as unknown as Record<string, unknown>;
        statusCode = ready.ready ? 200 : 503;
      } else if (url === '/metrics') {
        const metrics = await this.getMetrics();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(metrics);
        return;
      } else {
        statusCode = 404;
        responseData = { error: 'Not Found' };
      }
    } catch (err: unknown) {
      statusCode = 500;
      responseData = { error: err instanceof Error ? err.message : 'Internal Server Error' };
    }

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseData));
  }
}
