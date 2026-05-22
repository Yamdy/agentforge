import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../src/pending-permission.js';
import type { PendingPermission } from '../src/pending-permission.js';
import { EventBus } from '../src/event-bus.js';

function makePermission(overrides?: Partial<PendingPermission>): PendingPermission {
  return {
    permissionId: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: 'session-1',
    toolName: 'shell',
    args: { command: 'rm -rf /tmp/test' },
    reason: "Tool 'shell' requires approval (ask rule)",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PermissionManager', () => {
  it('awaitDecision() creates a pending entry and returns a Promise', () => {
    const manager = new PermissionManager();
    const permission = makePermission();
    const promise = manager.awaitDecision(permission);
    expect(promise).toBeInstanceOf(Promise);
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0].permissionId).toBe(permission.permissionId);
  });

  it('resolve(approved: true) resolves the promise with true', async () => {
    const manager = new PermissionManager();
    const permission = makePermission();
    const promise = manager.awaitDecision(permission);
    manager.resolve(permission.permissionId, true);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('resolve(approved: false) resolves the promise with false', async () => {
    const manager = new PermissionManager();
    const permission = makePermission();
    const promise = manager.awaitDecision(permission);
    manager.resolve(permission.permissionId, false);
    const result = await promise;
    expect(result).toBe(false);
  });

  it('resolve() removes the entry from pending list', () => {
    const manager = new PermissionManager();
    const permission = makePermission();
    manager.awaitDecision(permission);
    expect(manager.list()).toHaveLength(1);
    manager.resolve(permission.permissionId, true);
    expect(manager.list()).toHaveLength(0);
  });

  it('list() returns all pending permissions', () => {
    const manager = new PermissionManager();
    const p1 = makePermission({ permissionId: 'perm-1' });
    const p2 = makePermission({ permissionId: 'perm-2' });
    const p3 = makePermission({ permissionId: 'perm-3' });
    manager.awaitDecision(p1);
    manager.awaitDecision(p2);
    manager.awaitDecision(p3);
    const all = manager.list();
    expect(all).toHaveLength(3);
    expect(all.map(p => p.permissionId)).toEqual(['perm-1', 'perm-2', 'perm-3']);
  });

  it('getBySession() filters by sessionId', () => {
    const manager = new PermissionManager();
    const p1 = makePermission({ permissionId: 'perm-1', sessionId: 'session-a' });
    const p2 = makePermission({ permissionId: 'perm-2', sessionId: 'session-b' });
    const p3 = makePermission({ permissionId: 'perm-3', sessionId: 'session-a' });
    manager.awaitDecision(p1);
    manager.awaitDecision(p2);
    manager.awaitDecision(p3);
    const forA = manager.getBySession('session-a');
    expect(forA).toHaveLength(2);
    expect(forA.map(p => p.permissionId)).toEqual(['perm-1', 'perm-3']);
  });

  it('get() returns single permission by ID', () => {
    const manager = new PermissionManager();
    const permission = makePermission({ permissionId: 'perm-42' });
    manager.awaitDecision(permission);
    const found = manager.get('perm-42');
    expect(found).toBeDefined();
    expect(found!.permissionId).toBe('perm-42');
  });

  it('get() returns undefined for non-existent permissionId', () => {
    const manager = new PermissionManager();
    expect(manager.get('does-not-exist')).toBeUndefined();
  });

  it('resolve() for unknown id caches decision (no longer throws)', () => {
    const manager = new PermissionManager();
    expect(() => manager.resolve('non-existent-id', true)).not.toThrow();
  });

  it('multiple concurrent permissions each resolve independently', async () => {
    const manager = new PermissionManager();
    const p1 = makePermission({ permissionId: 'perm-x' });
    const p2 = makePermission({ permissionId: 'perm-y' });
    const p3 = makePermission({ permissionId: 'perm-z' });
    const promise1 = manager.awaitDecision(p1);
    const promise2 = manager.awaitDecision(p2);
    const promise3 = manager.awaitDecision(p3);
    manager.resolve('perm-y', false);
    manager.resolve('perm-x', true);
    manager.resolve('perm-z', true);
    const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);
    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(r3).toBe(true);
    expect(manager.list()).toHaveLength(0);
  });

  // ── Persistence (with EventBus) ─────────────────────────

  describe('with EventBus (persistence)', () => {
    it('backward compatible: works without eventBus', async () => {
      const manager = new PermissionManager();
      const p = makePermission({ permissionId: 'bc-1' });
      const promise = manager.awaitDecision(p);
      manager.resolve('bc-1', true);
      expect(await promise).toBe(true);
    });

    it('awaitDecision emits permission:requested', () => {
      const bus = new EventBus();
      const events: Record<string, unknown>[] = [];
      bus.subscribe('permission:requested', (data) => events.push(data as Record<string, unknown>));
      const manager = new PermissionManager({ eventBus: bus, sessionId: 's1' });
      const p = makePermission({ permissionId: 'req-1' });
      manager.awaitDecision(p);
      expect(events).toHaveLength(1);
      expect(events[0].permissionId).toBe('req-1');
    });

    it('resolve emits permission:decided', () => {
      const bus = new EventBus();
      const events: Record<string, unknown>[] = [];
      bus.subscribe('permission:decided', (data) => events.push(data as Record<string, unknown>));
      const manager = new PermissionManager({ eventBus: bus, sessionId: 's1' });
      const p = makePermission({ permissionId: 'dec-1' });
      manager.awaitDecision(p);
      manager.resolve('dec-1', false);
      expect(events).toHaveLength(1);
      expect(events[0].permissionId).toBe('dec-1');
      expect(events[0].approved).toBe(false);
    });

    it('applyDecision resolves pending promise', async () => {
      const manager = new PermissionManager();
      const p = makePermission({ permissionId: 'ad-1' });
      const promise = manager.awaitDecision(p);
      manager.applyDecision('ad-1', false);
      expect(await promise).toBe(false);
      expect(manager.list()).toHaveLength(0);
    });

    it('applyDecision caches when no pending entry', () => {
      const manager = new PermissionManager();
      expect(() => manager.applyDecision('cached-1', true)).not.toThrow();
    });

    it('awaitDecision returns cached decision immediately', async () => {
      const pm = new PermissionManager();
      pm.applyDecision('cached-2', true);
      const p = makePermission({ permissionId: 'cached-2' });
      const result = await pm.awaitDecision(p);
      expect(result).toBe(true);
      expect(pm.list()).toHaveLength(0);
    });

    it('resolve for unknown id succeeds when eventBus provided', () => {
      const bus = new EventBus();
      const pm = new PermissionManager({ eventBus: bus, sessionId: 's1' });
      expect(() => pm.resolve('new-id', true)).not.toThrow();
    });

    it('events not emitted without eventBus', () => {
      const manager = new PermissionManager();
      const p = makePermission({ permissionId: 'no-evt' });
      manager.awaitDecision(p);
      manager.resolve('no-evt', true);
    });
  });
});
