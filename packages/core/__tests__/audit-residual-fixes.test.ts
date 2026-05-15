import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool, Message, PipelineContext } from '@agentforge/sdk';
import { ToolRegistry } from '../src/tool-registry.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import { createExecuteToolsProcessor } from '../src/processors/execute-tools.js';
import { createEvaluateIterationProcessor } from '../src/processors/evaluate-iteration.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's-1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

function findToolMessage(history: Message[] | undefined): (Message & { role: 'tool'; content: string }) | undefined {
  if (!history) return undefined;
  return history.find(
    (m): m is Message & { role: 'tool'; content: string } => 'role' in m && m.role === 'tool',
  );
}

// ---------------------------------------------------------------------------
// R-1: outputSchema validation error should be visible in tool Message content
// R-4: mutated/truncated/validationError flags should propagate into Messages
// ---------------------------------------------------------------------------

describe('R-1/R-4: outputSchema validation + flag propagation', () => {
  it('R-1: validationError is included in tool Message content when outputSchema fails', async () => {
    const registry = new ToolRegistry();
    const badTool: Tool = {
      name: 'badOutput',
      description: 'Returns invalid output',
      inputSchema: z.object({}),
      outputSchema: z.object({ status: z.string() }),
      execute: async () => ({ wrong: 42 }),
    };
    registry.register(badTool);

    const result = await registry.executeTool('badOutput', {});
    expect(result.validationError).toBeDefined();
    expect(result.validationError).toContain('Output validation failed');

    // Now check that executeTools propagates validationError into the Message
    const processor = createExecuteToolsProcessor(registry);
    const ctx = makeCtx({
      iteration: {
        step: 0,
        pendingToolCalls: [{ id: 'tc-1', name: 'badOutput', args: {} }],
      },
    });
    const output = (await processor.execute(ctx)) as PipelineContext;
    const toolMsg = findToolMessage(output.session.messageHistory);
    expect(toolMsg).toBeDefined();
    // The tool message content should contain the validationError
    expect(toolMsg!.content).toContain('Output validation failed');
  });

  it('R-4: mutated flag propagates into tool Message', async () => {
    const registry = new ToolRegistry();
    const tool: Tool = {
      name: 'mutateMe',
      description: 'Output gets mutated by hook',
      inputSchema: z.object({}),
      execute: async () => 'original',
      allowOutputMutation: true,
    };
    registry.register(tool);

    const hookMgr = new HookManager(new EventBus());
    hookMgr.register({
      point: 'tool.after',
      handler: async (_input, output) => {
        (output as Record<string, unknown>).result = 'mutated!';
      },
    });
    (registry as any).hookManager = hookMgr;

    const result = await registry.executeTool('mutateMe', {});
    expect(result.mutated).toBe(true);
    expect(result.output).toBe('mutated!');

    // Now check propagation through executeTools
    const processor = createExecuteToolsProcessor(registry);
    const ctx = makeCtx({
      iteration: {
        step: 0,
        pendingToolCalls: [{ id: 'tc-2', name: 'mutateMe', args: {} }],
      },
    });
    const output = (await processor.execute(ctx)) as PipelineContext;
    const toolMsg = findToolMessage(output.session.messageHistory);
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe('mutated!');
    // The Message should carry the mutated flag
    expect((toolMsg as any).mutated).toBe(true);
  });

  it('R-4: truncated flag propagates into tool Message', async () => {
    const registry = new ToolRegistry({ maxOutputLength: 10 });
    const tool: Tool = {
      name: 'longOutput',
      description: 'Returns long output',
      inputSchema: z.object({}),
      execute: async () => 'a'.repeat(100),
    };
    registry.register(tool);

    const result = await registry.executeTool('longOutput', {});
    expect(result.truncated).toBe(true);

    // Check propagation through executeTools
    const processor = createExecuteToolsProcessor(registry);
    const ctx = makeCtx({
      iteration: {
        step: 0,
        pendingToolCalls: [{ id: 'tc-3', name: 'longOutput', args: {} }],
      },
    });
    const output = (await processor.execute(ctx)) as PipelineContext;
    const toolMsg = findToolMessage(output.session.messageHistory);
    expect(toolMsg).toBeDefined();
    expect((toolMsg as any).truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-6: Required tools exhausted should set iteration.response, not empty
// ---------------------------------------------------------------------------

describe('F-6: Required tools exhausted response', () => {
  it('exhausted branch sets iteration.response with error message', async () => {
    const processor = createEvaluateIterationProcessor();
    const toolDecl = { name: 'requiredTool', description: 'must be called', inputSchema: {} };

    // Simulate REQUIRED_TOOLS_MAX_RETRIES (3) iterations where the tool is never called
    let lastResult: PipelineContext = makeCtx({
      agent: {
        config: { model: 'mock/test', requiredTools: ['requiredTool'] },
        promptFragments: [],
        toolDeclarations: [toolDecl],
      },
      iteration: { step: 0 },
    });

    for (let step = 0; step < 3; step++) {
      lastResult = (await processor.execute({
        ...lastResult,
        iteration: { step },
      })) as PipelineContext;
    }

    // After 3 retries, the exhausted branch should trigger
    expect(lastResult.iteration.loopDirective?.action).toBe('stop');
    // The response must NOT be empty — it should contain an error indicator
    expect(lastResult.iteration.response).toBeDefined();
    expect(lastResult.iteration.response).not.toBe('');
    expect(lastResult.iteration.response).toContain('exhausted');
  });
});
