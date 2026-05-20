import type { Processor, ProcessorContext, Message, PipelineContext } from '@primo-ai/sdk';

/** Tool declaration type matching AgentRegion.toolDeclarations. */
type ToolDeclaration = { name: string; description: string };

/**
 * Modifier functions create simple processors that mutate specific context fields.
 * These provide an OpenCode-style API for common extension patterns.
 */

type MessageModifierFn = (msgs: Message[], ctx: PipelineContext) => Message[];
type SystemPromptModifierFn = (prompt: string, ctx: PipelineContext) => string;
type ToolsModifierFn = (tools: ToolDeclaration[], ctx: PipelineContext) => ToolDeclaration[];
type ProviderOptionsModifierFn = (opts: Record<string, Record<string, unknown>>, ctx: PipelineContext) => Record<string, Record<string, unknown>>;

/**
 * Create a processor that modifies message history.
 * @param fn - Function that receives current messages and context, returns modified messages.
 * @returns Processor registered at 'invokeLLM' stage.
 */
export function message(fn: MessageModifierFn): Processor {
  return {
    stage: 'invokeLLM',
    async execute(ctx: ProcessorContext) {
      const history = ctx.state.session.messageHistory ?? [];
      ctx.state.session.messageHistory = fn(history, ctx.state);
    },
  };
}

/**
 * Create a processor that modifies the system prompt.
 * @param fn - Function that receives current prompt and context, returns modified prompt.
 * @returns Processor registered at 'buildContext' stage.
 */
export function systemPrompt(fn: SystemPromptModifierFn): Processor {
  return {
    stage: 'buildContext',
    async execute(ctx: ProcessorContext) {
      if (ctx.state.agent.config.systemPrompt) {
        ctx.state.agent.config.systemPrompt = fn(
          ctx.state.agent.config.systemPrompt as string,
          ctx.state,
        );
      }
    },
  };
}

/**
 * Create a processor that modifies tool declarations.
 * @param fn - Function that receives current tools and context, returns modified tools.
 * @returns Processor registered at 'prepareStep' stage.
 */
export function tools(fn: ToolsModifierFn): Processor {
  return {
    stage: 'prepareStep',
    async execute(ctx: ProcessorContext) {
      ctx.state.agent.toolDeclarations = fn(
        ctx.state.agent.toolDeclarations ?? [],
        ctx.state,
      );
    },
  };
}

/**
 * Create a processor that modifies provider options.
 * @param fn - Function that receives current options and context, returns modified options.
 * @returns Processor registered at 'invokeLLM' stage.
 */
export function providerOptions(fn: ProviderOptionsModifierFn): Processor {
  return {
    stage: 'invokeLLM',
    async execute(ctx: ProcessorContext) {
      ctx.state.agent.providerOptions = fn(
        ctx.state.agent.providerOptions ?? {},
        ctx.state,
      );
    },
  };
}

/**
 * Namespace export for convenient access.
 */
export const modifiers = {
  message,
  systemPrompt,
  tools,
  providerOptions,
};
