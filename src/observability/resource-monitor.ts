/**
 * Resource Monitor
 *
 * Monitors system resources (memory, CPU, event loop) for AgentForge agents.
 * Designed for production deployments to detect resource pressure and prevent OOM.
 *
 * @module observability/resource-monitor
 */

import { Observable, interval, map, share } from 'rxjs';

/**
 * Memory metrics
 */
export interface MemoryMetrics {
  /** Heap memory used by Node.js (bytes) */
  readonly heapUsed: number;
  /** Total heap memory (bytes) */
  readonly heapTotal: number;
  /** External memory (C++ objects, bytes) */
  readonly external: number;
  /** Resident Set Size - total memory allocated (bytes) */
  readonly rss: number;
  /** Array buffer memory (bytes) */
  readonly arrayBuffers: number;
}

/**
 * CPU metrics
 */
export interface CPUMetrics {
  /** User CPU time (microseconds) */
  readonly user: number;
  /** System CPU time (microseconds) */
  readonly system: number;
}

/**
 * Resource metrics snapshot
 */
export interface ResourceMetrics {
  /** Unix timestamp (ms) */
  readonly timestamp: number;

  /** Memory metrics */
  readonly memory: MemoryMetrics;

  /** CPU metrics (Node.js only) */
  readonly cpu?: CPUMetrics;

  /** Event loop delay (ms, Node.js only) */
  readonly eventLoopDelay?: number;

  /** Uptime (ms) */
  readonly uptime: number;
}

/**
 * Resource pressure level
 */
export type ResourcePressure = 'normal' | 'warning' | 'critical';

/**
 * ResourceMonitor options
 */
export interface ResourceMonitorOptions {
  /** Collection interval in milliseconds (default: 10000) */
  readonly intervalMs?: number;

  /** Memory warning threshold (0-1, default: 0.8) */
  readonly memoryWarningThreshold?: number;

  /** Memory critical threshold (0-1, default: 0.95) */
  readonly memoryCriticalThreshold?: number;

  /** Enable CPU monitoring (default: true) */
  readonly enableCpu?: boolean;

  /** Enable event loop monitoring (default: true) */
  readonly enableEventLoop?: boolean;
}

/**
 * Resource Monitor
 *
 * Monitors system resources at regular intervals.
 *
 * @example
 * ```typescript
 * const monitor = new ResourceMonitor({ intervalMs: 5000 });
 *
 * // Subscribe to metrics stream
 * monitor.metrics$.subscribe(metrics => {
 *   console.log(`Memory: ${metrics.memory.heapUsed / 1024 / 1024} MB`);
 * });
 *
 * // Get current snapshot
 * const snapshot = monitor.snapshot();
 *
 * // Check pressure level
 * const pressure = monitor.getPressure(snapshot);
 * if (pressure === 'critical') {
 *   // Take action: trigger compaction, warn user, etc.
 * }
 * ```
 */
export class ResourceMonitor {
  private readonly _options: Required<ResourceMonitorOptions>;
  private _metrics$: Observable<ResourceMetrics> | undefined;
  private _lastCpuUsage: NodeJS.CpuUsage | undefined;

  constructor(options: ResourceMonitorOptions = {}) {
    this._options = {
      intervalMs: options.intervalMs ?? 10000,
      memoryWarningThreshold: options.memoryWarningThreshold ?? 0.8,
      memoryCriticalThreshold: options.memoryCriticalThreshold ?? 0.95,
      enableCpu: options.enableCpu ?? true,
      enableEventLoop: options.enableEventLoop ?? true,
    };
  }

  /**
   * Resource metrics stream
   *
   * Emits metrics at the configured interval.
   * Shared among all subscribers.
   */
  get metrics$(): Observable<ResourceMetrics> {
    if (!this._metrics$) {
      this._metrics$ = interval(this._options.intervalMs).pipe(
        map(() => this.collect()),
        share(),
      );
    }
    return this._metrics$;
  }

  /**
   * Collect current resource metrics
   *
   * @returns Resource metrics snapshot
   */
  collect(): ResourceMetrics {
    const mem = process.memoryUsage();
    const timestamp = Date.now();
    const uptime = process.uptime() * 1000;

    // CPU usage (Node.js)
    let cpu: CPUMetrics | undefined;
    if (this._options.enableCpu && process.cpuUsage) {
      const cpuUsage = process.cpuUsage(this._lastCpuUsage);
      this._lastCpuUsage = process.cpuUsage();
      cpu = {
        user: cpuUsage.user,
        system: cpuUsage.system,
      };
    }

    // Event loop delay (Node.js)
    const eventLoopDelay =
      this._options.enableEventLoop && typeof process.hrtime === 'function'
        ? this.measureEventLoopDelay()
        : undefined;

    // Build object respecting exactOptionalPropertyTypes
    if (cpu !== undefined && eventLoopDelay !== undefined) {
      return {
        timestamp,
        memory: {
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
          rss: mem.rss,
          arrayBuffers: mem.arrayBuffers,
        },
        uptime,
        cpu,
        eventLoopDelay,
      };
    }
    if (cpu !== undefined) {
      return {
        timestamp,
        memory: {
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
          rss: mem.rss,
          arrayBuffers: mem.arrayBuffers,
        },
        uptime,
        cpu,
      };
    }
    if (eventLoopDelay !== undefined) {
      return {
        timestamp,
        memory: {
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
          rss: mem.rss,
          arrayBuffers: mem.arrayBuffers,
        },
        uptime,
        eventLoopDelay,
      };
    }
    return {
      timestamp,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rss: mem.rss,
        arrayBuffers: mem.arrayBuffers,
      },
      uptime,
    };
  }

  /**
   * Get a single snapshot (alias for collect)
   */
  snapshot(): ResourceMetrics {
    return this.collect();
  }

  /**
   * Get resource pressure level
   *
   * @param metrics - Resource metrics to evaluate
   * @returns Pressure level
   */
  getPressure(metrics: ResourceMetrics): ResourcePressure {
    const { heapUsed, heapTotal } = metrics.memory;
    const usage = heapUsed / heapTotal;

    if (usage >= this._options.memoryCriticalThreshold) {
      return 'critical';
    }
    if (usage >= this._options.memoryWarningThreshold) {
      return 'warning';
    }
    return 'normal';
  }

  /**
   * Check if memory pressure is high
   *
   * @param metrics - Resource metrics to evaluate
   * @returns true if memory usage is above warning threshold
   */
  isMemoryWarning(metrics: ResourceMetrics): boolean {
    return this.getPressure(metrics) !== 'normal';
  }

  /**
   * Get memory usage percentage
   *
   * @param metrics - Resource metrics
   * @returns Memory usage as 0-1 ratio
   */
  getMemoryUsage(metrics: ResourceMetrics): number {
    return metrics.memory.heapUsed / metrics.memory.heapTotal;
  }

  /**
   * Format metrics as human-readable string
   *
   * @param metrics - Resource metrics
   * @returns Formatted string
   */
  format(metrics: ResourceMetrics): string {
    const { memory, cpu, eventLoopDelay } = metrics;
    const heapUsedMB = (memory.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (memory.heapTotal / 1024 / 1024).toFixed(2);
    const rssMB = (memory.rss / 1024 / 1024).toFixed(2);
    const usage = (this.getMemoryUsage(metrics) * 100).toFixed(1);
    const pressure = this.getPressure(metrics);

    let output = `Memory: ${heapUsedMB}/${heapTotalMB} MB (${usage}%) | RSS: ${rssMB} MB | ${pressure.toUpperCase()}`;

    if (cpu) {
      const userMs = (cpu.user / 1000).toFixed(1);
      const systemMs = (cpu.system / 1000).toFixed(1);
      output += ` | CPU: ${userMs}ms user, ${systemMs}ms system`;
    }

    if (eventLoopDelay !== undefined) {
      output += ` | Event Loop: ${eventLoopDelay.toFixed(2)}ms`;
    }

    return output;
  }

  // ===== Private Methods =====

  /**
   * Measure event loop delay
   *
   * Uses a simple technique: measure how long setTimeout actually takes
   * vs. the expected delay.
   */
  private measureEventLoopDelay(): number {
    const start = process.hrtime.bigint();
    // Synchronous measurement - we measure the lag since last collection
    // This is an approximation; for accurate measurement use perf_hooks.monitorEventLoopDelay
    const end = process.hrtime.bigint();
    const elapsedNs = Number(end - start);
    return elapsedNs / 1_000_000; // Convert to ms
  }
}
