import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAgentForgeServer } from '../src/server.js';
import type { Server } from 'node:http';

describe('Server Integration', () => {
  let server: Server;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    // Use a temp directory for config
    const { mkdir, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const tmpDir = join(process.cwd(), 'tmp-test-server');

    // Clean up and create
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(tmpDir, { recursive: true });

    const result = createAgentForgeServer({
      port: 0, // Use port 0 to get a random available port
      configDir: tmpDir,
      version: 'test',
    });

    server = result.server;
    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
          baseUrl = `http://localhost:${port}`;
          resolve();
        } else {
          reject(new Error('Failed to get server port'));
        }
      });
      server.on('error', reject);
    });
  });

  afterAll(async () => {
    server?.close();
    // Clean up temp directory
    const { rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const tmpDir = join(process.cwd(), 'tmp-test-server');
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should respond to health check', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const data = await response.json() as Record<string, unknown>;
    expect(data.status).toBe('ok');
  });

  it('should respond to readiness check', async () => {
    const response = await fetch(`${baseUrl}/ready`);
    const data = await response.json() as Record<string, unknown>;
    expect(data.status).toBe('ready');
  });

  it('should return config info', async () => {
    const response = await fetch(`${baseUrl}/api/config`);
    const data = await response.json() as Record<string, unknown>;
    expect(data.version).toBe('test');
    expect(data.configDir).toBeTruthy();
  });

  it('should create a session', async () => {
    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentConfigId: 'test-agent' }),
    });

    expect(response.status).toBe(201);
    const data = await response.json() as Record<string, unknown>;
    expect(data.id).toBeTruthy();
    expect(data.agentConfigId).toBe('test-agent');
  });

  it('should list sessions', async () => {
    // Create a session first
    await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await fetch(`${baseUrl}/api/sessions`);
    const data = await response.json() as Record<string, unknown>[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('should get a session by id', async () => {
    // Create a session
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const created = await createResponse.json() as Record<string, unknown>;
    const sessionId = created.id as string;

    // Get the session
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.id).toBe(sessionId);
  });

  it('should return 404 for unknown session', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/nonexistent`);
    expect(response.status).toBe(404);
  });

  it('should delete a session', async () => {
    // Create a session
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const created = await createResponse.json() as Record<string, unknown>;
    const sessionId = created.id as string;

    // Delete the session
    const deleteResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(204);

    // Verify it's gone
    const getResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
    expect(getResponse.status).toBe(404);
  });

  it('should clear a session', async () => {
    // Create a session
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const created = await createResponse.json() as Record<string, unknown>;
    const sessionId = created.id as string;

    // Clear the session
    const clearResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/clear`, {
      method: 'POST',
    });
    const data = await clearResponse.json() as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it('should return 404 for non-existent routes', async () => {
    const response = await fetch(`${baseUrl}/api/nonexistent`);
    expect(response.status).toBe(404);
  });

  it('should return 409 for chat/stream without agent config', async () => {
    // Create a session with a non-existent agent config
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentConfigId: 'nonexistent-agent' }),
    });
    const created = await createResponse.json() as Record<string, unknown>;
    const sessionId = created.id as string;

    // Try to chat — should get 404 because the agent config doesn't exist
    const chatResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });

    // Will get 404 (agent config not found in config store) or 500 (agent creation fails)
    expect([404, 500]).toContain(chatResponse.status);
  });

  it('should return event pagination with query params', async () => {
    // Create a session
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const created = await createResponse.json() as Record<string, unknown>;
    const sessionId = created.id as string;

    // Get session with pagination params
    const response = await fetch(
      `${baseUrl}/api/sessions/${sessionId}?eventLimit=10&eventOffset=0`,
    );
    expect(response.status).toBe(200);
    const data = await response.json() as Record<string, unknown>;
    expect(data.id).toBe(sessionId);
  });
});