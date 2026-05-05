/**
 * AgentForge Loop Module - Public API
 *
 * Re-exports agent loop types and factory.
 *
 * @module
 */

export {
  type AgentLoopConfig,
  type AgentLoop,
  type RunResult,
  type ExecutionMode,
  createAgentLoop,
} from './agent-loop.js';

export { type PromptTemplates, DEFAULT_PROMPT_TEMPLATES } from './prompt-templates.js';
