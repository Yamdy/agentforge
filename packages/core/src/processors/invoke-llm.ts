import type { Message, Processor, WrapHookInvoker } from '@agentforge/sdk';
import type { LLMInvoker } from '../llm-invoker.js';
import type { ToolRegistry } from '../tool-registry.js';
import { detectCapabilities } from '../provider-capabilities.js';
import { applyPreemptiveRules } from './provider-history-compat.js';

export interface InvokeLLMDeps {
  getLLM: (systemPrompt?: string) => Promise<LLMInvoker>;
  registry: ToolRegistry;
  pluginManager: WrapHookInvoker;
  modelString: string;
}

function toAiSdkMessages(history: Message[], input: string, step: number): unknown[] {
  const messages: unknown[] = [];

  // Include user input if not already present in history
  const hasUserMessage = history.some(m => m.role === 'user');
  if (!hasUserMessage) {
    messages.push({ role: 'user', content: [{ type: 'text', text: input }] });
  }

  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
    } else if (msg.role === 'assistant') {
      const content: unknown[] = [];
      if (msg.reasoningContent) {
        content.push({ type: 'reasoning', text: msg.reasoningContent });
      }
      content.push({ type: 'text', text: msg.content });
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          content.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input: tc.args });
        }
      }
      messages.push({ role: 'assistant', content });
    } else if (msg.role === 'tool') {
      const outputValue = msg.result ?? msg.content;
      const output = typeof outputValue === 'string'
        ? { type: 'text' as const, value: outputValue }
        : { type: 'json' as const, value: outputValue };
      messages.push({
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: msg.toolCallId, toolName: msg.toolName, output }],
      });
    }
  }

  return messages;
}

export function createInvokeLLMProcessor(deps: InvokeLLMDeps): Processor {
  return {
    stage: 'invokeLLM',
    execute: async (ctx) => {
      const systemPrompt = typeof ctx.agent.config.systemPrompt === 'string'
        ? ctx.agent.config.systemPrompt : undefined;
      const llm = await deps.getLLM(systemPrompt);
      const sdkToolSchemas = deps.registry.toAiSdkToolSchemas();

      deps.registry.setToolExecutionContext({
        span: {
          spanId: `tool-${ctx.request.sessionId}-${ctx.iteration.step}`,
          traceId: ctx.request.sessionId,
        },
        sessionId: ctx.request.sessionId,
        pluginManager: deps.pluginManager,
      });

      const messages = toAiSdkMessages(
        (ctx.session.messageHistory as Message[]) ?? [],
        ctx.request.input,
        ctx.iteration.step,
      );

      const capabilities = detectCapabilities(deps.modelString);
      const compatMessages = applyPreemptiveRules(messages, deps.modelString, capabilities);

      const handle = llm.stream({
        messages: compatMessages,
        tools: Object.keys(sdkToolSchemas).length > 0 ? sdkToolSchemas : undefined,
        providerOptions: ctx.agent.providerOptions,
      });

      return {
        ...ctx,
        iteration: {
          ...ctx.iteration,
          fullStream: handle.fullStream,
          usagePromise: handle.usage,
          reasoningPromise: handle.reasoning,
        },
      };
    },
  };
}
