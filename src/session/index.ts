/**
 * AgentForge Session Module
 *
 * Session persistence and resume for agent conversations.
 * Built on top of the Checkpoint system (src/core/checkpoint.ts).
 *
 * Key exports:
 * - resumeAgentLoop — restore agent state from a saved checkpoint
 * - CheckpointStorage — interface for pluggable storage backends
 * - SqliteCheckpointStorage — default SQLite implementation
 */
export { resumeAgentLoop } from '../loop/agent-loop.js';
export type { CheckpointStorage } from '../core/interfaces.js';
export { SqliteCheckpointStorage } from '../storage/sqlite-checkpoint-storage.js';
export type { Checkpoint } from '../core/checkpoint.js';
export {
  CheckpointSchema,
  CheckpointPositionSchema,
  type CheckpointPosition,
  type ExecutedTool,
  type RecoveryMetadata,
  type CompactionHistory,
} from '../core/checkpoint.js';
