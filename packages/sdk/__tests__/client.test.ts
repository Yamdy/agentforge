import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentForgeClient } from '../src/client.js';

describe('AgentForgeClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('constructor strips trailing slash from URL', () => {
    const client = new AgentForgeClient({ url: 'http://localhost:3000/' });
    expect((client as any).baseUrl).toBe('http://localhost:3000');
  });

  it('constructor sets Authorization header when apiKey provided', () => {
    const client = new AgentForgeClient({ url: 'http://localhost:3000', apiKey: 'secret' });
    expect((client as any).headers['Authorization']).toBe('Bearer secret');
  });

  it('run() POSTs to correct endpoint and returns result', async () => {
    const mockResult = { response: 'hello', tokenUsage: { input: 10, output: 5 }, sessionId: 's1' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
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
