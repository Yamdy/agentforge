import type { Message, PipelineContext, Processor, ProcessorContext } from '@primo-ai/sdk';
import type { LLMInvoker } from '../llm-invoker.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { HookManager } from '../hook-manager.js';
import { detectCapabilities } from '../provider-capabilities.js';
import { applyPreemptiveRules } from './provider-history-compat.js';
import { jsonSchema } from 'ai';

function isZodSchema(value: unknown): value is { safeParse: (args: unknown) => { success: boolean } } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'safeParse' in value &&
    typeof (value as Record<string, unknown>).safeParse === 'function'
  );
}

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

function toAiSdkMessages(history: Message[], input: string, _step: number): unknown[] {
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

function resolveSystemPrompt(ctx: PipelineContext): string | undefined {
  const agentExt = ctx.agent as unknown as { systemPrompt?: string; _assembledFragmentCount?: number };
  const assembled = agentExt.systemPrompt;
  const base = assembled
    ?? (typeof ctx.agent.config.systemPrompt === 'string' ? ctx.agent.config.systemPrompt : undefined);

  // Context builder records how many promptFragments were baked into the assembled prompt.
  // Any fragments beyond that count were added during the loop (e.g., by evaluateIteration).
  const assembledCount = agentExt._assembledFragmentCount ?? 0;
  const currentFragments = ctx.agent.promptFragments ?? [];
  const newFragments = currentFragments.slice(assembledCount);

  if (!base && newFragments.length === 0) return undefined;
  const parts: string[] = [];
  if (base) parts.push(base);
  if (newFragments.length > 0) parts.push(...newFragments);
  return parts.join('\n\n');
}

function resolveToolSchemas(ctx: PipelineContext, registry: ToolRegistry): Record<string, unknown> | undefined {
  const declarations = ctx.agent.toolDeclarations;
  if (declarations && declarations.length > 0) {
    const schemas: Record<string, { description: string; inputSchema: unknown }> = {};
    for (const decl of declarations) {
      const tool = registry.get(decl.name);
      if (tool) {
        const schema = isZodSchema(tool.inputSchema)
          ? tool.inputSchema
          : jsonSchema(tool.inputSchema as Record<string, unknown>);
        schemas[decl.name] = {
          description: decl.description ?? tool.description,
          inputSchema: schema,
        };
      }
    }
    return Object.keys(schemas).length > 0 ? schemas : undefined;
  }
  const registrySchemas = registry.toAiSdkToolSchemas();
  return Object.keys(registrySchemas).length > 0 ? registrySchemas : undefined;
}

export function createInvokeLLMProcessor(deps: InvokeLLMDeps): Processor {
  return {
    stage: 'invokeLLM',
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      const systemPrompt = resolveSystemPrompt(ctx);
      const llm = await deps.getLLM(systemPrompt);

      if (ctx.iteration.span) {
        ctx.iteration.span.setAttribute('model', deps.modelString);
      }

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

      const toolSchemas = resolveToolSchemas(ctx, deps.registry);

      const llmInput = {
        model: deps.modelString,
        messages: compatMessages,
        tools: toolSchemas,
        options: ctx.agent.providerOptions,
      };
      const llmOutput: Record<string, unknown> = {};

      await deps.hookManager.invoke('llm.before', llmInput, llmOutput);

      const handle = llm.stream({
        messages: validateLlmHookOutput(llmOutput.messages, llmInput.messages),
        tools: (llmOutput.tools ?? llmInput.tools) as Record<string, unknown> | undefined,
        providerOptions: ctx.agent.providerOptions,
      });

      ctx.iteration.fullStream = handle.fullStream;
      ctx.iteration.usagePromise = handle.usage;
      ctx.iteration.reasoningPromise = handle.reasoning;
      (ctx.iteration as unknown as { _modelString?: string })._modelString = deps.modelString;
    },
  };
}
