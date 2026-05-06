/**
 * SubAgent Module - Public API
 *
 * Provides subagent execution logic for AgentForge.
 *
 * @example
 * ```typescript
 * import { SubagentRegistry, createSubagentRegistry } from 'agentforge/subagent';
 * import { createAgentLoop } from 'agentforge';
 *
 * // Create a subagent registry
 * const registry = createSubagentRegistry();
 *
 * // Create a subagent agent loop
 * const subagentLoop = createAgentLoop(subagentContext, subagentConfig);
 *
 * // Register the subagent
 * registry.register({
 *   name: 'research-agent',
 *   description: 'Search and summarize information',
 *   agent: subagentLoop,
 * });
 *
 * // Run the subagent
 * registry.run('research-agent', 'Search for AI news', (event) => console.log(event.type));
 * ```
 *
 * @module agentforge/subagent
 */

// Types
export type {
  AgentLoop,
  SubagentConfig,
  RemoteSubagentConfig,
  SubagentRunOptions,
  SubagentResult,
  SubagentEntry,
  SubagentMode,
  SubagentAsyncResult,
  AsyncSubagentHandle,
} from './types.js';

// Registry
export { SubagentRegistry, createSubagentRegistry } from './registry.js';
