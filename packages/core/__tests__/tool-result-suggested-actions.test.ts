import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool, Message, PipelineContext, ProcessorContext, ToolResult, ToolResultBlock, ToolExecutionContext } from '@primo-ai/sdk';
import { ToolRegistry } from '../src/tool-registry.js';
import { ProcessorContextImpl } from '../src/processor-context.js';
import { createExecuteToolsProcessor } from '../src/processors/execute-tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { input: 'test', sessionId: 's-1', custom: {} },
    ...overrides,
  };
}

function makeProcessorContext(overrides?: Partial<PipelineContext>): ProcessorContext {
  return new ProcessorContextImpl(makeCtx(overrides));
}

function findToolMessage(history: Message[] | undefined): (Message & { role: 'tool'; content: string }) | undefined {
  if (!history) return undefined;
  return history.find(
    (m): m is Message & { role: 'tool'; content: string } => 'role' in m && m.role === 'tool',
  );
}

// ---------------------------------------------------------------------------
// F-6: suggestedActions field on ToolResult, ToolResultBlock, and tool-role Message
// ---------------------------------------------------------------------------

describe('F-6: suggestedActions field', () => {
  // -------------------------------------------------------------------------
  // SDK type-level: ToolResult accepts suggestedActions
  // -------------------------------------------------------------------------
  describe('ToolResult interface', () => {
    it('should accept suggestedActions field on ToolResult', () => {
      const tr: ToolResult = {
        toolCallId: 'tc-1',
        name: 'grep',
        output: 'match found',
        suggestedActions: ['Use file_read to view matched files', 'Refine pattern to reduce results'],
      };
      expect(tr.suggestedActions).toEqual([
        'Use file_read to view matched files',
        'Refine pattern to reduce results',
      ]);
    });

    it('should be undefined when not provided (backward compat)', () => {
      const tr: ToolResult = {
        toolCallId: 'tc-1',
        name: 'echo',
        output: 'hello',
      };
      expect(tr.suggestedActions).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // SDK type-level: ToolResultBlock accepts suggestedActions
  // -------------------------------------------------------------------------
  describe('ToolResultBlock interface', () => {
    it('should accept suggestedActions field on ToolResultBlock', () => {
      const block: ToolResultBlock = {
        type: 'tool-result',
        toolCallId: 'tc-1',
        name: 'grep',
        output: 'match found',
        suggestedActions: ['Use file_read to view matched files'],
      };
      expect(block.suggestedActions).toEqual(['Use file_read to view matched files']);
    });

    it('should be undefined when not provided (backward compat)', () => {
      const block: ToolResultBlock = {
        type: 'tool-result',
        toolCallId: 'tc-1',
        name: 'echo',
        output: 'hello',
      };
      expect(block.suggestedActions).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // SDK type-level: tool-role Message accepts suggestedActions
  // -------------------------------------------------------------------------
  describe('tool-role Message type', () => {
    it('should accept suggestedActions on tool-role Message', () => {
      const msg: Message = {
        role: 'tool',
        content: '3 matches',
        toolCallId: 'tc-1',
        toolName: 'grep',
        suggestedActions: ['Refine pattern to reduce results'],
      };
      // Type narrowing — only tool-role messages have toolCallId
      if (msg.role === 'tool') {
        expect((msg as { suggestedActions?: string[] }).suggestedActions).toEqual([
          'Refine pattern to reduce results',
        ]);
      }
    });

    it('should be undefined when not provided (backward compat)', () => {
      const msg: Message = {
        role: 'tool',
        content: 'hello',
        toolCallId: 'tc-1',
        toolName: 'echo',
      };
      if (msg.role === 'tool') {
        expect((msg as { suggestedActions?: string[] }).suggestedActions).toBeUndefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // execute-tools processor: propagates suggestedActions from tool output
  // -------------------------------------------------------------------------
  describe('execute-tools processor propagation', () => {
    it('should propagate suggestedActions from ToolResult into tool-role Message', async () => {
      const registry = new ToolRegistry();
      const suggestTool: Tool = {
        name: 'suggestTool',
        description: 'A tool that returns suggestedActions',
        inputSchema: z.object({}),
        execute: async () => 'done',
      };
      registry.register(suggestTool);

      // Override executeTool to return a ToolResult with suggestedActions
      const originalExecute = registry.executeTool.bind(registry);
      registry.executeTool = async (name: string, args: Record<string, unknown>, context?: ToolExecutionContext & { toolCallId?: string }) => {
        const result = await originalExecute(name, args, context as Parameters<typeof originalExecute>[2]);
        if (name === 'suggestTool') {
          return {
            ...result,
            suggestedActions: ['Try this next', 'Or try that'],
          };
        }
        return result;
      };

      const processor = createExecuteToolsProcessor(registry);
      const pCtx = makeProcessorContext({
        iteration: {
          step: 0,
          pendingToolCalls: [{ id: 'tc-1', name: 'suggestTool', args: {} }],
        },
      });

      await processor.execute(pCtx);

      // Check that toolResults have suggestedActions
      const toolResults = pCtx.state.iteration.toolResults;
      expect(toolResults).toBeDefined();
      expect(toolResults![0].suggestedActions).toEqual(['Try this next', 'Or try that']);

      // Check that tool-role Message has suggestedActions
      const toolMsg = findToolMessage(pCtx.state.session.messageHistory);
      expect(toolMsg).toBeDefined();
      expect((toolMsg as unknown as { suggestedActions?: string[] }).suggestedActions).toEqual([
        'Try this next',
        'Or try that',
      ]);
    });

    it('should leave suggestedActions undefined when tool does not provide them', async () => {
      const registry = new ToolRegistry();
      const plainTool: Tool = {
        name: 'plainTool',
        description: 'A tool with no suggestedActions',
        inputSchema: z.object({}),
        execute: async () => 'plain result',
      };
      registry.register(plainTool);

      const processor = createExecuteToolsProcessor(registry);
      const pCtx = makeProcessorContext({
        iteration: {
          step: 0,
          pendingToolCalls: [{ id: 'tc-2', name: 'plainTool', args: {} }],
        },
      });

      await processor.execute(pCtx);

      const toolResults = pCtx.state.iteration.toolResults;
      expect(toolResults).toBeDefined();
      expect(toolResults![0].suggestedActions).toBeUndefined();

      const toolMsg = findToolMessage(pCtx.state.session.messageHistory);
      expect(toolMsg).toBeDefined();
      expect((toolMsg as unknown as { suggestedActions?: string[] }).suggestedActions).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // grep tool: returns suggestedActions when matches found
  // -------------------------------------------------------------------------
  describe('grep tool suggestedActions', () => {
    it('should include suggestedActions when matches are found', async () => {
      // Create a mock grep-like tool that returns suggestedActions
      const mockGrepTool: Tool = {
        name: 'mockGrep',
        description: 'Mock grep tool',
        inputSchema: z.object({ pattern: z.string() }),
        execute: async () => ({
          matches: [{ file: 'test.ts', line: 1, text: 'export' }],
          count: 1,
          suggestedActions: ['Use file_read to view matched files', 'Refine pattern to reduce results'],
        }),
      };

      const registry = new ToolRegistry();
      registry.register(mockGrepTool);

      const toolResult = await registry.executeTool('mockGrep', { pattern: 'test' });
      expect(toolResult.suggestedActions).toBeDefined();
      expect(toolResult.suggestedActions).toContain('Use file_read to view matched files');
      expect(toolResult.suggestedActions).toContain('Refine pattern to reduce results');
    });
  });

  // -------------------------------------------------------------------------
  // glob tool: returns suggestedActions
  // -------------------------------------------------------------------------
  describe('glob tool suggestedActions', () => {
    it('should include suggestedActions when files are found', async () => {
      // Create a mock glob-like tool that returns suggestedActions
      const mockGlobTool: Tool = {
        name: 'mockGlob',
        description: 'Mock glob tool',
        inputSchema: z.object({ pattern: z.string() }),
        execute: async () => ({
          files: ['test.ts', 'foo.ts'],
          count: 2,
          suggestedActions: ['Use file_read to view file contents'],
        }),
      };

      const registry = new ToolRegistry();
      registry.register(mockGlobTool);

      const toolResult = await registry.executeTool('mockGlob', { pattern: '*.ts' });
      expect(toolResult.suggestedActions).toBeDefined();
      expect(toolResult.suggestedActions).toContain('Use file_read to view file contents');
    });
  });
});
