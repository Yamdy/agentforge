import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool } from '@agentforge/sdk';
import { ToolRegistry } from '../src/tool-registry.js';
import { EventBus } from '../src/event-bus.js';
import { HookManager } from '../src/hook-manager.js';

/**
 * F-E RED tests: tool.after hook can mutate output, bypassing outputSchema validation.
 * Validation should run AFTER hook mutation, not before.
 */

function makeToolWithOutputSchema(allowMutation = false): Tool {
  return {
    name: 'validated_tool',
    description: 'A tool with output schema',
    inputSchema: z.object({ x: z.number() }),
    outputSchema: z.object({ value: z.number(), label: z.string() }),
    allowOutputMutation: allowMutation,
    execute: async ({ x }: { x: number }) => ({
      value: x * 2,
      label: `double of ${x}`,
    }),
  };
}

describe('F-E: outputSchema validation after hook mutation', () => {
  it('detects schema violation caused by tool.after hook mutation', async () => {
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const hm = new HookManager(bus);
    registry.setHookManager(hm);
    registry.setEventBus(bus);

    const tool = makeToolWithOutputSchema(true);
    registry.register(tool as any);

    // Hook changes the output to violate the schema (string where number expected)
    hm.register({
      point: 'tool.after',
      handler: (_input, output) => {
        (output as Record<string, unknown>).result = {
          value: 'NOT_A_NUMBER', // violates outputSchema (expects number)
          label: 'corrupted',
        };
      },
    });

    const events: { type: string; data: unknown }[] = [];
    bus.subscribe('tool:output_invalid', (data) => {
      events.push({ type: 'tool:output_invalid', data });
    });

    const result = await registry.executeTool('validated_tool', { x: 5 });

    // The hook mutated the output to violate the schema.
    // Currently this will FAIL — validation runs before the hook, so the
    // violation goes undetected and result.output contains the invalid data.
    expect(events.length).toBe(1);
    expect(result.validationError).toBeDefined();
  });

  it('emits tool:output_invalid when hook changes valid output to invalid', async () => {
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const hm = new HookManager(bus);
    registry.setHookManager(hm);
    registry.setEventBus(bus);

    registry.register(makeToolWithOutputSchema(true) as any);

    const invalidEvents: unknown[] = [];
    bus.subscribe('tool:output_invalid', (data) => invalidEvents.push(data));

    hm.register({
      point: 'tool.after',
      handler: (_input, output) => {
        // Remove required field 'label' — violates schema
        (output as Record<string, unknown>).result = { value: 42 };
      },
    });

    const result = await registry.executeTool('validated_tool', { x: 5 });

    // Should detect the schema violation from the mutated output
    expect(invalidEvents.length).toBeGreaterThan(0);
  });

  it('passes through when hook does not mutate', async () => {
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const hm = new HookManager(bus);
    registry.setHookManager(hm);
    registry.setEventBus(bus);

    registry.register(makeToolWithOutputSchema(false) as any);

    const invalidEvents: unknown[] = [];
    bus.subscribe('tool:output_invalid', (data) => invalidEvents.push(data));

    // Hook tries to mutate but allowOutputMutation is false
    hm.register({
      point: 'tool.after',
      handler: (_input, output) => {
        (output as Record<string, unknown>).result = { value: 'BAD' };
      },
    });

    const result = await registry.executeTool('validated_tool', { x: 5 });

    // Original valid output preserved, no validation error
    expect(invalidEvents.length).toBe(0);
    expect(result.validationError).toBeUndefined();
    expect((result.output as any).value).toBe(10);
  });
});
