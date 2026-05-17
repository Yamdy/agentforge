import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';

describe('Agent event methods', () => {
  beforeEach(() => {
    registerMockProvider('evt-mock', (modelId) =>
      createMockLanguageModel({ text: `response` }),
    );
  });

  describe('on()', () => {
    it('registers a handler and returns an unsubscribe function', async () => {
      const agent = new Agent({ model: 'evt-mock/test' });
      const received: string[] = [];

      const unsubscribe = agent.on('test:event', (data) => {
        received.push(data as string);
      });

      agent.eventBus.emit('test:event', 'hello');
      expect(received).toEqual(['hello']);

      unsubscribe();
      agent.eventBus.emit('test:event', 'world');
      expect(received).toEqual(['hello']); // unchanged after unsubscribe
    });

    it('fires on llm:before events', async () => {
      const agent = new Agent({ model: 'evt-mock/test' });
      const fired: string[] = [];

      agent.on('hook:llm.before', () => fired.push('fired'));
      // The hook manager fires 'hook:llm.before' events via eventBus
      agent.eventBus.emit('hook:llm.before');
      expect(fired).toContain('fired');
    });
  });

  describe('once()', () => {
    it('fires only once', () => {
      const agent = new Agent({ model: 'evt-mock/test' });
      const received: string[] = [];

      agent.once('test:once', (data) => {
        received.push(data as string);
      });

      agent.eventBus.emit('test:once', 'first');
      agent.eventBus.emit('test:once', 'second');

      expect(received).toEqual(['first']);
    });
  });

  describe('off()', () => {
    it('unsubscribes a specific handler', () => {
      const agent = new Agent({ model: 'evt-mock/test' });
      const received: string[] = [];

      const handler = (data?: unknown) => {
        received.push(data as string);
      };

      agent.on('test:off', handler);
      agent.eventBus.emit('test:off', 'a');
      expect(received).toEqual(['a']);

      agent.off('test:off', handler);
      agent.eventBus.emit('test:off', 'b');
      expect(received).toEqual(['a']); // stopped
    });

    it('does not affect other handlers for the same event', () => {
      const agent = new Agent({ model: 'evt-mock/test' });
      const received1: string[] = [];
      const received2: string[] = [];

      const handler1 = () => { received1.push('h1'); };
      const handler2 = () => { received2.push('h2'); };

      agent.on('test:multi', handler1);
      agent.on('test:multi', handler2);

      agent.off('test:multi', handler1);
      agent.eventBus.emit('test:multi');

      expect(received1).toEqual([]);
      expect(received2).toEqual(['h2']);
    });
  });
});
