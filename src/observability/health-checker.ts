/**
 * Health Checker
 *
 * Production-ready health checking for AgentForge agents.
 * Supports component registration, concurrent checks, and
 * status aggregation (worst-of semantics).
 *
 * @module observability/health-checker
 */

import type {
  HealthChecker,
  HealthStatus,
  ReadinessStatus,
  ComponentHealth,
} from '../contracts/mpu-interfaces.js';

/**
 * HealthChecker constructor options
 */
export interface HealthCheckerOptions {
  /** Application version string (default: '0.0.0') */
  readonly version?: string;
}

/**
 * Concrete implementation of the HealthChecker interface.
 *
 * - Registers named component checks
 * - Runs all checks concurrently
 * - Aggregates status using worst-of semantics: unhealthy > degraded > healthy
 * - Measures per-check latency
 * - Handles check failures gracefully (marks as unhealthy)
 *
 * @example
 * ```typescript
 * const checker = new HealthCheckerImpl({ version: '1.2.0' });
 *
 * checker.registerCheck('database', async () => {
 *   const start = Date.now();
 *   await db.ping();
 *   return { name: 'database', status: 'healthy', latencyMs: Date.now() - start };
 * });
 *
 * const health = await checker.check();
 * // { status: 'healthy', version: '1.2.0', uptime: ..., checks: [...] }
 * ```
 */
export class HealthCheckerImpl implements HealthChecker {
  private readonly _version: string;
  private readonly _startTime: number;
  private readonly _checks: Map<string, () => Promise<ComponentHealth>> = new Map();

  constructor(options: HealthCheckerOptions = {}) {
    this._version = options.version ?? '0.0.0';
    this._startTime = Date.now();
  }

  /**
   * Register a named health check.
   *
   * If a check with the same name already exists, it is overwritten.
   */
  registerCheck(name: string, checker: () => Promise<ComponentHealth>): void {
    this._checks.set(name, checker);
  }

  /**
   * Run all registered checks concurrently and return aggregated health.
   *
   * Status derivation (worst-of):
   * - Any check unhealthy → overall unhealthy
   * - Any check degraded (and none unhealthy) → overall degraded
   * - All checks healthy (or no checks) → overall healthy
   */
  async check(): Promise<HealthStatus> {
    const results = await this._runAllChecks();
    const status = this._deriveStatus(results);

    return {
      status,
      version: this._version,
      uptime: (Date.now() - this._startTime) / 1000,
      checks: results,
    };
  }

  /**
   * Check readiness.
   *
   * Ready = all registered checks are healthy.
   * Returns reasons for any failing checks.
   */
  async ready(): Promise<ReadinessStatus> {
    if (this._checks.size === 0) {
      return { ready: true };
    }

    const results = await this._runAllChecks();
    const reasons: string[] = [];

    for (const component of results) {
      if (component.status !== 'healthy') {
        const msg = component.message
          ? `${component.name}: ${component.message}`
          : `${component.name}: ${component.status}`;
        reasons.push(msg);
      }
    }

    if (reasons.length === 0) {
      return { ready: true };
    }

    return { ready: false, reasons };
  }

  // ===== Private Methods =====

  /**
   * Run all registered checks concurrently, measuring latency.
   * Failed checks are converted to unhealthy ComponentHealth.
   */
  private async _runAllChecks(): Promise<ComponentHealth[]> {
    const entries = Array.from(this._checks.entries());

    const results = await Promise.all(
      entries.map(async ([name, checker]) => {
        const start = Date.now();
        try {
          const result = await checker();
          return {
            ...result,
            latencyMs: Date.now() - start,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            name,
            status: 'unhealthy' as const,
            message,
            latencyMs: Date.now() - start,
          };
        }
      })
    );

    return results;
  }

  /**
   * Derive overall status from component results.
   * Worst-of semantics: unhealthy > degraded > healthy.
   */
  private _deriveStatus(results: ComponentHealth[]): 'healthy' | 'degraded' | 'unhealthy' {
    if (results.length === 0) return 'healthy';

    let hasDegraded = false;
    for (const r of results) {
      if (r.status === 'unhealthy') return 'unhealthy';
      if (r.status === 'degraded') hasDegraded = true;
    }

    return hasDegraded ? 'degraded' : 'healthy';
  }
}
