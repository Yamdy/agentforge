import type { AgentProfile } from '@agentforge/sdk';
import { createFactInjectionProcessor, createCostCapProcessor } from '@agentforge/plugins';

export const businessAgentProfile: AgentProfile = {
  name: 'business-agent',
  description: 'Business integration agent with fact injection and cost control.',
  plugins: [
    (api) => {
      const processor = createFactInjectionProcessor({ facts: [] });
      api.registerProcessor('buildContext', processor);
      return { processors: [] };
    },
    (api) => {
      const processor = createCostCapProcessor({ maxCost: 5.0, strategy: 'block' });
      api.registerProcessor('gateLLM', processor);
      return { processors: [] };
    },
  ],
  config: {
    costCap: { maxCost: 5.0, strategy: 'block' },
    factInjection: { facts: [] },
  },
  maxIterations: 10,
};
