import type { AgentProfile } from '@primo-ai/sdk';
import { memoryPlugin, InMemoryBackend, compressionPlugin, permissionPlugin } from '@primo-ai/plugins';

export const codingAgentProfile: AgentProfile = {
  name: 'coding-agent',
  description: 'Full-featured coding assistant with memory, compression, permissions, and skills.',
  plugins: [
    memoryPlugin({ backend: new InMemoryBackend(), triggerMode: { type: 'automatic', onLoad: 'always' } }),
    compressionPlugin({ maxContextTokens: 8000, phases: [{ type: 'truncate', maxTokens: 2000 }] }),
    permissionPlugin({ mode: 'full-auto', rules: [] }),
  ],
  config: {
    costCap: { maxCost: 1.0, strategy: 'warn' },
    tokenBudget: { maxContextTokens: 32000, reservedOutputTokens: 4096, strategy: 'compress' },
  },
  maxIterations: 15,
};
