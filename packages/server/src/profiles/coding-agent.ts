import type { AgentProfile } from '@agentforge/sdk';
import { memoryPlugin, InMemoryBackend, compressionPlugin, permissionPlugin, skillPlugin } from '@agentforge/plugins';

export const codingAgentProfile: AgentProfile = {
  name: 'coding-agent',
  description: 'Full-featured coding assistant with memory, compression, permissions, and skills.',
  plugins: [
    memoryPlugin({ backend: new InMemoryBackend(), triggerMode: { type: 'automatic', onLoad: 'always' } }),
    compressionPlugin({ maxContextTokens: 8000, phases: [{ type: 'truncate', maxTokens: 2000 }] }),
    permissionPlugin({ mode: 'full-auto', rules: [] }),
    skillPlugin({ skills: [] }),
  ],
  config: {
    costCap: { maxCost: 1.0, strategy: 'warn' },
    tokenBudget: { maxContextTokens: 32000, reservedOutputTokens: 4096, strategy: 'compress' },
  },
  maxIterations: 15,
};
