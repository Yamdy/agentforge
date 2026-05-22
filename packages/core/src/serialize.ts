import type { PipelineContext, IterationRegion, SessionRegion, AgentRegion } from '@primo-ai/sdk';
import { SerializationVersionError } from './errors.js';

type SerializableIteration = Omit<IterationRegion, 'fullStream' | 'usagePromise' | 'reasoningPromise' | 'span'>;

export interface SerializableContext {
  request: PipelineContext['request'];
  agent: AgentRegion;
  iteration: SerializableIteration;
  session: SessionRegion;
  /** Serialization format version. Absent = v1 (backward compat). Current = 1. */
  version?: number;
  /** Optional snapshot ID for file system auditing */
  snapshotId?: string;
}

/** Current serialization format version. */
export const SERIALIZATION_VERSION = 1;

export function serialize(ctx: PipelineContext, snapshotId?: string): SerializableContext {
  const { fullStream, usagePromise, reasoningPromise, span, ...serializableIteration } = ctx.iteration;
  void fullStream; void usagePromise; void reasoningPromise; void span;
  const result: SerializableContext = {
    request: { ...ctx.request },
    agent: { ...ctx.agent },
    iteration: serializableIteration,
    session: { ...ctx.session },
    version: SERIALIZATION_VERSION,
  };
  if (snapshotId !== undefined) {
    result.snapshotId = snapshotId;
  }
  return result;
}

export function deserialize(data: SerializableContext): PipelineContext {
  const version = data.version ?? 1;
  if (version === 1) {
    return {
      request: data.request,
      agent: data.agent,
      iteration: data.iteration,
      session: data.session,
    };
  }
  throw new SerializationVersionError(version);
}

/**
 * Placeholder migration function for future v1 → v2 upgrades.
 * When the serialization format evolves, implement the actual migration here.
 */
export function migrate_v1_to_v2(data: SerializableContext): SerializableContext {
  // v1 → v2 migration: no changes yet
  return data;
}

export { SerializationVersionError };
