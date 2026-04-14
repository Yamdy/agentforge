import { registry } from './registry.js';
import type { Message } from '../types.js';
import type {
  DelegationConfig,
  DelegationStartContext,
  DelegationStartResult,
  DelegationCompleteContext,
  MessageFilterContext,
} from './types.js';

/**
 * Default message filter that keeps only the delegated task in the sub-agent context
 * providing complete isolation from the parent conversation
 */
export function isolatedMessageFilter(ctx: MessageFilterContext): Message[] {
  // For isolated delegation, we only include the delegated prompt
  // parent conversation is not included - completely isolated context
  return [
    {
      role: 'user',
      content: ctx.prompt,
    },
  ];
}

export class DelegationManager {
  async delegate(
    subAgentName: string,
    prompt: string,
    parentMessages: Message[],
    config?: DelegationConfig
  ): Promise<string> {
    const startTime = Date.now();
    // iteration is a reserved field, currently no retry logic
    const iteration = 0;

    const subAgent = registry.get(subAgentName);
    if (!subAgent) {
      throw new Error(`Sub-agent not found: ${subAgentName}`);
    }

    try {
      const startContext: DelegationStartContext = {
        subAgentName,
        prompt,
        parentMessages,
        iteration,
      };

      let startResult: DelegationStartResult = { proceed: true };
      if (config?.onDelegationStart) {
        startResult = await config.onDelegationStart(startContext);
      }

      if (startResult.proceed === false) {
        throw new Error(startResult.rejectionReason || 'Delegation rejected');
      }

      const finalPrompt = startResult.modifiedPrompt || prompt;

      let filteredMessages = parentMessages;
      if (config?.messageFilter) {
        const filterContext: MessageFilterContext = {
          messages: parentMessages,
          subAgentName,
          prompt: finalPrompt,
        };
        filteredMessages = await config.messageFilter(filterContext);
      }

      const result = await subAgent.agent.run(finalPrompt, {
        sessionMessages: filteredMessages,
      });

      const duration = Date.now() - startTime;
      const completeContext: DelegationCompleteContext = {
        subAgentName,
        result,
        success: true,
        duration,
      };

      if (config?.onDelegationComplete) {
        await config.onDelegationComplete(completeContext);
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const completeContext: DelegationCompleteContext = {
        subAgentName,
        result: '',
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration,
      };

      if (config?.onDelegationComplete) {
        try {
          await config.onDelegationComplete(completeContext);
        } catch (callbackError) {
          console.error('onDelegationComplete callback failed:', callbackError);
        }
      }

      throw error;
    }
  }
}

export const delegation = new DelegationManager();
