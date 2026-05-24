import type { PipelineFunction } from '../types.js';
import type { Agent } from '../../agent/index.js';
import type { Message } from '../../types.js';

export const parallelPipeline: PipelineFunction = async (
  agents: Agent[],
  msg?: Message | Message[]
) => {
  // Combine all messages as context, get full conversation history
  let fullInput = '';
  if (Array.isArray(msg)) {
    fullInput = msg.map(m => m.content).join('\n\n');
  } else if (msg) {
    fullInput = msg.content;
  }

  // Execute all agents in parallel, preserve name/identity mapping
  const results = await Promise.all(
    agents.map(async (agent, index) => {
      const result = await agent.run(fullInput);
      return {
        agentIndex: index,
        content: result,
      };
    })
  );

  // Return each result with clear separation
  return results.map(({ agentIndex, content }) => ({
    role: 'assistant',
    content: `[Agent ${agentIndex + 1}]:\n${content}`,
  })) as Message[];
};
