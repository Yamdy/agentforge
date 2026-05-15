import type { AgentProfile } from '@agentforge/sdk';
import { memoryPlugin, InMemoryBackend, createGoalEchoProcessor } from '@agentforge/plugins';

export const personalAgentProfile: AgentProfile = {
  name: 'personal-agent',
  description: 'Personal assistant with memory, goal tracking, and multi-agent routing capability.',
  plugins: [
    memoryPlugin({ backend: new InMemoryBackend(), triggerMode: { type: 'automatic', onLoad: 'always' } }),
    (api) => {
      const processor = createGoalEchoProcessor({ enabled: true, echoFrequency: 5, progressTracking: true });
      api.registerProcessor('evaluateIteration', processor);
      return { processors: [] };
    },
  ],
  config: {
    goalEcho: { enabled: true, echoFrequency: 5, progressTracking: true },
  },
  maxIterations: 20,
};
