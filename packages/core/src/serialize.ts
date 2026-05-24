import type { PipelineContext, IterationRegion, SessionRegion, AgentRegion } from '@primo-ai/sdk';
import { SerializationVersionError } from './errors.js';

type SerializableIteration = IterationRegion;

export interface SerializableContext {
  agent: AgentRegion;
  iteration: SerializableIteration;
  session: SessionRegion;
  version?: number;
  snapshotId?: string;
}

export const SERIALIZATION_VERSION = 2;

export function serialize(ctx: PipelineContext, snapshotId?: string): SerializableContext {
  const result: SerializableContext = {
    agent: { ...ctx.agent },
    iteration: { ...ctx.iteration },
    session: { ...ctx.session },
    version: SERIALIZATION_VERSION,
  };
  if (snapshotId !== undefined) {
    result.snapshotId = snapshotId;
  }
  return result;
}

export function deserialize(data: SerializableContext): PipelineContext {
  const version = data.version ?? 2;
  if (version !== 2) {
    throw new SerializationVersionError(version);
  }
  return {
    agent: data.agent,
    iteration: data.iteration,
    session: data.session,
  };
}

export { SerializationVersionError };
