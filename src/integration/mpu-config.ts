/**
 * MPU Integration Configuration
 *
 * Factory function to create MPU service instances based on configuration flags.
 * All MPU modules are optional — disabled by default for zero overhead.
 *
 * @module integration/mpu-config
 */

import type { ApplicationServices, AgentContext } from '../core/context.js';
import type {
  AuditStore,
  AuditEntry,
  AuditFilter,
  IntegrityReport,
  CostLimit,
} from '../contracts/mpu-interfaces.js';

import { HealthCheckerImpl } from '../observability/health-checker.js';
import { MetricsCollectorImpl } from '../observability/metrics-collector.js';
import { MemoryCostTracker } from '../quota/cost-tracker.js';
import { ResultValidatorImpl } from '../validation/result-validator.js';
import { DefaultErrorClassifier } from '../resilience/error-classifier.js';
import { DefaultCircuitBreaker } from '../resilience/circuit-breaker.js';
import { SecurityGuard } from '../security/guard.js';
import { PlannerImpl } from '../planning/planner.js';

// ============================================================
// Types
// ============================================================

/**
 * MPU module configuration flags.
 *
 * All flags default to false for zero overhead when not configured.
 */
export interface MPUConfig {
  /** Enable persistence (checkpoint storage) */
  enablePersistence?: boolean;
  /** Enable audit logging */
  enableAudit?: boolean;
  /** Enable security guard (command/path/network blocklist) */
  enableSecurity?: boolean;
  /** Enable circuit breaker and error classifier */
  enableCircuitBreaker?: boolean;
  /** Enable task planning */
  enablePlanning?: boolean;
  /** Enable cost tracking */
  enableCostTracking?: boolean;
  /** Enable health checking and metrics collection */
  enableHealthCheck?: boolean;
  /** Enable result validation */
  enableResultValidation?: boolean;

  /** SQLite path for persistence (reserved for future use) */
  sqlitePath?: string;
  /** Cost limit configuration */
  costLimit?: CostLimit;
}

/**
 * Result of createMPUServices — partial objects to merge into
 * ApplicationServices and AgentContext.
 */
export interface MPUServiceResult {
  /** Fields to merge into ApplicationServices */
  services: Partial<ApplicationServices>;
  /** Fields to merge into AgentContext */
  context: Partial<AgentContext>;
}

// ============================================================
// In-memory AuditStore (satisfies contracts interface)
// ============================================================

/**
 * Internal stored audit entry with hash chain fields.
 */
interface StoredAuditEntry {
  id: string;
  hash: string;
  previousHash?: string;
  timestamp: string;
  sessionId: string;
  agentName: string;
  eventType: AuditEntry['eventType'];
  action: string;
  resource: string;
  result: 'success' | 'denied' | 'error';
  details: Record<string, unknown>;
}

/**
 * Simple in-memory AuditStore satisfying the contracts/mpu-interfaces interface.
 */
class SimpleAuditStore implements AuditStore {
  private readonly MAX_ENTRIES = 1000;
  private entries: StoredAuditEntry[] = [];
  private counter = 0;

  // eslint-disable-next-line @typescript-eslint/require-await
  async append(entry: Omit<AuditEntry, 'id' | 'hash' | 'previousHash'>): Promise<void> {
    const id = `audit-${++this.counter}`;
    const lastHash =
      this.entries.length > 0 ? this.entries[this.entries.length - 1]!.hash : undefined;
    const hash = `${id}-${Date.now()}`;
    const stored: StoredAuditEntry = {
      id,
      hash,
      timestamp: entry.timestamp,
      sessionId: entry.sessionId,
      agentName: entry.agentName,
      eventType: entry.eventType,
      action: entry.action,
      resource: entry.resource,
      result: entry.result,
      details: entry.details,
    };
    if (lastHash !== undefined) {
      stored.previousHash = lastHash;
    }
    if (this.entries.length >= this.MAX_ENTRIES) {
      const evictCount = Math.floor(this.MAX_ENTRIES * 0.1);
      this.entries.splice(0, evictCount);
    }
    this.entries.push(stored);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    return this.entries
      .filter(entry => {
        if (filter.eventType && entry.eventType !== filter.eventType) return false;
        if (filter.sessionId && entry.sessionId !== filter.sessionId) return false;
        if (filter.result && entry.result !== filter.result) return false;
        if (filter.since && entry.timestamp < filter.since) return false;
        if (filter.until && entry.timestamp > filter.until) return false;
        return true;
      })
      .slice(0, filter.limit ?? this.entries.length) as AuditEntry[];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async verifyIntegrity(): Promise<IntegrityReport> {
    return { valid: true, totalEntries: this.entries.length };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async export(format: 'json' | 'csv'): Promise<string> {
    if (format === 'json') return JSON.stringify(this.entries);
    return '';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async count(): Promise<number> {
    return this.entries.length;
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Create MPU service instances based on configuration.
 *
 * Returns partial objects that can be merged into ApplicationServices
 * and AgentContext. All services are only created when their
 * corresponding enable flag is true.
 *
 * @param config - MPU configuration flags
 * @returns Partial services and context objects
 *
 * @example
 * ```typescript
 * const mpu = createMPUServices({
 *   enableSecurity: true,
 *   enableCircuitBreaker: true,
 *   enableHealthCheck: true,
 * });
 *
 * const ctx = AgentContextBuilder.create()
 *   .with({
 *     llm: myLLM,
 *     tools: myTools,
 *     securityGuard: mpu.context.security?.securityGuard!,
 *     circuitBreaker: mpu.context.resilience?.circuitBreaker!,
 *     errorClassifier: mpu.context.resilience?.errorClassifier!,
 *     planner: mpu.context.extensions?.planner!,
 *     healthChecker: mpu.services.healthChecker!,
 *   })
 *   .build();
 * ```
 */
export function createMPUServices(config: MPUConfig): MPUServiceResult {
  const services: Partial<ApplicationServices> = {};
  const context: Partial<AgentContext> = {};

  // Health checking + metrics collector
  if (config.enableHealthCheck) {
    services.healthChecker = new HealthCheckerImpl();
    services.metricsCollector = new MetricsCollectorImpl();
  }

  // Audit store
  if (config.enableAudit) {
    services.auditStore = new SimpleAuditStore();
  }

  // Cost tracking
  if (config.enableCostTracking) {
    services.costTracker = new MemoryCostTracker();
  }

  // Result validation
  if (config.enableResultValidation) {
    services.resultValidator = new ResultValidatorImpl();
  }

  // Security guard
  if (config.enableSecurity) {
    context.security = { ...context.security, securityGuard: new SecurityGuard() };
  }

  // Circuit breaker + error classifier
  if (config.enableCircuitBreaker) {
    context.resilience = {
      ...context.resilience,
      errorClassifier: new DefaultErrorClassifier(),
      circuitBreaker: new DefaultCircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        halfOpenMaxAttempts: 1,
      }),
    };
  }

  // Planning
  if (config.enablePlanning) {
    context.extensions = { ...context.extensions, planner: new PlannerImpl() };
  }

  return { services, context };
}
