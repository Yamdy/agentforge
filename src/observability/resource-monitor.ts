/**
 * Resource Monitor
 *
 * Monitors system resources (memory, CPU, event loop) for AgentForge agents.
 * Designed for production deployments to detect resource pressure and prevent OOM.
 *
 * @module observability/resource-monitor
 */

import { monitorEventLoopDelay } from 'perf_hooks';

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
  /** Event loop delay (ms, Node.js only) — average over sampling window */
  readonly eventLoopDelay?: number;
  /** Event loop delay minimum (ms, Node.js only) */
  readonly eventLoopDelayMin?: number;
  /** Event loop delay maximum (ms, Node.js only) */
  readonly eventLoopDelayMax?: number;
  /** Event loop delay 99th percentile (ms, Node.js only) */
  readonly eventLoopDelayP99?: number;
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
 * // Subscribe to metrics stream via callback
 * const unsub = monitor.onMetrics(metrics => {
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
 *
 * // Later: unsub();
 * ```
 */
export class ResourceMonitor {
  private readonly _options: Required<ResourceMonitorOptions>;
  private _lastCpuUsage: NodeJS.CpuUsage | undefined;
  private _eldHistogram?: ReturnType<typeof monitorEventLoopDelay>;

  constructor(options: ResourceMonitorOptions = {}) {
    this._options = {
      intervalMs: options.intervalMs ?? 10000,
      memoryWarningThreshold: options.memoryWarningThreshold ?? 0.8,
      memoryCriticalThreshold: options.memoryCriticalThreshold ?? 0.95,
      enableCpu: options.enableCpu ?? true,
      enableEventLoop: options.enableEventLoop ?? true,
    };

    if (this._options.enableEventLoop) {
      this._eldHistogram = monitorEventLoopDelay({ resolution: 20 });
      this._eldHistogram.enable();
    }
  }

  /**
   * Subscribe to resource metrics via callback.
   * Returns an unsubscribe function.
   */
  onMetrics(listener: (metrics: ResourceMetrics) => void): () => void {
    const timer = setInterval(() => {
      try {
        listener(this.collect());
      } catch (err) {
        console.warn('[ResourceMonitor] Metrics listener error:', err);
      }
    }, this._options.intervalMs);
    return () => clearInterval(timer);
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

    // Event loop delay (Node.js) — via perf_hooks histogram
    const eldHistogram = this._eldHistogram;

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
      ...(cpu !== undefined && { cpu }),
      ...(eldHistogram && {
        eventLoopDelay: this.measureEventLoopDelay(),
        eventLoopDelayMin: Number(eldHistogram.min) / 1e6,
        eventLoopDelayMax: Number(eldHistogram.max) / 1e6,
        eventLoopDelayP99: Number(eldHistogram.percentile(99)) / 1e6,
      }),
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
   * Measure event loop delay (mean over sampling window, in ms)
   *
   * Uses the perf_hooks event loop delay histogram for accurate,
   * statistically meaningful measurements — no back-to-back hrtime snapshots.
   */
  private measureEventLoopDelay(): number {
    if (!this._eldHistogram) return 0;
    return Number(this._eldHistogram.mean) / 1e6; // Convert ns → ms
  }
}
