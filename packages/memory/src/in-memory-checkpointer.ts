import { Effect } from "effect";
import type { Checkpointer } from "./types";
import { SessionError } from "@agentforge/core";

export class InMemoryCheckpointer<TState> implements Checkpointer<TState> {
  private checkpoints: Map<string, TState> = new Map();

  save(checkpointId: string, state: TState): Effect.Effect<void, never> {
    return Effect.sync(() => {
      this.checkpoints.set(checkpointId, state);
    });
  }

  get(checkpointId: string): Effect.Effect<TState | undefined, never> {
    return Effect.sync(() => this.checkpoints.get(checkpointId));
  }

  list(threadId: string): Effect.Effect<string[], never> {
    return Effect.sync(() => {
      const prefix = `${threadId}/`;
      return Array.from(this.checkpoints.keys())
        .filter(id => id.startsWith(prefix));
    });
  }

  delete(checkpointId: string): Effect.Effect<void, SessionError> {
    return Effect.sync(() => {
      if (!this.checkpoints.has(checkpointId)) {
        throw new SessionError(`Checkpoint "${checkpointId}" not found`);
      }
      this.checkpoints.delete(checkpointId);
    });
  }

  clear(threadId: string): Effect.Effect<void, SessionError> {
    return Effect.sync(() => {
      const prefix = `${threadId}/`;
      const toDelete = Array.from(this.checkpoints.keys())
        .filter(id => id.startsWith(prefix));
      
      toDelete.forEach(id => this.checkpoints.delete(id));
    });
  }

  clearAll(): Effect.Effect<void, never> {
    return Effect.sync(() => {
      this.checkpoints.clear();
    });
  }

  restore(checkpointId: string): Effect.Effect<TState | undefined, SessionError> {
    return Effect.sync(() => {
      return this.checkpoints.get(checkpointId);
    });
  }
}