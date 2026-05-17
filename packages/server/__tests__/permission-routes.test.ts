import { describe, it, expect, vi } from 'vitest';
import { permissionRoutes } from '../src/routes/permissions.js';
import type { PermissionManager, PendingPermission } from '@primo-ai/core';

function createMockPermissionManager(overrides?: Partial<PermissionManager>): PermissionManager {
  return {
    list: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(undefined),
    resolve: vi.fn(),
    awaitDecision: vi.fn(),
    getBySession: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as PermissionManager;
}

describe('permissionRoutes', () => {
  describe('GET /pending', () => {
    it('returns empty array when no permission manager', async () => {
      const app = permissionRoutes(undefined);
      const res = await app.request('/pending');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('returns empty array when no pending permissions', async () => {
      const pm = createMockPermissionManager();
      const app = permissionRoutes(pm);
      const res = await app.request('/pending');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('returns pending permissions from manager', async () => {
      const pending: PendingPermission[] = [
        {
          permissionId: 'perm-1',
          sessionId: 'sess-1',
          toolName: 'shell',
          args: { command: 'rm -rf /' },
          reason: 'Dangerous command',
          createdAt: new Date().toISOString(),
        },
      ];
      const pm = createMockPermissionManager({ list: vi.fn().mockReturnValue(pending) });
      const app = permissionRoutes(pm);
      const res = await app.request('/pending');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(pending);
    });
  });

  describe('GET /pending/:permissionId', () => {
    it('returns 404 when no permission manager', async () => {
      const app = permissionRoutes(undefined);
      const res = await app.request('/pending/perm-1');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it('returns 404 when permission not found', async () => {
      const pm = createMockPermissionManager({ get: vi.fn().mockReturnValue(undefined) });
      const app = permissionRoutes(pm);
      const res = await app.request('/pending/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Permission not found');
    });

    it('returns permission detail when found', async () => {
      const permission: PendingPermission = {
        permissionId: 'perm-1',
        sessionId: 'sess-1',
        toolName: 'shell',
        args: { command: 'ls' },
        reason: 'List files',
        createdAt: new Date().toISOString(),
      };
      const pm = createMockPermissionManager({ get: vi.fn().mockReturnValue(permission) });
      const app = permissionRoutes(pm);
      const res = await app.request('/pending/perm-1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(permission);
    });
  });

  describe('POST /pending/:permissionId/respond', () => {
    it('returns 404 when no permission manager', async () => {
      const app = permissionRoutes(undefined);
      const res = await app.request('/pending/perm-1/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when body is missing approved field', async () => {
      const pm = createMockPermissionManager();
      const app = permissionRoutes(pm);
      const res = await app.request('/pending/perm-1/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('approved');
    });

    it('returns 400 when approved is not boolean', async () => {
      const pm = createMockPermissionManager();
      const app = permissionRoutes(pm);
      const res = await app.request('/pending/perm-1/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: 'yes' }),
      });
      expect(res.status).toBe(400);
    });

    it('approves a permission and returns resolved', async () => {
      const pm = createMockPermissionManager({ resolve: vi.fn() });
      const app = permissionRoutes(pm);
      const res = await app.request('/pending/perm-1/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resolved).toBe(true);
      expect(body.permissionId).toBe('perm-1');
      expect(body.decision).toBe('allow');
      expect(pm.resolve).toHaveBeenCalledWith('perm-1', true);
    });

    it('denies a permission and returns resolved', async () => {
      const pm = createMockPermissionManager({ resolve: vi.fn() });
      const app = permissionRoutes(pm);
      const res = await app.request('/pending/perm-1/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resolved).toBe(true);
      expect(body.permissionId).toBe('perm-1');
      expect(body.decision).toBe('deny');
      expect(pm.resolve).toHaveBeenCalledWith('perm-1', false);
    });

    it('returns 404 when resolve throws (permission not found)', async () => {
      const pm = createMockPermissionManager({
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Permission not found: gone');
        }),
      });
      const app = permissionRoutes(pm);
      const res = await app.request('/pending/gone/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not found');
    });
  });
});
