import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentForgeClient, AgentForgeClientError } from '../src/client.js';

describe('AgentForgeClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('constructor strips trailing slash from URL', () => {
    const client = new AgentForgeClient({ url: 'http://localhost:3000/' });
    expect((client as unknown as { baseUrl: string }).baseUrl).toBe('http://localhost:3000');
  });

  it('constructor sets Authorization header when apiKey provided', () => {
    const client = new AgentForgeClient({ url: 'http://localhost:3000', apiKey: 'secret' });
    expect((client as unknown as { headers: Record<string, string> }).headers['Authorization']).toBe('Bearer secret');
  });

  it('run() POSTs to correct endpoint and returns result', async () => {
    const mockResult = { response: 'hello', tokenUsage: { input: 10, output: 5 }, sessionId: 's1' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResult),
    } as Response);

    const client = new AgentForgeClient({ url: 'http://localhost:3000' });
    const result = await client.run('my-agent', 'test input');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agents/my-agent/run',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ input: 'test input' }) }),
    );
    expect(result).toEqual(mockResult);
  });

  it('getSession() GETs correct endpoint', async () => {
    const mockSession = { sessionId: 's1', status: 'completed' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSession),
    } as Response);

    const client = new AgentForgeClient({ url: 'http://localhost:3000' });
    const result = await client.getSession('s1');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/sessions/s1',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result).toEqual(mockSession);
  });

  it('resume() POSTs to correct endpoint', async () => {
    const mockResult = { response: 'resumed', tokenUsage: { input: 5, output: 3 }, sessionId: 's1' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResult),
    } as Response);

    const client = new AgentForgeClient({ url: 'http://localhost:3000' });
    const result = await client.resume('my-agent', 's1');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agents/my-agent/resume',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ sessionId: 's1' }) }),
    );
    expect(result).toEqual(mockResult);
  });

  // -------------------------------------------------------------------------
  // NEW: Error handling tests
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws AgentForgeClientError on non-2xx response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Agent not found' }),
      } as Response);

      const client = new AgentForgeClient({ url: 'http://localhost:3000' });
      await expect(client.run('missing', 'test')).rejects.toThrow(AgentForgeClientError);
    });

    it('includes status code and message in error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: 'Invalid API key' }),
      } as Response);

      const client = new AgentForgeClient({ url: 'http://localhost:3000' });
      try {
        await client.run('agent', 'test');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentForgeClientError);
        const e = err as AgentForgeClientError;
        expect(e.status).toBe(401);
        expect(e.message).toContain('Invalid API key');
      }
    });

    it('throws on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

      const client = new AgentForgeClient({ url: 'http://localhost:3000' });
      await expect(client.run('agent', 'test')).rejects.toThrow();
    });

    it('throws on 500 server error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Internal error' }),
      } as Response);

      const client = new AgentForgeClient({ url: 'http://localhost:3000' });
      try {
        await client.run('agent', 'test');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentForgeClientError);
        expect((err as AgentForgeClientError).status).toBe(500);
      }
    });
  });

  // -------------------------------------------------------------------------
  // NEW: Retry logic tests
  // -------------------------------------------------------------------------

  describe('retry logic', () => {
    it('retries on 429 rate limit and succeeds', async () => {
      const mockResult = { response: 'ok', tokenUsage: { input: 1, output: 1 }, sessionId: 's1' };
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: false, status: 429, statusText: 'Too Many Requests', json: () => Promise.resolve({ error: 'rate limited' }) } as Response;
        }
        return { ok: true, status: 200, json: () => Promise.resolve(mockResult) } as Response;
      });

      const client = new AgentForgeClient({ url: 'http://localhost:3000', retries: 3, retryDelay: 1 });
      const result = await client.run('agent', 'test');

      expect(callCount).toBe(2);
      expect(result).toEqual(mockResult);
    });

    it('retries on 503 service unavailable', async () => {
      const mockResult = { response: 'ok', tokenUsage: { input: 1, output: 1 }, sessionId: 's1' };
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return { ok: false, status: 503, statusText: 'Service Unavailable', json: () => Promise.resolve({ error: 'overloaded' }) } as Response;
        }
        return { ok: true, status: 200, json: () => Promise.resolve(mockResult) } as Response;
      });

      const client = new AgentForgeClient({ url: 'http://localhost:3000', retries: 3, retryDelay: 1 });
      const result = await client.run('agent', 'test');

      expect(callCount).toBe(3);
      expect(result).toEqual(mockResult);
    });

    it('does not retry on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Not found' }),
      } as Response);

      const client = new AgentForgeClient({ url: 'http://localhost:3000', retries: 3 });
      await expect(client.run('agent', 'test')).rejects.toThrow(AgentForgeClientError);

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 401', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      } as Response);

      const client = new AgentForgeClient({ url: 'http://localhost:3000', retries: 3 });
      await expect(client.run('agent', 'test')).rejects.toThrow(AgentForgeClientError);

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('exhausts retries and throws', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ error: 'overloaded' }),
      } as Response);

      const client = new AgentForgeClient({ url: 'http://localhost:3000', retries: 2 });
      await expect(client.run('agent', 'test')).rejects.toThrow(AgentForgeClientError);

      expect(fetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });
});

describe('parseSSE', () => {
  it('parses multi-line SSE string', async () => {
    const { parseSSE } = await import('../src/client.js');
    const raw = 'data: {"type":"text_delta","text":"hi"}\n\ndata: {"type":"complete"}\n\n';
    const messages = [...parseSSE(raw)];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: 'text_delta', text: 'hi' });
    expect(messages[1]).toEqual({ type: 'complete' });
  });

  it('skips malformed lines', async () => {
    const { parseSSE } = await import('../src/client.js');
    const raw = 'data: {"type":"ok"}\n\nnot-data\n\ndata: bad{json\n\n';
    const messages = [...parseSSE(raw)];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'ok' });
  });
});
