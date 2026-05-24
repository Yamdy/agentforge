import { describe, it, expect, vi } from 'vitest';
import type { WatchdogConfig, HealthCheck, HealthCheckOutcome } from '@primo-ai/sdk';
import { DegenerationWatchdog } from '../src/degeneration-watchdog.js';

function makeHealthyCheck(name: string): HealthCheck {
  return {
    name,
    level: 'L0',
    check: vi.fn(async () => ({ healthy: true, metrics: {} }) as HealthCheckOutcome),
  };
}

function makeFailingCheck(name: string, severity: 'warning' | 'critical' = 'critical'): HealthCheck {
  return {
    name,
    level: 'L0',
    check: vi.fn(async () => ({ healthy: false, reason: 'check failed', severity }) as HealthCheckOutcome),
  };
}

const defaultConfig: WatchdogConfig = {
  checkIntervalMs: 30000,
  degradationThreshold: 3,
  healthChecks: [],
  autoRollback: true,
  rollbackTarget: 'lastSnapshot',
};

describe('DegenerationWatchdog', () => {
  it('creates with default config', () => {
    const watchdog = new DegenerationWatchdog(defaultConfig);
    expect(watchdog.state.consecutiveFailures).toBe(0);
    expect(watchdog.state.totalRollbacks).toBe(0);
  });

  it('runs health checks and reports healthy', async () => {
    const checks = [makeHealthyCheck('check1'), makeHealthyCheck('check2')];
    const watchdog = new DegenerationWatchdog({ ...defaultConfig, healthChecks: checks });

    const results = await watchdog.runChecks();
    expect(results.every(r => r.healthy)).toBe(true);
    expect(watchdog.state.consecutiveFailures).toBe(0);
  });

  it('increments consecutive failures on unhealthy check', async () => {
    const checks = [makeFailingCheck('check1')];
    const watchdog = new DegenerationWatchdog({ ...defaultConfig, healthChecks: checks });

    await watchdog.runChecks();
    expect(watchdog.state.consecutiveFailures).toBe(1);
  });

  it('resets consecutive failures on healthy check', async () => {
    const failingCheck = makeFailingCheck('check1');
    const healthyCheck = makeHealthyCheck('check1');
    const checks = [failingCheck];
    const watchdog = new DegenerationWatchdog({ ...defaultConfig, healthChecks: checks });

    await watchdog.runChecks();
    expect(watchdog.state.consecutiveFailures).toBe(1);

    watchdog.updateChecks([healthyCheck]);
    await watchdog.runChecks();
    expect(watchdog.state.consecutiveFailures).toBe(0);
  });

  it('emits degradation event when threshold reached', async () => {
    const checks = [makeFailingCheck('check1')];
    const events: string[] = [];
    const watchdog = new DegenerationWatchdog({
      ...defaultConfig,
      healthChecks: checks,
      degradationThreshold: 2,
      onEvent: (event) => events.push(event),
    });

    await watchdog.runChecks();
    await watchdog.runChecks();
    expect(events).toContain('watchdog:degradation-detected');
  });

  it('auto-rolls back when degradation threshold reached', async () => {
    const rollbackFn = vi.fn();
    const checks = [makeFailingCheck('check1')];
    const watchdog = new DegenerationWatchdog({
      ...defaultConfig,
      healthChecks: checks,
      degradationThreshold: 2,
      autoRollback: true,
      onRollback: rollbackFn,
    });

    await watchdog.runChecks();
    await watchdog.runChecks();
    expect(rollbackFn).toHaveBeenCalled();
    expect(watchdog.state.totalRollbacks).toBe(1);
  });

  it('does not auto-rollback when autoRollback is false', async () => {
    const rollbackFn = vi.fn();
    const checks = [makeFailingCheck('check1')];
    const events: string[] = [];
    const watchdog = new DegenerationWatchdog({
      ...defaultConfig,
      healthChecks: checks,
      degradationThreshold: 2,
      autoRollback: false,
      onRollback: rollbackFn,
      onEvent: (event) => events.push(event),
    });

    await watchdog.runChecks();
    await watchdog.runChecks();
    expect(rollbackFn).not.toHaveBeenCalled();
    expect(events).toContain('watchdog:rollback-required');
  });

  it('supports L0/L1/L2 check levels', async () => {
    const l0Check: HealthCheck = { name: 'l0', level: 'L0', check: async () => ({ healthy: true }) };
    const l1Check: HealthCheck = { name: 'l1', level: 'L1', check: async () => ({ healthy: true }) };
    const l2Check: HealthCheck = { name: 'l2', level: 'L2', check: async () => ({ healthy: true }) };

    const watchdog = new DegenerationWatchdog({
      ...defaultConfig,
      healthChecks: [l0Check, l1Check, l2Check],
    });

    const results = await watchdog.runChecks();
    expect(results.length).toBe(3);
  });

  it('updates lastCheckTime after each run', async () => {
    const watchdog = new DegenerationWatchdog(defaultConfig);
    const before = watchdog.state.lastCheckTime;

    await watchdog.runChecks();

    expect(watchdog.state.lastCheckTime).not.toBe(before);
  });
});
