import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { selfModificationRoutes } from '../src/routes/studio/self-modification.js';
import { AgentRegistry } from '../src/registry.js';
import { Agent } from '@primo-ai/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApp(): { app: Hono; registry: AgentRegistry } {
  const registry = new AgentRegistry();
  const app = new Hono();
  app.route('/api/studio/self-modification', selfModificationRoutes({ registry }));
  return { app, registry };
}

function registerAgent(registry: AgentRegistry, id = 'test-agent'): Agent {
  return registry.register(id, {
    model: 'test-model',
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Self-modification audit API routes', () => {
  // -----------------------------------------------------------------------
  // GET / — list agents with self-modification capability
  // -----------------------------------------------------------------------
  describe('GET /', () => {
    it('returns empty list when no agents registered', async () => {
      const { app } = createApp();
      const res = await app.request('/api/studio/self-modification');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agents).toEqual([]);
    });

    it('lists registered agents with hasEngine flag', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agents).toHaveLength(1);
      expect(body.agents[0].id).toBe('test-agent');
      expect(body.agents[0].hasEngine).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // GET /:agentId/constitution
  // -----------------------------------------------------------------------
  describe('GET /:agentId/constitution', () => {
    it('returns 404 for unknown agent', async () => {
      const { app } = createApp();
      const res = await app.request('/api/studio/self-modification/unknown/constitution');
      expect(res.status).toBe(404);
    });

    it('returns constitution data for registered agent', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification/test-agent/constitution');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.version).toBe(1);
      expect(Array.isArray(body.protectedPaths)).toBe(true);
      expect(body.protectedPaths.length).toBeGreaterThan(0);
      expect(body.diffLimits).toBeDefined();
      expect(body.approvalMatrix).toBeDefined();
      expect(body.approvalMatrix.L0).toBeDefined();
      expect(body.approvalMatrix.L4.mode).toBe('always_reject');
    });

    it('includes protected path details', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification/test-agent/constitution');
      const body = await res.json();
      const sdkPath = body.protectedPaths.find((p: { pattern: string }) =>
        p.pattern.includes('sdk/src'),
      );
      expect(sdkPath).toBeDefined();
      expect(sdkPath.level).toBe('absolute');
    });
  });

  // -----------------------------------------------------------------------
  // POST /:agentId/verify
  // -----------------------------------------------------------------------
  describe('POST /:agentId/verify', () => {
    it('returns 404 for unknown agent', async () => {
      const { app } = createApp();
      const res = await app.request('/api/studio/self-modification/unknown/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diff: [{ path: 'safe/file.ts', content: 'ok' }] }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 for missing diff', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification/test-agent/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification/test-agent/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('passes verification for safe diff', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification/test-agent/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diff: [{ path: 'safe/file.ts', content: 'console.log("ok")' }] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overall).toBe('passed');
      expect(Array.isArray(body.gates)).toBe(true);
      expect(body.gates.length).toBeGreaterThan(0);
      expect(body.timestamp).toBeDefined();
    });

    it('fails verification for protected path', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification/test-agent/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diff: [{ path: 'packages/sdk/src/index.ts', content: 'export const HACK = 1' }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overall).toBe('failed');
      expect(body.gates.some((g: { passed: boolean }) => !g.passed)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // GET /:agentId/budget
  // -----------------------------------------------------------------------
  describe('GET /:agentId/budget', () => {
    it('returns 404 for unknown agent', async () => {
      const { app } = createApp();
      const res = await app.request('/api/studio/self-modification/unknown/budget');
      expect(res.status).toBe(404);
    });

    it('returns budget state and config for registered agent', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification/test-agent/budget');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.state).toBeDefined();
      expect(body.state.hourlyCount).toBe(0);
      expect(body.state.dailyCount).toBe(0);
      expect(body.config).toBeDefined();
      expect(body.config.maxMutationsPerHour).toBeGreaterThan(0);
      expect(body.config.cooldownMs).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // GET /:agentId/watchdog
  // -----------------------------------------------------------------------
  describe('GET /:agentId/watchdog', () => {
    it('returns 404 for unknown agent', async () => {
      const { app } = createApp();
      const res = await app.request('/api/studio/self-modification/unknown/watchdog');
      expect(res.status).toBe(404);
    });

    it('returns watchdog status for registered agent', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification/test-agent/watchdog');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.state).toBeDefined();
      expect(body.state.consecutiveFailures).toBe(0);
      expect(body.state.totalRollbacks).toBe(0);
      expect(body.state.lastCheckTime).toBeDefined();
      expect(Array.isArray(body.healthChecks)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // GET /:agentId/audit
  // -----------------------------------------------------------------------
  describe('GET /:agentId/audit', () => {
    it('returns 404 for unknown agent', async () => {
      const { app } = createApp();
      const res = await app.request('/api/studio/self-modification/unknown/audit');
      expect(res.status).toBe(404);
    });

    it('returns empty audit log by default', async () => {
      const { app, registry } = createApp();
      registerAgent(registry);
      const res = await app.request('/api/studio/self-modification/test-agent/audit');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries).toEqual([]);
    });
  });
});
