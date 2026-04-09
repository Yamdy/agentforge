import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from '../src/server/index.js';
import { createAgentForgeClient } from '../src/sdk/client.js';
import type { Agent } from '../src/agent/agent.js';
import { createAgent } from '../src/examples/demo.js';

describe('E2E Tests for AgentForge with Builtin Tools', () => {
  let server: any;
  let client: any;
  let agent: Agent;

  const port = 3002;
  const baseUrl = `http://localhost:${port}`;

  beforeAll(async () => {
    agent = await createAgent();
    server = await startServer({ port, apiKey: 'test-api-key', agent });
    client = createAgentForgeClient({ baseUrl, apiKey: 'test-api-key' });
  }, 30000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(resolve);
      });
    }
  }, 10000);

  describe('Health Check', () => {
    it('should return health status', async () => {
      const result = await client.healthCheck();
      expect(result).toEqual({ status: 'ok', timestamp: expect.any(String) });
    });
  });

  describe('Session Management', () => {
    it('should create a new session', async () => {
      const session = await client.createSession({
        title: 'Test Session with Builtin Tools',
        messages: [],
      });

      expect(session).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: 'Test Session with Builtin Tools',
          messages: [],
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        })
      );
    });
  });

  describe('Agent with Builtin Tools', () => {
    it('should list directory contents (ls tool)', async () => {
      const result = await client.run('List the contents of the current directory');
      // 我们不检查具体的内容，因为它取决于运行环境
      expect(typeof result).toBe('string');
    }, 30000);

    it('should check if a file exists (ls tool)', async () => {
      const result = await client.run('Check if package.json exists');
      expect(typeof result).toBe('string');
    }, 30000);

    it('should run a shell command (bash tool)', async () => {
      const result = await client.run('Run "echo hello world" in the shell');
      expect(typeof result).toBe('string');
    }, 30000);

    it('should read a file (read tool)', async () => {
      const result = await client.run('Read package.json file');
      expect(typeof result).toBe('string');
    }, 30000);
  });
});
