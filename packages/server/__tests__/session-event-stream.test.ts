import { describe, it, expect, vi } from 'vitest';
import { SessionEventStream } from '../src/session-event-stream.js';
import { AgentRegistry } from '../src/registry.js';
import { parseSSE } from '../src/sse.js';
import { EventBus } from '@primo-ai/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRegistryWithMockAgent(agentId: string, sessionId: string) {
  const registry = new AgentRegistry();
  const eventBus = new EventBus();

  // Create a real agent so we have a real eventBus
  const agent = registry.register(agentId, { model: 'test-model', tools: [] });

  // Override eventBus getter to use our controlled one
  Object.defineProperty(agent, 'eventBus', { value: eventBus, configurable: true });

  registry.registerSession(sessionId, agentId);
  return { registry, agent, eventBus };
}

function consumeStream(stream: ReadableStream<Uint8Array>, timeout = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reader.cancel();
      resolve(chunks.join(''));
    }, timeout);
    const reader = stream.getReader();
    const chunks: string[] = [];
    const decoder = new TextDecoder();

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          clearTimeout(timer);
          resolve(chunks.join(''));
          return;
        }
        chunks.push(decoder.decode(value, { stream: true }));
        read();
      }).catch(reject);
    }
    read();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionEventStream', () => {
  describe('subscribe', () => {
    it('returns a ReadableStream', () => {
      const { registry } = createRegistryWithMockAgent('agent-1', 'sess-1');
      const ses = new SessionEventStream(registry);
      const stream = ses.subscribe('sess-1');
      expect(stream).toBeInstanceOf(ReadableStream);
      stream.cancel();
    });

    it('forwards events from the agent eventBus as SSE frames', async () => {
      const { registry, eventBus } = createRegistryWithMockAgent('agent-1', 'sess-1');
      const ses = new SessionEventStream(registry);
      const stream = ses.subscribe('sess-1');

      // Emit an event after a short delay
      setTimeout(() => {
        eventBus.emit('iteration:end', { sessionId: 'sess-1', response: 'hello' });
      }, 50);

      const raw = await consumeStream(stream, 500);
      expect(raw).toContain('data:');
      // The event should be serialized as SSE
      expect(raw.length).toBeGreaterThan(0);
    });

    it('returns an empty stream for unknown session', async () => {
      const registry = new AgentRegistry();
      const ses = new SessionEventStream(registry);
      const stream = ses.subscribe('unknown-session');

      // Should get a stream that closes quickly since no agent found
      const raw = await consumeStream(stream, 300);
      // Either empty or contains an error SSE message
      if (raw.length > 0) {
        expect(raw).toContain('data:');
      }
    });
  });

  describe('fromAgentContinue', () => {
    it('returns a ReadableStream', () => {
      const { registry } = createRegistryWithMockAgent('agent-1', 'sess-1');
      const ses = new SessionEventStream(registry);

      // Mock continueStream to yield nothing
      const agent = registry.getAgentBySession('sess-1')!;
      agent.continueStream = vi.fn().mockImplementation(async function* () {
        // yield nothing
      });

      const stream = ses.fromAgentContinue('sess-1', 'hello');
      expect(stream).toBeInstanceOf(ReadableStream);
      stream.cancel();
    });

    it('emits session.started and session.completed events wrapping the stream', async () => {
      const { registry } = createRegistryWithMockAgent('agent-1', 'sess-1');
      const ses = new SessionEventStream(registry);

      const agent = registry.getAgentBySession('sess-1')!;
      agent.continueStream = vi.fn().mockImplementation(async function* () {
        yield { type: 'text_delta', text: 'world' } as unknown;
      });

      const stream = ses.fromAgentContinue('sess-1', 'hello');
      const raw = await consumeStream(stream, 500);
      const messages = Array.from(parseSSE(raw));

      const types = messages.map(m => m.type);
      expect(types).toContain('session.started');
      expect(types).toContain('session.completed');
      expect(types).toContain('text_delta');
    });

    it('forwards text_delta events from continueStream', async () => {
      const { registry } = createRegistryWithMockAgent('agent-1', 'sess-1');
      const ses = new SessionEventStream(registry);

      const agent = registry.getAgentBySession('sess-1')!;
      agent.continueStream = vi.fn().mockImplementation(async function* () {
        yield { type: 'text_delta', text: 'hello' } as unknown;
        yield { type: 'text_delta', text: ' world' } as unknown;
      });

      const stream = ses.fromAgentContinue('sess-1', 'test');
      const raw = await consumeStream(stream, 500);
      const messages = Array.from(parseSSE(raw));

      const textDeltas = messages.filter(m => m.type === 'text_delta');
      expect(textDeltas).toHaveLength(2);
      expect((textDeltas[0] as unknown as { text: string }).text).toBe('hello');
      expect((textDeltas[1] as unknown as { text: string }).text).toBe(' world');
    });

    it('emits session.started with sessionId', async () => {
      const { registry } = createRegistryWithMockAgent('agent-1', 'sess-1');
      const ses = new SessionEventStream(registry);

      const agent = registry.getAgentBySession('sess-1')!;
      agent.continueStream = vi.fn().mockImplementation(async function* () {});

      const stream = ses.fromAgentContinue('sess-1', 'hello');
      const raw = await consumeStream(stream, 500);
      const messages = Array.from(parseSSE(raw));

      const started = messages.find(m => m.type === 'session.started');
      expect(started).toBeDefined();
      expect((started as unknown as { sessionId: string }).sessionId).toBe('sess-1');
    });

    it('returns error SSE when agent not found', async () => {
      const registry = new AgentRegistry();
      const ses = new SessionEventStream(registry);

      const stream = ses.fromAgentContinue('unknown', 'hello');
      const raw = await consumeStream(stream, 500);
      const messages = Array.from(parseSSE(raw));

      const errorEvent = messages.find(m => m.type === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent as unknown as { message: string }).message).toContain('No agent');
    });
  });
});
