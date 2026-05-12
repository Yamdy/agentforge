import type { Processor, Message, ToolCall, ToolResult } from '@agentforge/sdk';
import type { ToolRegistry } from '../tool-registry.js';

export function createExecuteToolsProcessor(registry: ToolRegistry): Processor {
  return {
    stage: 'executeTools',
    execute: async (ctx) => {
      const toolCalls = ctx.iteration.pendingToolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        return ctx;
      }

      const toolResults: ToolResult[] = [];
      for (const tc of toolCalls) {
        const result = await registry.executeTool(tc.name, tc.args, {
          toolCallId: tc.id,
          span: ctx.iteration.span,
          sessionId: ctx.request.sessionId,
        });
        toolResults.push({ ...result, toolCallId: tc.id });
      }

      const assistantMsg: Message = {
        role: 'assistant',
        content: ctx.iteration.response ?? '',
        toolCalls,
      };

      const toolMessages: Message[] = toolResults.map((tr) => ({
        role: 'tool' as const,
        content: tr.error ?? (typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output)),
        toolCallId: tr.toolCallId,
        toolName: tr.name,
        result: tr.output,
        error: tr.error,
      }));

      const history: Message[] = [...(ctx.session.messageHistory ?? [])];

      if (ctx.iteration.step === 0 && history.length === 0) {
        history.push({ role: 'user', content: ctx.request.input });
      }

      history.push(assistantMsg, ...toolMessages);

      return {
        ...ctx,
        iteration: {
          ...ctx.iteration,
          pendingToolCalls: undefined,
          toolResults,
        },
        session: {
          ...ctx.session,
          messageHistory: history,
        },
      };
    },
  };
}
