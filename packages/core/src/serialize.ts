import type { PipelineContext, IterationRegion, SessionRegion, AgentRegion } from '@primo-ai/sdk';

type SerializableIteration = Omit<IterationRegion, 'fullStream' | 'usagePromise' | 'reasoningPromise' | 'span'>;

interface SerializableContext {
  request: PipelineContext['request'];
  agent: AgentRegion;
  iteration: SerializableIteration;
  session: SessionRegion;
}

export function serialize(ctx: PipelineContext): SerializableContext {
  const { fullStream, usagePromise, reasoningPromise, span, ...serializableIteration } = ctx.iteration;
  void fullStream; void usagePromise; void reasoningPromise; void span;
  return {
    request: { ...ctx.request },
    agent: { ...ctx.agent },
    iteration: serializableIteration,
    session: { ...ctx.session },
  };
}

export function deserialize(data: SerializableContext): PipelineContext {
  return {
    request: data.request,
    agent: data.agent,
    iteration: data.iteration,
    session: data.session,
  };
}
