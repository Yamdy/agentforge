import type { Message, Processor } from '@agentforge/sdk';
import type { LLMInvoker } from '../llm-invoker.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { HookManager } from '../hook-manager.js';
import { detectCapabilities } from '../provider-capabilities.js';
import { applyPreemptiveRules } from './provider-history-compat.js';

export function validateLlmHookOutput(hookMessages: unknown, original: unknown[]): unknown[] {
  if (!Array.isArray(hookMessages) || hookMessages.length === 0) return original;
  return hookMessages;
}

export interface InvokeLLMDeps {
  getLLM: (systemPrompt?: string) => Promise<LLMInvoker>;
  registry: ToolRegistry;
  hookManager: HookManager;
  modelString: string;
}

function toAiSdkMessages(history: Message[], input: string, step: number): unknown[] {
  const messages: unknown[] = [];

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
      });

      const messages = toAiSdkMessages(
        (ctx.session.messageHistory as Message[]) ?? [],
        ctx.request.input,
        ctx.iteration.step,
      );

      const capabilities = detectCapabilities(deps.modelString);
      const compatMessages = applyPreemptiveRules(messages, deps.modelString, capabilities);

      const llmInput = {
        model: deps.modelString,
        messages: compatMessages,
        tools: Object.keys(sdkToolSchemas).length > 0 ? sdkToolSchemas : undefined,
        options: ctx.agent.providerOptions,
      };
      const llmOutput: Record<string, unknown> = {};

      await deps.hookManager.invoke('llm.before', llmInput, llmOutput);

      const handle = llm.stream({
        messages: validateLlmHookOutput(llmOutput.messages, llmInput.messages),
        tools: (llmOutput.tools ?? llmInput.tools) as Record<string, unknown> | undefined,
        providerOptions: ctx.agent.providerOptions,
      });

      const result = {
        ...ctx,
        iteration: {
          ...ctx.iteration,
          fullStream: handle.fullStream,
          usagePromise: handle.usage,
          reasoningPromise: handle.reasoning,
          _modelString: deps.modelString,
        },
      };

      return result;
    },
  };
}
