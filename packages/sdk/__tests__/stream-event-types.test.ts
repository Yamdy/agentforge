import { describe, it, expect } from 'vitest';
import type {
  StreamEvent,
  ServerStreamEvent,
  PipelineContext,
  PipelineCheckpoint,
  TokenUsage,
} from '../src/index.js';

describe('StreamEvent (merged)', () => {
  it('accepts text_delta event', () => {
    const event: StreamEvent = { type: 'text_delta', text: 'hello' };
    expect(event.type).toBe('text_delta');
  });

  it('accepts stage_start and stage_complete', () => {
    const start: StreamEvent = { type: 'stage_start', stage: 'invokeLLM' };
    const complete: StreamEvent = { type: 'stage_complete', stage: 'invokeLLM' };
    expect(start.type).toBe('stage_start');
    expect(complete.type).toBe('stage_complete');
  });

  it('accepts tool_call and tool_result', () => {
    const call: StreamEvent = { type: 'tool_call', name: 'echo', args: {} };
    const result: StreamEvent = { type: 'tool_result', name: 'echo', result: 'ok' };
    expect(call.type).toBe('tool_call');
    expect(result.type).toBe('tool_result');
  });

  it('accepts complete event', () => {
    const event: StreamEvent = { type: 'complete', context: {} as PipelineContext };
    expect(event.type).toBe('complete');
  });

  it('accepts abort event with optional retryFrom', () => {
    const event: StreamEvent = { type: 'abort', reason: 'policy', retryFrom: 'invokeLLM' };
    expect(event.type).toBe('abort');
  });

  it('accepts suspended event', () => {
    const event: StreamEvent = {
      type: 'suspended',
      suspensionId: 'sus-1',
      reason: 'awaiting input',
      checkpoint: {} as PipelineCheckpoint,
    };
    expect(event.type).toBe('suspended');
  });

  it('accepts error event', () => {
    const event: StreamEvent = {
      type: 'error',
      error: new Error('fail'),
      stage: 'invokeLLM',
    };
    expect(event.type).toBe('error');
  });

  // Session lifecycle events (previously only in ServerStreamEvent)

  it('accepts session.started event', () => {
    const event: StreamEvent = { type: 'session.started', sessionId: 's1' };
    expect(event.type).toBe('session.started');
  });

  it('accepts session.completed event', () => {
    const event: StreamEvent = {
      type: 'session.completed',
      sessionId: 's1',
      tokenUsage: { input: 10, output: 5 } as TokenUsage,
    };
    expect(event.type).toBe('session.completed');
  });

  it('accepts session.aborted event', () => {
    const event: StreamEvent = { type: 'session.aborted', sessionId: 's1' };
    expect(event.type).toBe('session.aborted');
  });

  // Permission events (previously only in ServerStreamEvent)

  it('accepts permission.request event', () => {
    const event: StreamEvent = {
      type: 'permission.request',
      sessionId: 's1',
      permissionId: 'p1',
      toolName: 'search',
      args: { query: 'x' },
      reason: 'needs approval',
    };
    expect(event.type).toBe('permission.request');
  });

  it('accepts permission.resolved event', () => {
    const event: StreamEvent = {
      type: 'permission.resolved',
      sessionId: 's1',
      permissionId: 'p1',
      decision: 'allow',
    };
    expect(event.type).toBe('permission.resolved');
  });
});

describe('ServerStreamEvent (deprecated alias)', () => {
  it('is assignable from all StreamEvent types', () => {
    const events: ServerStreamEvent[] = [
      { type: 'text_delta', text: 'hello' },
      { type: 'session.started', sessionId: 's1' },
      { type: 'permission.request', sessionId: 's1', permissionId: 'p1', toolName: 't', args: {}, reason: 'r' },
    ];
    expect(events).toHaveLength(3);
  });

  it('a StreamEvent is assignable to ServerStreamEvent', () => {
    const se: StreamEvent = { type: 'session.started', sessionId: 's1' };
    const alias: ServerStreamEvent = se;
    expect(alias.type).toBe('session.started');
  });
});
