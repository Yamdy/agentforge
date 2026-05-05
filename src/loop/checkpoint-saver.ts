/**
 * Checkpoint Saver — extracted from agent-loop.ts
 *
 * Fire-and-forget checkpoint persistence. Never blocks the agent loop.
 */

import type { AgentEventEmitter } from '../core/index.js';
import type { AgentContext, AgentState } from '../core/index.js';
import { generateId } from '../core/events.js';

export interface CheckpointSaverDeps {
  ctx: AgentContext;
  emitter: AgentEventEmitter;
  enabled: boolean;
}

export function saveCheckpoint(
  deps: CheckpointSaverDeps,
  position: 'after_llm' | 'after_tool',
  state: AgentState
): void {
  if (!deps.enabled) return;

  const cpId = generateId('cp');
  void deps.emitter.emit({
    type: 'state.change',
    timestamp: Date.now(),
    sessionId: deps.ctx.sessionId,
    from: 'running',
    to: 'running',
    checkpoint: { id: cpId, position },
  });

  deps.ctx.checkpoint
    ?.save({
      id: cpId,
      sessionId: deps.ctx.sessionId,
      position,
      state,
      timestamp: Date.now(),
      pendingA2A: [],
      executedTools: [],
      recoveryMetadata: { recoveryCount: 0 },
      compactionHistory: [],
    })
    .catch(() => {});
}
