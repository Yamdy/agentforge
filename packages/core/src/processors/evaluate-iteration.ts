import type { Processor, LoopDirective, TokenUsage, Message, ToolCall } from '@agentforge/sdk';
import type { EventBus } from '../event-bus.js';

export interface EvaluateIterationDeps {
  eventBus?: EventBus;
}

function collectCalledToolNames(history: Message[], pendingToolCalls?: ToolCall[]): Set<string> {
  const called = new Set<string>();
  for (const msg of history) {
    if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        called.add(tc.name);
      }
    }
  }
  if (pendingToolCalls) {
    for (const tc of pendingToolCalls) {
      called.add(tc.name);
    }
  }
  return called;
}

export function createEvaluateIterationProcessor(deps?: EvaluateIterationDeps): Processor {
  const eventBus = deps?.eventBus;
  let warnedUnknownTools = false;

  return {
    stage: 'evaluateIteration',
    execute: async (ctx) => {
      const prevTotal = ctx.session.totalTokenUsage ?? { input: 0, output: 0 };
      const iterUsage = ctx.iteration.tokenUsage ?? { input: 0, output: 0 };
      const totalTokenUsage: TokenUsage = {
        input: prevTotal.input + iterUsage.input,
        output: prevTotal.output + iterUsage.output,
      };

      const totalTokens = totalTokenUsage.input + totalTokenUsage.output;

      if (totalTokens > 100_000) {
        ctx.iteration.span?.setAttribute('token.overflow', true);
        ctx.iteration.span?.setAttribute('token.total', totalTokens);
        return {
          ...ctx,
          iteration: {
            ...ctx.iteration,
            loopDirective: { action: 'stop' } as LoopDirective,
          },
          session: {
            ...ctx.session,
            totalTokenUsage,
          },
        };
      }

      const requiredTools = ctx.agent.config.requiredTools;
      if (requiredTools && requiredTools.length > 0) {
        if (!warnedUnknownTools) {
          const registeredNames = new Set(ctx.agent.toolDeclarations.map(t => t.name));
          const unknown = requiredTools.filter(name => !registeredNames.has(name));
          if (unknown.length > 0) {
            eventBus?.emit('required_tools:unknown', {
              unknown,
              registered: [...registeredNames],
              step: ctx.iteration.step,
              sessionId: ctx.request.sessionId,
            });
            ctx.iteration.span?.setAttribute('required_tools.unknown', unknown.join(','));
          }
          warnedUnknownTools = true;
        }

        const calledTools = collectCalledToolNames(
          ctx.session.messageHistory ?? [],
          ctx.iteration.pendingToolCalls,
        );
        const uncalled = requiredTools.filter(name => !calledTools.has(name));

        if (uncalled.length > 0) {
          ctx.iteration.span?.setAttribute('required_tools.incomplete', true);
          ctx.iteration.span?.setAttribute('required_tools.uncalled', uncalled.join(','));
          eventBus?.emit('required_tools:incomplete', {
            uncalled,
            called: [...calledTools],
            step: ctx.iteration.step,
            sessionId: ctx.request.sessionId,
          });

          return {
            ...ctx,
            agent: {
              ...ctx.agent,
              promptFragments: [
                ...ctx.agent.promptFragments,
                `[system] Required tools not yet called: ${uncalled.join(', ')}. Please call them before finishing.`,
              ],
            },
            iteration: {
              ...ctx.iteration,
              loopDirective: { action: 'continue' } as LoopDirective,
            },
            session: {
              ...ctx.session,
              totalTokenUsage,
            },
          };
        }
      }

      const hasToolResults = (ctx.iteration.toolResults?.length ?? 0) > 0;
      const directive: LoopDirective = hasToolResults
        ? { action: 'continue' }
        : { action: 'stop' };

      return {
        ...ctx,
        iteration: {
          ...ctx.iteration,
          loopDirective: directive,
        },
        session: {
          ...ctx.session,
          totalTokenUsage,
        },
      };
    },
  };
}

/**
 * @deprecated Use `createEvaluateIterationProcessor({ eventBus })` for full functionality.
 */
export const evaluateIterationProcessor: Processor = createEvaluateIterationProcessor();
