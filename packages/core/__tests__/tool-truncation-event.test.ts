import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tool-registry.js';
import { EventBus } from '../src/event-bus.js';
import type { Tool } from '@agentforge/sdk';

/**
 * F-13: Tool output truncation should emit a 'tool:output_truncated' event
 * so that truncation is observable.
 */
describe('F-13: tool output truncation event', () => {
  it('emits tool:output_truncated when string output is truncated', async () => {
    const eventBus = new EventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('tool:output_truncated', (data) => {
      events.push({ type: 'tool:output_truncated', data });
    });

    const registry = new ToolRegistry({ maxOutputLength: 10 });
    registry.setEventBus(eventBus);

    const tool: Tool = {
      name: 'long_output',
      description: 'Returns long output',
      inputSchema: {},
      execute: async () => 'a'.repeat(100),
    };
    registry.register(tool);

    const result = await registry.executeTool('long_output', {});

    expect(result.truncated).toBe(true);
    expect(result.output).toBe('aaaaaaaaaa... [truncated]');
    expect(events).toHaveLength(1);
    expect((events[0].data as Record<string, unknown>).toolName).toBe('long_output');
    expect((events[0].data as Record<string, unknown>).originalSize).toBe(100);
    expect((events[0].data as Record<string, unknown>).truncatedSize).toBeLessThan(100);
  });

  it('does not emit truncation event when output fits within limit', async () => {
    const eventBus = new EventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('tool:output_truncated', (data) => {
      events.push({ type: 'tool:output_truncated', data });
    });

    const registry = new ToolRegistry({ maxOutputLength: 1000 });
    registry.setEventBus(eventBus);

    const tool: Tool = {
      name: 'short_output',
      description: 'Returns short output',
      inputSchema: {},
      execute: async () => 'short',
    };
    registry.register(tool);

    const result = await registry.executeTool('short_output', {});

    expect(result.truncated).toBeFalsy();
    expect(events).toHaveLength(0);
  });

  it('emits truncation event when JSON output exceeds limit', async () => {
    const eventBus = new EventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('tool:output_truncated', (data) => {
      events.push({ type: 'tool:output_truncated', data });
    });

    const registry = new ToolRegistry({ maxOutputLength: 20 });
    registry.setEventBus(eventBus);

    const largeObject = { data: 'x'.repeat(100) };
    const tool: Tool = {
      name: 'json_output',
      description: 'Returns large JSON',
      inputSchema: {},
      execute: async () => largeObject,
    };
    registry.register(tool);

    const result = await registry.executeTool('json_output', {});

    expect(result.truncated).toBe(true);
    expect(events).toHaveLength(1);
    expect((events[0].data as Record<string, unknown>).toolName).toBe('json_output');
  });
});
