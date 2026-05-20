import type { PipelineContext, IterationRegion, SessionRegion, AgentRegion } from '@primo-ai/sdk';

type SerializableIteration = Omit<IterationRegion, 'fullStream' | 'usagePromise' | 'reasoningPromise' | 'span'>;

export interface SerializableContext {
  request: PipelineContext['request'];
  agent: AgentRegion;
  iteration: SerializableIteration;
  session: SessionRegion;
  /** Optional snapshot ID for file system auditing */
  snapshotId?: string;
}

export function serialize(ctx: PipelineContext, snapshotId?: string): SerializableContext {
  const { fullStream, usagePromise, reasoningPromise, span, ...serializableIteration } = ctx.iteration;
  void fullStream; void usagePromise; void reasoningPromise; void span;
  const result: SerializableContext = {
    request: { ...ctx.request },
    agent: { ...ctx.agent },
    iteration: serializableIteration,
    session: { ...ctx.session },
  };
  if (snapshotId !== undefined) {
    result.snapshotId = snapshotId;
  }
  return result;
}

export function deserialize(data: SerializableContext): PipelineContext {
  return {
    request: data.request,
    agent: data.agent,
    iteration: data.iteration,
    session: data.session,
  };
}
