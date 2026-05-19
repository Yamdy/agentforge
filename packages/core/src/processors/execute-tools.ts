import type { Processor, ProcessorContext, Message, ToolResult } from '@primo-ai/sdk';
import { SpanAttributeKeys, SpanType } from '@primo-ai/sdk';
import type { ToolRegistry } from '../tool-registry.js';

export function createExecuteToolsProcessor(registry: ToolRegistry): Processor {
  return {
    stage: 'executeTools',
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      const toolCalls = ctx.iteration.pendingToolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        return;
      }

      const toolResults: ToolResult[] = [];
      for (const tc of toolCalls) {
        const toolSpan = ctx.iteration.span?.startChild(SpanType.TOOL_EXECUTE);
        toolSpan?.setAttribute(SpanAttributeKeys.TOOL_NAME, tc.name);
        try {
          const result = await registry.executeTool(tc.name, tc.args, {
            toolCallId: tc.id,
            span: toolSpan ?? ctx.iteration.span,
            sessionId: ctx.request.sessionId,
          });
          const outputSize = typeof result.output === 'string'
            ? result.output.length
            : JSON.stringify(result.output ?? '').length;
          toolSpan?.setAttribute(SpanAttributeKeys.TOOL_RESULT_SIZE, outputSize);
          toolResults.push({ ...result, toolCallId: tc.id });
        } finally {
          toolSpan?.end();
        }
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
        const ext = msg as unknown as { mutated?: boolean; truncated?: boolean; validationError?: unknown };
        if (tr.mutated) ext.mutated = true;
        if (tr.truncated) ext.truncated = true;
        if (tr.validationError) ext.validationError = tr.validationError;
        return msg;
      });

      const history: Message[] = [...(ctx.session.messageHistory ?? [])];
      history.push(...toolMessages);

      ctx.iteration.pendingToolCalls = undefined;
      ctx.iteration.toolResults = toolResults;
      ctx.session.messageHistory = history;
    },
  };
}
