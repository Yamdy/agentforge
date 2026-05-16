import { describe, it, expect } from 'vitest';
import { AgentForgeServer } from '../src/server.js';
import { serializeSSE, parseSSE } from '../src/sse.js';

describe('AgentForgeServer', () => {
  it('creates server with registry', () => {
    const server = new AgentForgeServer({ port: 3001 });
    expect(server.registry).toBeDefined();
    expect(server.hono).toBeDefined();
  });

  it('creates server with API key middleware', () => {
    const server = new AgentForgeServer({ port: 3001, apiKey: 'test-key' });
    expect(server.hono).toBeDefined();
  });
});

describe('SSE serialization', () => {
  it('serializes a message', () => {
    const result = serializeSSE({ type: 'text_delta', text: 'hello' });
    expect(result).toBe('data: {"type":"text_delta","text":"hello"}\n\n');
  });

  it('parses SSE messages', () => {
    const raw = 'data: {"type":"text_delta","text":"hi"}\n\ndata: {"type":"complete"}\n\n';
    const parsed = [...parseSSE(raw)];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ type: 'text_delta', text: 'hi' });
  });
});
