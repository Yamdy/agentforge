import type { Processor, Message, ToolResult } from '@agentforge/sdk';
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

      const toolMessages: Message[] = toolResults.map((tr) => {
        let content = tr.error ?? (typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output));
        if (tr.validationError && !tr.error) {
          content = `[Warning: ${tr.validationError}]\n${content}`;
        }
        const msg: Message = {
          role: 'tool' as const,
          content,
          toolCallId: tr.toolCallId,
          toolName: tr.name,
          result: tr.output,
          error: tr.error,
        };
        if (tr.mutated) (msg as any).mutated = true;
        if (tr.truncated) (msg as any).truncated = true;
        if (tr.validationError) (msg as any).validationError = tr.validationError;
        return msg;
      });

      const history: Message[] = [...(ctx.session.messageHistory ?? [])];
      history.push(...toolMessages);

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
