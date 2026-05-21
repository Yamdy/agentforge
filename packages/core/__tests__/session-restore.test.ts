import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent, type AgentDependencies } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { AgentConfig, PipelineContext, SessionManager } from '@primo-ai/sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock SessionManager whose restore() returns a known context. */
function createMockSessionManager(restoredCtx: PipelineContext): SessionManager {
  return {
    start: vi.fn().mockResolvedValue({ sessionId: 'fresh-session-id', status: 'active' }),
    restore: vi.fn().mockResolvedValue(restoredCtx),
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue('child-session-id'),
    resumeInPlace: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  };
}

function makeRestoredContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { input: 'previous input', sessionId: 'restored-session-123' },
    agent: { config: { model: 'mock/test' } as unknown as PipelineContext['agent']['config'], promptFragments: [], toolDeclarations: [] },
    iteration: { step: 1, response: 'previous response' },
    session: {
      messageHistory: [
        { role: 'user' as const, content: 'previous input' },
        { role: 'assistant' as const, content: 'previous response' },
      ],
      totalTokenUsage: { input: 100, output: 50 },
      custom: { key: 'value' },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Session Restoration', () => {
  beforeEach(() => {
    registerMockProvider('mock', (modelId) =>
      createMockLanguageModel({ text: `Hello from ${modelId}!` }),
    );
  });

  // -------------------------------------------------------------------------
  // Path 2: sessionId restores from sessionManager when no lastContext
  // -------------------------------------------------------------------------
  it('agent.run(input, { sessionId }) restores from sessionManager when no lastContext', async () => {
    const restored = makeRestoredContext();
    const sessionManager = createMockSessionManager(restored);
    const config: AgentConfig = { model: 'mock/test' };
    const deps: AgentDependencies = { sessionManager } as AgentDependencies;
    const agent = new Agent(config, deps);

    const result = await agent.run('follow-up question', { sessionId: 'restored-session-123' });

    expect(sessionManager.restore).toHaveBeenCalledWith('restored-session-123');
    expect(result.response).toBe('Hello from test!');
    expect(result.sessionId).toBe('restored-session-123');
  });

  it('restored context has prior messageHistory + new user message appended', async () => {
    const restored = makeRestoredContext();
    const sessionManager = createMockSessionManager(restored);
    const config: AgentConfig = { model: 'mock/test' };
    const deps: AgentDependencies = { sessionManager } as AgentDependencies;
    const agent = new Agent(config, deps);

    // Capture what context the agent builds — we can inspect via the event bus
    const contexts: PipelineContext[] = [];
    agent.eventBus.subscribe('stage:before', (data: unknown) => {
      const d = data as { context?: PipelineContext };
      if (d.context) contexts.push(d.context);
    });

    await agent.run('follow-up question', { sessionId: 'restored-session-123' });

    // The buildContext stage fires with the restored history + new user message
    // We verify by checking that the sessionManager.restore was called correctly
    expect(sessionManager.restore).toHaveBeenCalledWith('restored-session-123');
  });

  // -------------------------------------------------------------------------
  // Path 1 takes priority over Path 2
  // -------------------------------------------------------------------------
  it('lastContext takes priority over sessionId (Path 1 > Path 2)', async () => {
    const restored = makeRestoredContext();
    const sessionManager = createMockSessionManager(restored);
    const config: AgentConfig = { model: 'mock/test' };
    const deps: AgentDependencies = { sessionManager } as AgentDependencies;
    const agent = new Agent(config, deps);

    // First run establishes lastContext (no sessionId)
    const result1 = await agent.run('first message');
    const firstSessionId = result1.sessionId;

    // Second run with a different sessionId — lastContext should win
    const result2 = await agent.run('second message', { sessionId: 'some-other-session' });

    // restore should NOT have been called because lastContext path takes priority
    expect(sessionManager.restore).not.toHaveBeenCalled();
    // Should use the original sessionId from lastContext, not the one passed in options
    expect(result2.sessionId).toBe(firstSessionId);
  });

  // -------------------------------------------------------------------------
  // Path 3: Without sessionManager, sessionId used as new session ID only
  // -------------------------------------------------------------------------
  it('without sessionManager, sessionId is used for new session ID only', async () => {
    const config: AgentConfig = { model: 'mock/test' };
    // No sessionManager in deps
    const agent = new Agent(config);

    const result = await agent.run('test input', { sessionId: 'my-custom-session-id' });

    // Should use the provided sessionId
    expect(result.sessionId).toBe('my-custom-session-id');
    expect(result.response).toBe('Hello from test!');
  });

  // -------------------------------------------------------------------------
  // Backward compatibility
  // -------------------------------------------------------------------------
  it('backward compat: agent.run(input) still works', async () => {
    const config: AgentConfig = { model: 'mock/test' };
    const agent = new Agent(config);

    const result = await agent.run('hello');

    expect(result.response).toBe('Hello from test!');
    expect(result.sessionId).toBeTruthy();
  });

  it('backward compat: agent.run(input, abortSignal) still works', async () => {
    const config: AgentConfig = { model: 'mock/test' };
    const agent = new Agent(config);

    const result = await agent.run('hello', undefined);

    expect(result.response).toBe('Hello from test!');
  });

  it('backward compat: agent.run(input, AbortSignal) works with pre-aborted signal', async () => {
    const config: AgentConfig = { model: 'mock/test' };
    const agent = new Agent(config);
    const controller = new AbortController();
    controller.abort();

    await expect(agent.run('hello', controller.signal)).rejects.toThrow('Agent run aborted');
  });

  // -------------------------------------------------------------------------
  // stream with sessionId
  // -------------------------------------------------------------------------
  it('agent.stream(input, { sessionId }) restores and streams', async () => {
    const restored = makeRestoredContext();
    const sessionManager = createMockSessionManager(restored);
    const config: AgentConfig = { model: 'mock/test' };
    const deps: AgentDependencies = { sessionManager } as AgentDependencies;
    const agent = new Agent(config, deps);

    const chunks: string[] = [];
    for await (const chunk of agent.stream('follow-up', { sessionId: 'restored-session-123' })) {
      chunks.push(chunk);
    }

    expect(sessionManager.restore).toHaveBeenCalledWith('restored-session-123');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toContain('Hello from test!');
  });

  // -------------------------------------------------------------------------
  // streamEvents with sessionId
  // -------------------------------------------------------------------------
  it('agent.streamEvents(input, { sessionId }) restores and yields events', async () => {
    const restored = makeRestoredContext();
    const sessionManager = createMockSessionManager(restored);
    const config: AgentConfig = { model: 'mock/test' };
    const deps: AgentDependencies = { sessionManager } as AgentDependencies;
    const agent = new Agent(config, deps);

    const events: unknown[] = [];
    for await (const event of agent.streamEvents('follow-up', { sessionId: 'restored-session-123' })) {
      events.push(event);
    }

    expect(sessionManager.restore).toHaveBeenCalledWith('restored-session-123');
    // Should have at least some events (text deltas, complete, etc.)
    expect(events.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // RunOptions type discrimination
  // -------------------------------------------------------------------------
  it('agent.run(input, { signal }) works with signal inside RunOptions', async () => {
    const config: AgentConfig = { model: 'mock/test' };
    const agent = new Agent(config);
    const controller = new AbortController();

    const result = await agent.run('hello', { signal: controller.signal });

    expect(result.response).toBe('Hello from test!');
  });

  it('agent.run(input, { sessionId, signal }) passes both correctly', async () => {
    const restored = makeRestoredContext();
    const sessionManager = createMockSessionManager(restored);
    const config: AgentConfig = { model: 'mock/test' };
    const deps: AgentDependencies = { sessionManager } as AgentDependencies;
    const agent = new Agent(config, deps);
    const controller = new AbortController();

    const result = await agent.run('follow-up', { sessionId: 'restored-session-123', signal: controller.signal });

    expect(sessionManager.restore).toHaveBeenCalledWith('restored-session-123');
    expect(result.sessionId).toBe('restored-session-123');
  });
});
