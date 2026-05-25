import type { Processor, ProcessorContext, ProcessorResult, LoopDirective, TokenUsage, Message, ToolCall } from '@primo-ai/sdk';
import type { EventBus } from '../event-bus.js';

export interface EvaluateIterationDeps {
  eventBus?: EventBus;
  /** Maximum total tokens before stopping the loop. Defaults to 100_000. */
  maxTotalTokens?: number;
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

const REQUIRED_TOOLS_MAX_RETRIES = 3;

export function createEvaluateIterationProcessor(deps?: EvaluateIterationDeps): Processor {
  const eventBus = deps?.eventBus;
  const maxTotalTokens = deps?.maxTotalTokens ?? 100_000;
  let warnedUnknownTools = false;
  const failCounts: Record<string, number> = {};

  return {
    stage: 'evaluateIteration',
    execute: async (pCtx: ProcessorContext): Promise<ProcessorResult> => {
      const ctx = pCtx.state;
      const prevTotal = ctx.session.totalTokenUsage ?? { input: 0, output: 0 };
      const iterUsage = ctx.iteration.tokenUsage;
      if (!iterUsage) {
        eventBus?.emit('token:usage_unavailable', { step: ctx.iteration.step });
      }
      const safeUsage = iterUsage ?? { input: 0, output: 0 };
      const totalTokenUsage: TokenUsage = {
        input: prevTotal.input + safeUsage.input,
        output: prevTotal.output + safeUsage.output,
      };

      const totalTokens = totalTokenUsage.input + totalTokenUsage.output;

      const requiredTools = ctx.agent.config.requiredTools;

      if (totalTokens > maxTotalTokens) {
        pCtx.span?.setAttribute('token.overflow', true);
        pCtx.span?.setAttribute('token.total', totalTokens);

        // Emit unsatisfied if required tools are not all called
        if (requiredTools && requiredTools.length > 0) {
          const calledTools = collectCalledToolNames(
            ctx.session.messageHistory ?? [],
            ctx.iteration.pendingToolCalls,
          );
          const uncalled = requiredTools.filter(name => !calledTools.has(name));
          if (uncalled.length > 0) {
            eventBus?.emit('required_tools:unsatisfied', {
              uncalled,
              reason: 'token_overflow',
              step: ctx.iteration.step,
              sessionId: ctx.session.sessionId,
            });
          }
        }

        ctx.iteration.loopDirective = { action: 'stop' } as LoopDirective;
        ctx.session.totalTokenUsage = totalTokenUsage;
        return {
          status: 'warning',
          summary: `Token budget exceeded: ${totalTokens} > ${maxTotalTokens}. Stopping loop.`,
        };
      }

      if (requiredTools && requiredTools.length > 0) {
        if (!warnedUnknownTools) {
          const registeredNames = new Set(ctx.agent.toolDeclarations.map(t => t.name));
          const unknown = requiredTools.filter(name => !registeredNames.has(name));
          if (unknown.length > 0) {
            eventBus?.emit('required_tools:unknown', {
              unknown,
              registered: [...registeredNames],
              step: ctx.iteration.step,
              sessionId: ctx.session.sessionId,
            });
            pCtx.span?.setAttribute('required_tools.unknown', unknown.join(','));
          }
          warnedUnknownTools = true;
        }

        const calledTools = collectCalledToolNames(
          ctx.session.messageHistory ?? [],
          ctx.iteration.pendingToolCalls,
        );
        const uncalled = requiredTools.filter(name => !calledTools.has(name));

        if (uncalled.length > 0) {
          for (const name of uncalled) {
            failCounts[name] = (failCounts[name] ?? 0) + 1;
          }
          for (const name of requiredTools) {
            if (calledTools.has(name)) failCounts[name] = 0;
          }

          const exhausted = uncalled.filter(name => (failCounts[name] ?? 0) >= REQUIRED_TOOLS_MAX_RETRIES);

          pCtx.span?.setAttribute('required_tools.incomplete', true);
          pCtx.span?.setAttribute('required_tools.uncalled', uncalled.join(','));

          if (exhausted.length > 0) {
            const exhaustedMsg = `Required tools exhausted after ${REQUIRED_TOOLS_MAX_RETRIES} retries: ${exhausted.join(', ')}. Halting loop.`;
            eventBus?.emit('required_tools:exhausted', {
              exhausted,
              failCounts: { ...failCounts },
              step: ctx.iteration.step,
              sessionId: ctx.session.sessionId,
            });
            pCtx.span?.setAttribute('required_tools.exhausted', exhausted.join(','));

            const policy = ctx.agent.config.requiredToolPolicy ?? 'advise';

            if (policy === 'enforce') {
              const syntheticCalls: ToolCall[] = exhausted.map((name, i) => ({
                id: `required-${i}`,
                name,
                args: {},
              }));

              eventBus?.emit('required_tools:enforced', {
                tools: exhausted,
                syntheticCalls,
                step: ctx.iteration.step,
                sessionId: ctx.session.sessionId,
              });
              pCtx.span?.setAttribute('required_tools.enforced', exhausted.join(','));

              ctx.iteration.loopDirective = { action: 'continue' } as LoopDirective;
              ctx.iteration.pendingToolCalls = syntheticCalls;
              ctx.session.totalTokenUsage = totalTokenUsage;
              return {
                status: 'warning',
                summary: exhaustedMsg,
                nextActions: ['executeTools'],
              };
            }

            ctx.agent.promptFragments = [
              ...ctx.agent.promptFragments,
              `[system] ${exhaustedMsg}`,
            ];
            ctx.iteration.loopDirective = { action: 'stop' } as LoopDirective;
            ctx.iteration.response = exhaustedMsg;
            ctx.session.totalTokenUsage = totalTokenUsage;
            return {
              status: 'error',
              summary: exhaustedMsg,
            };
          }

          eventBus?.emit('required_tools:incomplete', {
            uncalled,
            called: [...calledTools],
            step: ctx.iteration.step,
            sessionId: ctx.session.sessionId,
          });

          ctx.agent.promptFragments = [
            ...ctx.agent.promptFragments,
            `[system] Required tools not yet called: ${uncalled.join(', ')}. Please call them before finishing.`,
          ];
          ctx.iteration.loopDirective = { action: 'continue' } as LoopDirective;
          ctx.session.totalTokenUsage = totalTokenUsage;
          return {
            status: 'warning',
            summary: `Required tools not yet called: ${uncalled.join(', ')}`,
            nextActions: ['invokeLLM'],
          };
        }
      }

      const hasToolResults = (ctx.iteration.toolResults?.length ?? 0) > 0;
      const directive: LoopDirective = hasToolResults
        ? { action: 'continue' }
        : { action: 'stop' };

      ctx.iteration.loopDirective = directive;
      ctx.session.totalTokenUsage = totalTokenUsage;

      return {
        status: 'success',
        summary: hasToolResults
          ? 'Tool results present, continuing loop'
          : 'No tool results, stopping loop',
        nextActions: hasToolResults ? ['prepareStep'] : undefined,
      };
    },
  };
}

/**
 * @deprecated Use `createEvaluateIterationProcessor({ eventBus })` for full functionality.
 */
export const evaluateIterationProcessor: Processor = createEvaluateIterationProcessor();
