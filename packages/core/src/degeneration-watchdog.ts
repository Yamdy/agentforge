import type { WatchdogConfig, HealthCheck, HealthCheckOutcome, WatchdogState } from '@primo-ai/sdk';

export interface WatchdogOptions extends WatchdogConfig {
  onEvent?: (event: string) => void;
  onRollback?: () => void;
}

export class DegenerationWatchdog {
  private config: WatchdogOptions;
  private _state: WatchdogState;
  private _checks: HealthCheck[];

  constructor(config: WatchdogOptions) {
    this.config = config;
    this._checks = [...config.healthChecks];
    this._state = {
      consecutiveFailures: 0,
      lastHealthySnapshot: '',
      lastCheckTime: '',
      totalRollbacks: 0,
    };
  }

  get state(): WatchdogState {
    return this._state;
  }

  updateChecks(checks: HealthCheck[]): void {
    this._checks = [...checks];
  }

  async runChecks(): Promise<HealthCheckOutcome[]> {
    const results: HealthCheckOutcome[] = [];
    let allHealthy = true;

    for (const check of this._checks) {
      const result = await check.check();
      results.push(result);
      if (!result.healthy) {
        allHealthy = false;
      }
    }

    this._state.lastCheckTime = new Date().toISOString();

    if (allHealthy) {
      this._state.consecutiveFailures = 0;
    } else {
      this._state.consecutiveFailures++;

      if (this._state.consecutiveFailures >= this.config.degradationThreshold) {
        this.config.onEvent?.('watchdog:degradation-detected');

        if (this.config.autoRollback) {
          this.config.onRollback?.();
          this._state.totalRollbacks++;
          this.config.onEvent?.('watchdog:rollback-executed');
        } else {
          this.config.onEvent?.('watchdog:rollback-required');
        }
      }
    }

    return results;
  }
}
