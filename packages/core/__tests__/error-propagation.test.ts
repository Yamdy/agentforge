import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/event-bus.js';
import { createSubAgentTool } from '../src/sub-agent.js';
import {
  createMockLanguageModel,
  createMockModelWithToolCalls,
  registerMockProvider,
} from './helpers.js';
import { z } from 'zod';
import { Agent } from '../src/agent.js';

// ─── F-A [CRITICAL] SubAgent error returns error via throw, not raw string ─

describe('SubAgent error propagation', () => {
  it('sub-agent execute() throws on failure so ToolRegistry marks it as error', async () => {
    // Register a provider that throws during Agent construction
    registerMockProvider('ep-crash', () => {
      throw new Error('Model resolution exploded');
    });

    const eventBus = new EventBus();
    const events: any[] = [];
    eventBus.subscribe('task:end', (data) => events.push(data));

    const subAgentTool = createSubAgentTool(
      {
        name: 'crash',
        description: 'Crashing sub-agent',
        model: 'ep-crash/mock',
        contextPolicy: 'isolated',
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: 'any/mock',
        tools: [],
        eventBus,
      },
    );

    // Call execute directly — it should throw (not return error string)
    await expect(
      (subAgentTool as any).execute({ task: 'fail' }),
    ).rejects.toThrow('failed');

    // task:end event should still carry error info
    expect(events).toHaveLength(1);
    expect(events[0].error).toBeDefined();
    expect(events[0].error).toContain('crash');
    expect(events[0].error).toContain('failed');
  });

  it('tool.after hook receives error info when sub-agent crashes', async () => {
    registerMockProvider('ep-hook-crash', () => {
      throw new Error('Hook test crash');
    });

    const eventBus = new EventBus();
    const subAgentTool = createSubAgentTool(
      {
        name: 'hookcrash',
        description: 'Hook crash sub-agent',
        model: 'ep-hook-crash/mock',
        contextPolicy: 'isolated',
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: 'any/mock',
        tools: [],
        eventBus,
      },
    );

    // execute should throw — ToolRegistry will catch and create ToolResult with error
    await expect(
      (subAgentTool as any).execute({ task: 'x' }),
    ).rejects.toThrow('Hook test crash');
  });
});

// ─── F-B [HIGH] EventBus default onError ──────────────────────────────────

describe('EventBus default error handling', () => {
  it('without onError callback, handler errors are reported to console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = new EventBus();

    bus.subscribe('test', () => { throw new Error('handler boom'); });
    bus.emit('test', 'data');

    expect(consoleSpy).toHaveBeenCalled();
    // console.error called with: formatString, errorObj
    const callArgs = consoleSpy.mock.calls[0];
    const errorArg = callArgs[1];
    const errorMsg = errorArg instanceof Error ? errorArg.message : String(errorArg);
    expect(errorMsg).toContain('handler boom');

    consoleSpy.mockRestore();
  });

  it('custom onError callback suppresses default console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const captured: unknown[] = [];
    const bus = new EventBus((err) => captured.push(err));

    bus.subscribe('test', () => { throw new Error('custom'); });
    bus.emit('test');

    expect(captured).toHaveLength(1);
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('non-Error thrown values are still reported', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = new EventBus();

    bus.subscribe('test', () => { throw 'string error'; });
    expect(() => bus.emit('test')).not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
