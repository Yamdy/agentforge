import { describe, it, expect } from 'vitest';
import { memoryPlugin } from '../src/memory/index.js';
import { InMemoryBackend } from '../src/memory/in-memory-backend.js';
import type { HarnessAPI, PipelineContext } from '@agentforge/sdk';

function createHarnessAPI(): { api: HarnessAPI; processors: Map<string, unknown>; tools: Map<string, unknown> } {
  const processors = new Map<string, unknown>();
  const tools = new Map<string, unknown>();

  const api: HarnessAPI = {
    registerProcessor: (stage, processor) => { processors.set(stage, processor); },
    registerTool: (tool) => { tools.set(tool.name, tool); },
    registerCommand: () => {},
    registerHook: () => {},
    subscribe: () => () => {},
    registerResource: () => {},
    registerProvider: () => {},
  };

  return { api, processors, tools };
}

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

describe('memoryPlugin — automatic mode', () => {
  it('registers buildContext and processOutput processors', () => {
    const backend = new InMemoryBackend();
    const { api, processors } = createHarnessAPI();

    const registration = memoryPlugin({ backend, triggerMode: { type: 'automatic', onLoad: 'always' } })(api);

    expect(processors.has('buildContext')).toBe(true);
    expect(processors.has('processOutput')).toBe(true);
    expect(registration.processors).toHaveLength(2);
  });

  it('end-to-end: store on output, load on next context build', async () => {
    const backend = new InMemoryBackend();
    const { api, processors } = createHarnessAPI();

    memoryPlugin({ backend, triggerMode: { type: 'automatic', onLoad: 'always' } })(api);

    const buildCtxProcessor = processors.get('buildContext') as { execute: (ctx: PipelineContext) => Promise<PipelineContext> };
    const outputProcessor = processors.get('processOutput') as { execute: (ctx: PipelineContext) => Promise<PipelineContext> };

    // First turn: processOutput saves the conversation
    const ctx1 = makeContext({
      request: { input: 'What is TypeScript?', sessionId: 's-e2e' },
      iteration: { step: 0, response: 'A typed superset of JavaScript' },
    });
    await outputProcessor.execute(ctx1);

    // Verify stored
    const stored = await backend.retrieve('s-e2e');
    expect(stored).toHaveLength(2);

    // Second turn: buildContext loads memory
    const ctx2 = makeContext({ request: { input: 'Tell me more', sessionId: 's-e2e' } });
    const result = await buildCtxProcessor.execute(ctx2);

    const history = result.session.messageHistory as Array<{ content: string }>;
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe('What is TypeScript?');
    expect(history[1].content).toBe('A typed superset of JavaScript');

    // Default injectionMode='history' no longer injects promptFragments
    const fragments = result.agent.promptFragments as string[];
    expect(fragments).toHaveLength(0);
  });
});

describe('memoryPlugin — agent-controlled mode', () => {
  it('registers retrieve_from_memory and record_to_memory tools', () => {
    const backend = new InMemoryBackend();
    const { api, tools } = createHarnessAPI();

    memoryPlugin({ backend, triggerMode: { type: 'agent-controlled' } })(api);

    expect(tools.has('retrieve_from_memory')).toBe(true);
    expect(tools.has('record_to_memory')).toBe(true);
  });

  it('retrieve_from_memory tool returns stored entries', async () => {
    const backend = new InMemoryBackend();
    const { api, tools } = createHarnessAPI();

    memoryPlugin({ backend, triggerMode: { type: 'agent-controlled' } })(api);

    // Pre-seed data
    await backend.store('session-1', {
      role: 'user',
      content: 'hello agent',
      timestamp: new Date().toISOString(),
    });

    const retrieveTool = tools.get('retrieve_from_memory') as { execute: (input: { sessionId: string; query?: { limit?: number } }) => Promise<unknown> };
    const result = await retrieveTool.execute({ sessionId: 'session-1' });

    const entries = result as Array<{ role: string; content: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('hello agent');
  });

  it('record_to_memory tool stores an entry', async () => {
    const backend = new InMemoryBackend();
    const { api, tools } = createHarnessAPI();

    memoryPlugin({ backend, triggerMode: { type: 'agent-controlled' } })(api);

    const recordTool = tools.get('record_to_memory') as { execute: (input: { sessionId: string; role: string; content: string }) => Promise<unknown> };
    await recordTool.execute({ sessionId: 's1', role: 'assistant', content: 'important insight' });

    const stored = await backend.retrieve('s1');
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('important insight');
  });

  it('does not register processors in agent-controlled mode', () => {
    const backend = new InMemoryBackend();
    const { api, processors } = createHarnessAPI();

    memoryPlugin({ backend, triggerMode: { type: 'agent-controlled' } })(api);

    expect(processors.size).toBe(0);
  });
});
