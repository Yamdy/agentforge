import type { PipelineFunction } from '../types.js';
import type { Agent } from '../../agent/index.js';
import type { Message } from '../../types.js';

export const parallelPipeline: PipelineFunction = async (
  agents: Agent[],
  msg?: Message | Message[]
) => {
  const input = Array.isArray(msg) ? msg[msg.length - 1]?.content || '' : msg?.content || '';

  const results = await Promise.all(agents.map((agent) => agent.run(input)));

  return results.map((content, _index) => ({
    role: 'assistant',
    content,
  })) as Message[];
};
