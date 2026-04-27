/**
 * AgentForge Loop Module - Public API
 *
 * Re-exports agent loop types and factory.
 *
 * @module
 */

export {
  type StepContext,
  type AgentLoopConfig,
  type AgentLoop,
  type HandlerDeps,
  type CheckpointConfig,
  createAgentLoop,
} from './agent-loop.js';
