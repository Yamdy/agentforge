import type { Agent, LLMAdapter, LLMRequest, Message, Plugin, RunHandlers, RunResult, ToolCall, ToolDef } from './types.js';
import { executePluginHook } from './plugin.js';

const MAX_STEPS = 50;

async function runBeforeLLMHooks(
  plugins: Plugin[],
  request: LLMRequest,
): Promise<LLMRequest | false> {
  let current: LLMRequest | false = request;
  for (const plugin of plugins) {
    if (!plugin.beforeLLM) continue;
    try {
      if (typeof current === 'boolean') {
        return false;
      }
      const result = await plugin.beforeLLM(current);
      if (result === false) return false;
      current = result;
    } catch (err) {
      console.warn(`Plugin "${plugin.name}" beforeLLM error:`, err);
    }
  }
  return current;
}

async function runBeforeToolCallHooks(
  plugins: Plugin[],
  tc: ToolCall,
): Promise<ToolCall | null | false> {
  let current: ToolCall | null | false = tc;
  for (const plugin of plugins) {
    if (!plugin.beforeToolCall) continue;
    try {
      if (current === null || typeof current === 'boolean') {
        return current as ToolCall | null;
      }
      const result = await plugin.beforeToolCall(current);
      if (result === null || result === false) return result;
      current = result;
    } catch (err) {
      console.warn(`Plugin "${plugin.name}" beforeToolCall error:`, err);
    }
  }
  return current;
}

export function createAgentLoop(
  llm: LLMAdapter,
  tools: Map<string, ToolDef>,
  plugins: Plugin[] = [],
): Agent {
  return async (input: string, handlers?: RunHandlers): Promise<RunResult> => {
    const completedCalls: RunResult['toolCalls'] = [];
    const messages: Message[] = [{ role: 'user', content: input }];

    const emit = (event: Parameters<NonNullable<RunHandlers['onEvent']>>[0]): void => {
      try {
        handlers?.onEvent?.(event);
      } catch {
        // Handler isolation
      }
    };

    try {
      let request: LLMRequest = { messages };

      for (let step = 0; step < MAX_STEPS; step++) {
        request = await executePluginHook(plugins, 'transformRequest', request);
        const beforeResult = await runBeforeLLMHooks(plugins, request);
        if (beforeResult === false) break;
        request = beforeResult;

        emit({ type: 'llm_request', request });

        const response = await llm.chat(request);
        emit({ type: 'llm_response', response });

        let finalResponse = response;
        const afterResult = await executePluginHook(plugins, 'afterLLM', response, request);
        if (afterResult !== null) {
          finalResponse = afterResult;
        }

        if (finalResponse.content) {
          handlers?.onToken?.(finalResponse.content);
        }

        if (finalResponse.toolCalls.length === 0) {
          emit({ type: 'done', reason: 'stop' });
          return {
            text: finalResponse.content ?? '',
            toolCalls: completedCalls,
            finishReason: 'stop',
          };
        }

        for (const tc of finalResponse.toolCalls) {
          let currentTc = tc;
          const beforeTc = await runBeforeToolCallHooks(plugins, currentTc);
          if (beforeTc === null || beforeTc === false) continue;
          currentTc = beforeTc;

          emit({ type: 'tool_call_start', toolCall: currentTc });

          const toolDef = tools.get(currentTc.name);
          let result: NonNullable<RunResult['toolCalls']>[number]['result'];
          if (toolDef) {
            const output = await toolDef.execute(currentTc.arguments);
            result = { toolCallId: currentTc.id, output: String(output) };
          } else {
            result = {
              toolCallId: currentTc.id,
              output: '',
              error: `Tool "${currentTc.name}" not found`,
            };
          }

          let finalResult = result;
          const afterResult = await executePluginHook(plugins, 'afterToolCall', result, currentTc);
          if (afterResult !== null) {
            finalResult = afterResult;
          }

          emit({ type: 'tool_call_end', toolCall: currentTc, result: finalResult });

          completedCalls.push({ ...currentTc, result: finalResult });

          messages.push({
            role: 'assistant',
            content: finalResponse.content ?? '',
          });
          messages.push({
            role: 'tool',
            content: finalResult.error ?? finalResult.output,
          });
        }
      }

      emit({ type: 'done', reason: 'stop' });
      return { text: '', toolCalls: completedCalls, finishReason: 'stop' };
    } catch (err) {
      emit({
        type: 'agent_error',
        error: err instanceof Error ? err.message : String(err),
      });
      emit({ type: 'done', reason: 'error' });
      return { text: '', toolCalls: completedCalls, finishReason: 'error' };
    }
  };
}
