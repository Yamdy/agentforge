/**
 * Graceful Shutdown Manager
 *
 * Executes registered cleanup functions in order with timeout support.
 * When timeout is exceeded, remaining cleanups are abandoned.
 *
 * @module
 */

/**
 * Result of a shutdown operation
 */
export interface ShutdownResult {
  /** Whether all cleanups completed successfully */
  success: boolean;
  /** Names of cleanups that completed */
  completedCleanups: string[];
  /** Names of cleanups that failed or timed out */
  failedCleanups: string[];
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Cleanup handler function
 */
type CleanupHandler = () => Promise<void>;

/**
 * Graceful shutdown manager.
 *
 * Registers cleanup functions that run in order during shutdown.
 * Supports timeout-based forced exit.
 *
 * @example
 * ```typescript
 * const shutdown = new GracefulShutdown();
 *
 * shutdown.registerCleanup('close-db', async () => {
 *   await db.close();
 * });
 *
 * shutdown.registerCleanup('flush-logs', async () => {
 *   await logger.flush();
 * });
 *
 * // Later, trigger shutdown
 * const result = await shutdown.shutdown(5000);
 * if (!result.success) {
 *   console.error('Some cleanups failed:', result.failedCleanups);
 * }
 * ```
 */
export class GracefulShutdown {
  private readonly cleanups: Map<string, CleanupHandler> = new Map();
  private readonly callbacks: Array<() => void> = [];
  private _isShuttingDown = false;

  /**
   * Register a cleanup function.
   *
   * @param name - Unique name for this cleanup
   * @param handler - Async cleanup function
   * @throws Error if name is already registered
   */
  registerCleanup(name: string, handler: CleanupHandler): void {
    if (this.cleanups.has(name)) {
      throw new Error(`Cleanup "${name}" is already registered`);
    }
    this.cleanups.set(name, handler);
  }

  /**
   * Execute all registered cleanups in order.
   *
   * Each cleanup runs sequentially. If a cleanup fails, it's recorded
   * but execution continues. If total time exceeds timeoutMs,
   * remaining cleanups are abandoned.
   *
   * @param timeoutMs - Maximum time in milliseconds for all cleanups
   * @returns Shutdown result with success/failure details
   */
  async shutdown(timeoutMs: number): Promise<ShutdownResult> {
    this._isShuttingDown = true;
    const startTime = Date.now();

    // Notify callbacks
    for (const cb of this.callbacks) {
      try {
        cb();
      } catch {
        // Callback errors are ignored
      }
    }

    const completedCleanups: string[] = [];
    const failedCleanups: string[] = [];

    for (const [name, handler] of this.cleanups) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        // Timeout reached — mark remaining as failed
        failedCleanups.push(name);
        for (const [remainingName] of this.cleanups) {
          if (
            !completedCleanups.includes(remainingName) &&
            !failedCleanups.includes(remainingName)
          ) {
            failedCleanups.push(remainingName);
          }
        }
        break;
      }

      try {
        // Run cleanup with remaining time
        const remainingMs = timeoutMs - elapsed;
        await Promise.race([
          handler(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Cleanup timeout')), remainingMs)
          ),
        ]);
        completedCleanups.push(name);
      } catch {
        failedCleanups.push(name);
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      success: failedCleanups.length === 0,
      completedCleanups,
      failedCleanups,
      durationMs,
    };
  }

  /**
   * Check if shutdown is in progress.
   */
  isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  /**
   * Register a callback to be called when shutdown starts.
   *
   * @param callback - Function to call on shutdown
   */
  onShutdown(callback: () => void): void {
    this.callbacks.push(callback);
  }
}
