import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { AgentRegistry } from '../src/registry.js';
import { studioAgentRoutes } from '../src/routes/studio/agents.js';

describe('Studio Agent routes', () => {
  let app: Hono;
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
    app = new Hono();
    app.route('/api/studio/agents', studioAgentRoutes(registry));
  });

  describe('GET /', () => {
    it('returns agents list with details', async () => {
      const config = { name: 'my-agent', model: 'gpt-4', tools: [{ name: 'echo' }], description: 'A test agent' };
      registry.register('my-agent', config as any);

      const res = await app.request('/api/studio/agents');
      expect(res.status).toBe(200);
      const body = await res.json() as { agents: Array<{ id: string; name: string; model: string; state: string; toolCount: number; description: string }> };
      expect(body.agents).toHaveLength(1);
      expect(body.agents[0].id).toBe('my-agent');
      expect(body.agents[0].state).toBe('pending');
    });

    it('returns empty list when no agents registered', async () => {
      const res = await app.request('/api/studio/agents');
      expect(res.status).toBe(200);
      const body = await res.json() as { agents: unknown[] };
      expect(body.agents).toHaveLength(0);
    });
  });

  describe('GET /:id', () => {
    it('returns agent detail with config and tools', async () => {
      const config = { name: 'detail-agent', model: 'gpt-4', tools: [{ name: 'echo', description: 'echo tool', parameters: {} }], description: 'Detail test' };
      registry.register('detail-agent', config as any);

      const res = await app.request('/api/studio/agents/detail-agent');
      expect(res.status).toBe(200);
      const body = await res.json() as { id: string; name: string; model: string; state: string; tools: Array<{ name: string }>; description: string };
      expect(body.id).toBe('detail-agent');
      expect(body.model).toBe('gpt-4');
      expect(body.state).toBe('pending');
      expect(body.tools).toHaveLength(1);
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await app.request('/api/studio/agents/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
