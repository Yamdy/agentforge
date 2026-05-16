import { describe, it, expect } from 'vitest';
import { AgentForgeServer } from '../src/server.js';

describe('Health endpoints', () => {
  describe('GET /health', () => {
    it('returns basic health status', async () => {
      const server = new AgentForgeServer({ port: 0 });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.timestamp).toBeDefined();
      } finally {
        await handle.close();
      }
    });
  });

  describe('GET /health/live', () => {
    it('returns liveness probe with status ok', async () => {
      const server = new AgentForgeServer({ port: 0 });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/health/live`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
      } finally {
        await handle.close();
      }
    });
  });

  describe('GET /health/ready', () => {
    it('returns readiness probe with server metadata', async () => {
      const server = new AgentForgeServer({ port: 0 });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/health/ready`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.version).toBe('0.0.1');
        expect(typeof body.uptime).toBe('number');
        expect(body.uptime).toBeGreaterThanOrEqual(0);
        expect(body.agents).toBe(0);
      } finally {
        await handle.close();
      }
    });

    it('reports correct number of registered agents', async () => {
      const server = new AgentForgeServer({ port: 0 });
      server.registry.register('agent-a', { model: 'test', systemPrompt: '', tools: [] });
      server.registry.register('agent-b', { model: 'test', systemPrompt: '', tools: [] });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/health/ready`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.agents).toBe(2);
      } finally {
        await handle.close();
      }
    });

    it('uptime increases over time', async () => {
      const server = new AgentForgeServer({ port: 0 });
      const handle = await server.start();
      try {
        const res1 = await fetch(`http://127.0.0.1:${handle.port}/health/ready`);
        const body1 = await res1.json();

        // Wait a bit
        await new Promise(r => setTimeout(r, 100));

        const res2 = await fetch(`http://127.0.0.1:${handle.port}/health/ready`);
        const body2 = await res2.json();

        expect(body2.uptime).toBeGreaterThanOrEqual(body1.uptime);
      } finally {
        await handle.close();
      }
    });
  });
});
