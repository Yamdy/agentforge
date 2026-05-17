import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool, Message, PipelineContext, TokenCounter } from '@primo-ai/sdk';
import { ToolRegistry } from '../src/tool-registry.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import { createExecuteToolsProcessor } from '../src/processors/execute-tools.js';
import { createEvaluateIterationProcessor } from '../src/processors/evaluate-iteration.js';
import { processStepOutputProcessor } from '../src/processors/process-step-output.js';
import { createSubAgentTool } from '../src/sub-agent.js';
import { ContextBuilder } from '../src/context-builder.js';

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
    (registry as unknown as { hookManager: HookManager }).hookManager = hookMgr;

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
    expect((toolMsg as { mutated: boolean }).mutated).toBe(true);
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
    expect((toolMsg as { truncated: boolean }).truncated).toBe(true);
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

// ---------------------------------------------------------------------------
// F-7: processStepOutput user message detection unreliable with memory
// ---------------------------------------------------------------------------

describe('F-7: processStepOutput user message detection', () => {
  it('adds user input even when history already has user messages from memory', async () => {
    // Simulate: memory injection already prepended user messages to history
    const memoryUserMsg: Message = { role: 'user', content: 'remembered fact' };
    const ctx = makeCtx({
      request: { input: 'actual user question', sessionId: 's-1' },
      iteration: { step: 0, response: 'assistant reply' },
      session: {
        messageHistory: [memoryUserMsg],
        custom: {},
      },
    });

    const result = (await processStepOutputProcessor.execute(ctx)) as PipelineContext;
    const history = result.session.messageHistory!;

    // Both the memory user message AND the actual request input should be present
    const userMessages = history.filter(m => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
    expect(userMessages.map(m => m.content)).toContain('actual user question');
  });
});

// ---------------------------------------------------------------------------
// F-9: Sub-agent error should preserve original error, not wrap as new Error
// ---------------------------------------------------------------------------

describe('F-9: Sub-agent error propagation', () => {
  it('sub-agent error preserves original cause chain', async () => {
    const events: { type: string; data: unknown }[] = [];
    const fakeEventBus = {
      emit: (type: string, data: unknown) => { events.push({ type, data }); },
    };

    const toolDef = createSubAgentTool(
      { name: 'failing-agent', model: 'nonexistent/model', contextPolicy: 'isolated' },
      { model: 'test/model', tools: [], eventBus: fakeEventBus },
    );

    // Directly call execute to check the thrown error's cause chain
    const tool = toolDef as unknown as { execute: (input: { task: string }, context?: Record<string, unknown>) => Promise<string> };
    let caught: Error | undefined;
    try {
      await tool.execute({ task: 'do something' }, {});
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toContain('failing-agent');
    // The original error should be preserved as cause
    expect((caught as { cause: unknown }).cause).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// F-10: Compression strategy should verify post-compression budget
// ---------------------------------------------------------------------------

describe('F-10: ContextBuilder post-compression budget check', () => {
  it('re-applies compression when result still exceeds budget', async () => {
    const registry = new ToolRegistry();
    // A compression strategy that only removes 1 message per call,
    // so multiple passes are needed for large histories
    let callCount = 0;
    const lazyStrategy = (_messages: Message[], _tc: TokenCounter, _budget: number) => {
      callCount++;
      // Only trim 1 message per call — simulates conservative compression
      return Promise.resolve(_messages.slice(0, -1));
    };

    const tc = {
      count: (text: string) => text.length,
      countMessages: (msgs: Message[]) => msgs.reduce((sum, m) => sum + m.content.length, 0),
    };

    const builder = new ContextBuilder({
      registry,
      tokenCounter: tc as unknown as TokenCounter,
      compressionStrategy: lazyStrategy,
      budget: { maxTokens: 20 },
    });

    // Create history that needs multiple compression passes
    // Each message is 10 chars, 5 messages = 50 tokens, budget is 20
    const history: Message[] = Array.from({ length: 5 }, (_, i) => ({
      role: 'user' as const,
      content: `msg-${i}----`, // 10 chars each
    }));

    const ctx: PipelineContext = {
      request: { input: 'test', sessionId: 's-1' },
      agent: { config: { model: 'test/m' }, promptFragments: [], toolDeclarations: [], systemPrompt: '' },
      iteration: { step: 0 },
      session: { messageHistory: history, custom: {} },
    };

    const result = await builder.assemble(ctx);
    const resultHistory = result.session.messageHistory!;
    const resultTokens = resultHistory.reduce((sum, m) => sum + m.content.length, 0);

    // After compression, the result must fit within budget
    expect(resultTokens).toBeLessThanOrEqual(20);
    // The lazy strategy should have been called multiple times
    expect(callCount).toBeGreaterThan(1);
  });
});
