import type { PipelineFunction } from '../types.js';
import type { Agent } from '../../agent/index.js';
import type { Message } from '../../types.js';

export const sequentialPipeline: PipelineFunction = async (
  agents: Agent[],
  msg?: Message | Message[]
) => {
  let currentMsg: Message | Message[] = msg || { role: 'user', content: '' };

  for (const agent of agents) {
    const input = Array.isArray(currentMsg)
      ? currentMsg[currentMsg.length - 1]?.content || ''
      : currentMsg?.content || '';

    const response = await agent.run(input);
    currentMsg = { role: 'assistant', content: response };
  }

  return currentMsg;
};
