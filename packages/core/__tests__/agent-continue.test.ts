import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { AgentConfig, PipelineContext, SessionManager, SessionRecord } from '@primo-ai/sdk';

describe('Agent.continue()', () => {
  beforeEach(() => {
    registerMockProvider('cont-mock', () =>
      createMockLanguageModel({ text: 'Continued response' }),
    );
  });

  it('throws if SessionManager is not configured', async () => {
    const config: AgentConfig = { model: 'cont-mock/test' };
    const agent = new Agent(config); // no sessionManager dep

    await expect(agent.continue('nonexistent-session', 'hello')).rejects.toThrow(/session manager/i);
  });

  it('throws if session not found', async () => {
    const mockSessionManager: SessionManager = {
      start: async () => ({ sessionId: 's1', createdAt: '', updatedAt: '', status: 'active' }),
      restore: async () => { throw new Error('Session not found: nonexistent'); },
      suspend: async () => {},
      resume: async () => 's2',
      list: async () => [],
    };

    const config: AgentConfig = { model: 'cont-mock/test' };
    const agent = new Agent(config, { sessionManager: mockSessionManager });

    await expect(agent.continue('nonexistent', 'hello')).rejects.toThrow(/session not found/i);
  });

  it('restores session context and runs pipeline, returning AgentRunResult with same sessionId', async () => {
    const sessionId = 'existing-session-123';
    const restoredContext: PipelineContext = {
      request: { input: 'original message', sessionId },
      agent: { config: { model: 'cont-mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 1, response: 'previous response' },
      session: { messageHistory: [
        { role: 'user', content: 'original message' },
        { role: 'assistant', content: 'previous response' },
      ], totalTokenUsage: { input: 10, output: 5 }, custom: {} },
    };

    const mockSessionManager: SessionManager = {
      start: async () => ({ sessionId, createdAt: '', updatedAt: '', status: 'active' } as SessionRecord),
      restore: async (id: string) => {
        if (id === sessionId) return restoredContext;
        throw new Error(`Session not found: ${id}`);
      },
      suspend: async () => {},
      resume: async () => 's2',
      list: async () => [],
    };

    const config: AgentConfig = { model: 'cont-mock/test' };
    const agent = new Agent(config, { sessionManager: mockSessionManager });

    const result = await agent.continue(sessionId, 'follow-up message');

    expect(result.sessionId).toBe(sessionId);
    expect(result.response).toBe('Continued response');
    expect(result.tokenUsage).toBeDefined();
  });

  it('continueStream yields StreamEvents', async () => {
    const sessionId = 'stream-session-456';
    const restoredContext: PipelineContext = {
      request: { input: 'original', sessionId },
      agent: { config: { model: 'cont-mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { messageHistory: [], custom: {} },
    };

    const mockSessionManager: SessionManager = {
      start: async () => ({ sessionId, createdAt: '', updatedAt: '', status: 'active' } as SessionRecord),
      restore: async (id: string) => {
        if (id === sessionId) return restoredContext;
        throw new Error(`Session not found: ${id}`);
      },
      suspend: async () => {},
      resume: async () => 's2',
      list: async () => [],
    };

    const config: AgentConfig = { model: 'cont-mock/test' };
    const agent = new Agent(config, { sessionManager: mockSessionManager });

    const events: unknown[] = [];
    for await (const event of agent.continueStream(sessionId, 'follow-up')) {
      events.push(event);
    }

    // Should have received at least one text_delta event
    const textDeltas = events.filter((e: any) => e.type === 'text_delta');
    expect(textDeltas.length).toBeGreaterThan(0);

    // Should have a complete event
    const completes = events.filter((e: any) => e.type === 'complete');
    expect(completes.length).toBeGreaterThan(0);
  });

  it('continue() propagates AbortSignal', async () => {
    const sessionId = 'abort-continue-session';
    const restoredContext: PipelineContext = {
      request: { input: 'original', sessionId },
      agent: { config: { model: 'cont-mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { messageHistory: [], custom: {} },
    };

    const mockSessionManager: SessionManager = {
      start: async () => ({ sessionId, createdAt: '', updatedAt: '', status: 'active' } as SessionRecord),
      restore: async (id: string) => {
        if (id === sessionId) return restoredContext;
        throw new Error(`Session not found: ${id}`);
      },
      suspend: async () => {},
      resume: async () => 's2',
      list: async () => [],
    };

    const config: AgentConfig = { model: 'cont-mock/test' };
    const agent = new Agent(config, { sessionManager: mockSessionManager });

    const controller = new AbortController();
    controller.abort();

    await expect(agent.continue(sessionId, 'hello', controller.signal)).rejects.toThrow(DOMException);
  });
});
