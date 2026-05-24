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
  const version = data.version ?? 1;
  if (version === 1) {
    // v1 兼容：将 request 字段合并到 session
    const req = (data as any).request;
    return {
      agent: data.agent,
      iteration: data.iteration,
      session: {
        ...data.session,
        input: req?.input ?? (data.session as SessionRegion).input ?? '',
        sessionId: req?.sessionId ?? (data.session as SessionRegion).sessionId ?? '',
      },
    };
  }
  if (version === 2) {
    return {
      agent: data.agent,
      iteration: data.iteration,
      session: data.session,
    };
  }
  throw new SerializationVersionError(version);
}

export function migrate_v1_to_v2(data: SerializableContext): SerializableContext {
  const version = data.version ?? 1;
  if (version === 1) {
    const req = (data as any).request;
    const { request: _, version: _v, ...rest } = data as any;
    return {
      ...rest,
      session: {
        ...data.session,
        input: req?.input ?? (data.session as SessionRegion).input ?? '',
        sessionId: req?.sessionId ?? (data.session as SessionRegion).sessionId ?? '',
      },
      version: 2,
    };
  }
  return data;
}

export { SerializationVersionError };
