import type { AgentProfile } from '@agentforge/sdk';
import { compressionPlugin, createTokenBudgetProcessor } from '@agentforge/plugins';

export const dataAgentProfile: AgentProfile = {
  name: 'data-agent',
  description: 'Data analysis agent with compression and token budget management.',
  plugins: [
    compressionPlugin({ maxContextTokens: 16000, phases: [{ type: 'truncate', maxTokens: 4000 }] }),
    (api) => {
      const processor = createTokenBudgetProcessor({ maxContextTokens: 64000, reservedOutputTokens: 8192, strategy: 'compress' });
      api.registerProcessor('gateLLM', processor);
      return { processors: [] };
    },
  ],
  config: {
    tokenBudget: { maxContextTokens: 64000, reservedOutputTokens: 8192, strategy: 'compress' },
  },
  maxIterations: 12,
};
