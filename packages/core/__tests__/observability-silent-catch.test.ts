import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/event-bus.js';
import { HookManager } from '../src/hook-manager.js';
import { LLMInvoker } from '../src/llm-invoker.js';
import { PluginManager } from '../src/plugin-manager.js';
import { PipelineRunner } from '../src/pipeline.js';
import { ToolRegistry } from '../src/tool-registry.js';
import { SessionPersistence } from '../src/session-persistence.js';
import type { SessionStorage, SessionEvent } from '@agentforge/sdk';

/**
 * F-D RED tests: Silent catch blocks in critical paths must emit
 * observability events instead of swallowing silently.
 */

// ---------------------------------------------------------------------------
// F-D.1: LLMInvoker stream path — usage rejection must be observable
// ---------------------------------------------------------------------------
describe('F-D.1: LLMInvoker stream usage fallback is observable', () => {
  it('emits llm:usage_unavailable event when result.usage rejects', async () => {
    const events: { type: string; data: unknown }[] = [];
    const bus = new EventBus((err, type) => {
      events.push({ type, data: err });
    });

    // Create a model where usage promise rejects
    const model = {
      modelId: 'usage-fail',
      specificationVersion: 'v3',
      provider: 'mock',
      supportedUrls: {},
      async doStream() {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 't1' });
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'hi' });
            controller.enqueue({ type: 'text-end', id: 't1' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: undefined,
            });
            controller.close();
          },
        });
        return {
          stream,
          textPromise: Promise.resolve('hi'),
          usagePromise: Promise.reject(new Error('usage fetch failed')),
          reasoningTextPromise: Promise.resolve(undefined),
        } as any;
      },
    };

    const invoker = new LLMInvoker({ model: model as any });
    const handle = invoker.stream({ messages: [{ role: 'user', content: 'test' }] });
    for await (const _ of handle.fullStream) { /* drain */ }
    const usage = await handle.usage;

    // Should still return zeros as fallback
    expect(usage).toEqual({ input: 0, output: 0 });

    // But the error must be observable — currently this will FAIL
    expect(events.some(e => e.type === 'llm:usage_unavailable')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-D.2: HookManager standard profile — hook failure must emit event
// ---------------------------------------------------------------------------
describe('F-D.2: HookManager standard profile emits error on hook failure', () => {
  it('emits hook:error event when a hook throws in standard profile', async () => {
    const events: { type: string; data: unknown }[] = [];
    const bus = new EventBus((err, type) => {
      events.push({ type, data: err });
    });

    const hm = new HookManager(bus);
    hm.register({
      point: 'tool.before',
      handler: () => { throw new Error('hook boom'); },
    });

    await hm.invoke('tool.before', { toolName: 'test' }, {});

    // Hook error must be observable via event — currently this will FAIL
    expect(events.some(e => e.type === 'hook:error' || e.type === 'error')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-D.3: PluginManager shutdown — resource stop error must be observable
// ---------------------------------------------------------------------------
describe('F-D.3: PluginManager shutdown observes resource stop failure', () => {
  it('records error in getErrors() when resource.stop() throws', async () => {
    const runner = new PipelineRunner();
    const registry = new ToolRegistry();
    const pm = new PluginManager(runner, registry);

    const failingResource = {
      id: 'fail-res',
      start: async () => 'instance',
      stop: async () => { throw new Error('shutdown boom'); },
    };

    pm.initializePlugin((api) => {
      api.registerResource(failingResource as any);
    });

    await pm.initializeAll();
    await pm.shutdown();

    // Resource stop failure must be recorded — currently this will FAIL
    const errors = pm.getErrors();
    expect(errors.some(e => e.source === 'resource:fail-res')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-D.4: SessionPersistence — write failure must be observable
// ---------------------------------------------------------------------------
describe('F-D.4: SessionPersistence write failure is observable', () => {
  it('emits session:write_failed event when storage.append rejects', async () => {
    const events: { type: string; data: unknown }[] = [];
    const bus = new EventBus((err, type) => {
      events.push({ type, data: err });
    });

    const failingStorage: SessionStorage = {
      async append(_sessionId: string, _event: SessionEvent) {
        throw new Error('disk full');
      },
      async *read(_sessionId: string) { /* empty */ },
      async updateMeta(_sessionId: string, _meta: unknown) {},
      async list() { return []; },
    };

    const persistence = new SessionPersistence(bus, failingStorage);

    // Trigger a write by emitting an event with sessionId
    bus.emit('agent:start', { sessionId: 'test-session' });

    // Allow async write chain to settle
    await new Promise((r) => setTimeout(r, 50));

    // Write failure must be observable — currently this will FAIL
    expect(events.some(e => e.type === 'session:write_failed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-D.5: LLMInvoker invoke path — usage fallback must be observable
// ---------------------------------------------------------------------------
describe('F-D.5: LLMInvoker invoke usage fallback is observable', () => {
  it('usage catch does not silently swallow without tracing', async () => {
    const consoleErrors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    };

    try {
      const model = {
        modelId: 'usage-crash',
        specificationVersion: 'v3',
        provider: 'mock',
        supportedUrls: {},
        async doStream() {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 't1' });
              controller.enqueue({ type: 'text-delta', id: 't1', delta: 'hello' });
              controller.enqueue({ type: 'text-end', id: 't1' });
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: undefined,
              });
              controller.close();
            },
          });
          return {
            stream,
            textPromise: Promise.resolve('hello'),
            usagePromise: Promise.reject(new Error('no usage data')),
            reasoningTextPromise: Promise.resolve(undefined),
          } as any;
        },
      };

      const invoker = new LLMInvoker({ model: model as any });
      const handle = invoker.stream({ messages: [{ role: 'user', content: 'test' }] });
      for await (const _ of handle.fullStream) { /* drain */ }
      await handle.usage;

      // There should be some observability output for usage rejection
      expect(consoleErrors.length).toBeGreaterThan(0);
    } finally {
      console.error = origError;
    }
  });
});
