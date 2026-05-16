import { describe, it, expect } from 'vitest';
import type {
  PipelineStage,
  Processor,
  PipelineContext,
  ProcessorResult,
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  Span,
  SpanContext,
  Tracer,
  Metrics,
  HarnessAPI,
  PluginRegistration,
  AgentConfig,
  SuspensionSignal,
  PipelineCheckpoint,
  TokenUsage,
  StreamEvent,
  LoopDirective,
  Message,
  IterationRegion,
  SessionRegion,
} from '../src/index.js';
import { SpanType } from '../src/index.js';

describe('PipelineStage', () => {
  it('accepts all 8 agent lifecycle stage names', () => {
    const stages: PipelineStage[] = [
      'processInput',
      'buildContext',
      'prepareStep',
      'invokeLLM',
      'processStepOutput',
      'executeTools',
      'evaluateIteration',
      'processOutput',
    ];
    expect(stages).toHaveLength(8);
  });

  it('accepts tool sub-pipeline stage names', () => {
    const toolStages: PipelineStage[] = ['beforeTool', 'execute', 'afterTool'];
    expect(toolStages).toHaveLength(3);
  });
});

describe('Processor', () => {
  it('can be implemented with a stage and execute method', async () => {
    const processor: Processor = {
      stage: 'processInput',
      execute: async (ctx: PipelineContext) => ctx,
    };
    expect(processor.stage).toBe('processInput');
    expect(typeof processor.execute).toBe('function');
  });

  it('execute can return an AbortSignal to stop the pipeline', async () => {
    const abortProcessor: Processor = {
      stage: 'processStepOutput',
      execute: async () => ({ type: 'abort' as const, reason: 'guardrail triggered' }),
    };
    const result: ProcessorResult = await abortProcessor.execute({} as PipelineContext);
    expect(result).toEqual({ type: 'abort', reason: 'guardrail triggered' });
  });
});

describe('PipelineContext', () => {
  it('carries request, agent, iteration, and session regions', () => {
    const ctx: PipelineContext = {
      request: { input: 'hello', sessionId: 's1' },
      agent: {
        config: { model: 'test' } as AgentConfig,
        promptFragments: [],
        toolDeclarations: [],
      },
      iteration: { step: 0 },
      session: { custom: {} },
    };
    expect(ctx.request.input).toBe('hello');
    expect(ctx.iteration.step).toBe(0);
    expect(ctx.agent.promptFragments).toEqual([]);
  });
});

describe('Tool', () => {
  it('can be implemented with name, description, schemas, and execute', async () => {
    const tool: Tool<{ query: string }, { results: string[] }> = {
      name: 'search',
      description: 'Search for files',
      inputSchema: {} as Tool<{ query: string }>['inputSchema'],
      execute: async (input: { query: string }, _ctx: ToolExecutionContext) => ({
        results: [`found: ${input.query}`],
      }),
    };
    expect(tool.name).toBe('search');
    expect(typeof tool.execute).toBe('function');
    const result = await tool.execute({ query: 'test' }, {} as ToolExecutionContext);
    expect(result.results).toEqual(['found: test']);
  });

  it('supports optional approval, rendering, and output schema', () => {
    const tool: Tool<unknown, unknown> = {
      name: 'delete_file',
      description: 'Delete a file',
      inputSchema: {} as Tool<unknown>['inputSchema'],
      requireApproval: true,
      renderCall: (input: unknown) => `deleting ${String(input)}`,
      renderResult: (output: unknown) => `deleted ${String(output)}`,
      execute: async () => ({ ok: true }),
    };
    expect(tool.requireApproval).toBe(true);
    expect(tool.renderCall!('x')).toBe('deleting x');
    expect(tool.renderResult!({ ok: true })).toBe('deleted [object Object]');
  });
});

describe('ToolDefinition', () => {
  it('describes the shape a plugin uses to register a tool', () => {
    const def: ToolDefinition = {
      name: 'echo',
      description: 'Echo input back',
      inputSchema: {} as ToolDefinition['inputSchema'],
      execute: async () => 'pong',
    };
    expect(def.name).toBe('echo');
  });
});

describe('Span', () => {
  it('can be implemented with startChild, end, setAttribute, addEvent', () => {
    let ended = false;
    const span: Span = {
      name: 'test-span',
      startChild(_name: string): Span {
        return {} as Span;
      },
      end(): void {
        ended = true;
      },
      setAttribute(_key: string, _value: unknown): Span {
        return this;
      },
      addEvent(_name: string, _attributes?: Record<string, unknown>): Span {
        return this;
      },
      spanContext(): SpanContext {
        return { spanId: 's1', traceId: 't1' };
      },
    };
    span.end();
    expect(ended).toBe(true);
    expect(span.spanContext().spanId).toBe('s1');
  });
});

describe('Tracer', () => {
  it('can be implemented with startSpan and getCurrentSpan', () => {
    const tracer: Tracer = {
      startSpan(name: string): Span {
        return { name } as Span;
      },
      getCurrentSpan(): Span | undefined {
        return undefined;
      },
    };
    const span = tracer.startSpan('agent_run');
    expect(span.name).toBe('agent_run');
    expect(tracer.getCurrentSpan()).toBeUndefined();
  });
});

describe('Metrics', () => {
  it('can be implemented with increment, gauge, histogram', () => {
    const recorded: string[] = [];
    const metrics: Metrics = {
      increment(name: string): void {
        recorded.push(`inc:${name}`);
      },
      gauge(name: string, _value: number): void {
        recorded.push(`gauge:${name}`);
      },
      histogram(name: string, _value: number): void {
        recorded.push(`hist:${name}`);
      },
    };
    metrics.increment('tool.calls');
    metrics.gauge('context.tokens', 100);
    metrics.histogram('step.duration', 42);
    expect(recorded).toEqual(['inc:tool.calls', 'gauge:context.tokens', 'hist:step.duration']);
  });
});

describe('SpanType', () => {
  it('contains all expected span type values', () => {
    expect(SpanType.AGENT_RUN).toBe('agent_run');
    expect(SpanType.MODEL_STEP).toBe('model_step');
    expect(SpanType.TOOL_CALL).toBe('tool_call');
    expect(SpanType.PROCESSOR_RUN).toBe('processor_run');
  });
});

describe('HarnessAPI', () => {
  it('can be implemented with registration methods', () => {
    const registered: string[] = [];
    const api: HarnessAPI = {
      registerProcessor(stage, _processor) {
        registered.push(`proc:${stage}`);
      },
      registerTool(_tool) {
        registered.push('tool');
      },
      unregisterTool(_name: string) {
        return false;
      },
      registerCommand(_name, _handler) {
        registered.push('cmd');
      },
      registerHook(_hook) {},
      registerResource(_declaration) {},
      registerProvider(_name, _factory) {
        registered.push('provider');
      },
      registerCompressionStrategy(_strategy) {
        registered.push('compression');
      },
      subscribe(_eventType, _handler) {
        registered.push('event');
        return () => {};
      },
      emit(_eventType, _data?) {
        registered.push('emit');
      },
      insertStage(_phase, _after, _newStage) {},
      removeStage(_phase, _stage) {},
      replaceStages(_phase, _stages) {},
    };
    api.registerProcessor('processInput', {} as Processor);
    api.registerTool({} as ToolDefinition);
    api.registerCommand('test', async () => {});
    api.registerProvider('test', {} as never);
    api.registerCompressionStrategy(async (_msgs, _tc, _budget) => []);
    api.subscribe('agent:start', () => {});
    api.emit('test.event', {});
    expect(registered).toHaveLength(7);
  });
});

describe('PluginRegistration', () => {
  it('describes what a plugin factory returns', () => {
    const registration: PluginRegistration = {
      processors: [],
      tools: [],
      commands: {},
    };
    expect(registration.processors).toEqual([]);
    expect(registration.tools).toEqual([]);
  });
});

describe('AgentConfig', () => {
  it('describes agent configuration with model and tools', () => {
    const config: AgentConfig = {
      model: 'openai/gpt-5',
      systemPrompt: 'You are helpful.',
      maxIterations: 10,
      tools: [{ name: 'search', description: 'Search', inputSchema: {}, execute: async () => '' }],
    };
    expect(config.model).toBe('openai/gpt-5');
    expect(config.maxIterations).toBe(10);
  });
});

describe('SuspensionSignal', () => {
  it('carries suspension id, reason, and checkpoint', () => {
    const checkpoint: PipelineCheckpoint = {
      context: {} as unknown as PipelineContext,
      nextStages: ['executeTools'],
      iteration: 1,
    };
    const result: SuspensionSignal = {
      type: 'suspend',
      suspensionId: 'sus-123',
      reason: 'awaiting human approval',
      checkpoint,
    };
    expect(result.type).toBe('suspend');
    expect(result.suspensionId).toBe('sus-123');
    expect(result.checkpoint.nextStages).toEqual(['executeTools']);
  });
});

describe('TokenUsage', () => {
  it('carries input and output token counts', () => {
    const usage: TokenUsage = { input: 100, output: 50 };
    expect(usage.input).toBe(100);
    expect(usage.output).toBe(50);
  });
});

describe('StreamEvent', () => {
  it('represents text delta events', () => {
    const event: StreamEvent = { type: 'text_delta', text: 'hello' };
    expect(event.type).toBe('text_delta');
    expect((event as { type: 'text_delta'; text: string }).text).toBe('hello');
  });

  it('represents all event types', () => {
    const events: StreamEvent[] = [
      { type: 'stage_start', stage: 'invokeLLM' },
      { type: 'stage_complete', stage: 'invokeLLM' },
      { type: 'text_delta', text: 'hi' },
      { type: 'tool_call', name: 'echo', args: {} },
      { type: 'tool_result', name: 'echo', result: 'ok' },
      { type: 'complete', context: {} as PipelineContext },
      { type: 'abort', reason: 'policy' },
      { type: 'abort', reason: 'retry', retryFrom: 'invokeLLM' },
    ];
    expect(events).toHaveLength(8);
  });

  it('abort event can carry retryFrom', () => {
    const event: StreamEvent = { type: 'abort', reason: 'policy', retryFrom: 'invokeLLM' };
    expect(event.type).toBe('abort');
    if (event.type === 'abort' && event.retryFrom) {
      expect(event.retryFrom).toBe('invokeLLM');
    }
  });
});

describe('LoopDirective and Regions', () => {
  it('LoopDirective supports stop, continue, and retry actions', () => {
    const stop: LoopDirective = { action: 'stop' };
    const cont: LoopDirective = { action: 'continue' };
    const retry: LoopDirective = { action: 'retry', retryFrom: 'invokeLLM' };

    expect(stop.action).toBe('stop');
    expect(cont.action).toBe('continue');
    expect(retry.action).toBe('retry');
    if (retry.action === 'retry') {
      expect(retry.retryFrom).toBe('invokeLLM');
    }
  });

  it('Message carries role and content', () => {
    const msg: Message = { role: 'user', content: 'hello' };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('SessionRegion carries messageHistory and custom', () => {
    const session: SessionRegion = {
      messageHistory: [{ role: 'user', content: 'hi' }],
      totalTokenUsage: { input: 5, output: 2 },
      custom: { myPlugin: { flag: true } },
    };
    expect(session.messageHistory?.length).toBe(1);
    expect(session.custom.myPlugin).toEqual({ flag: true });
  });

  it('IterationRegion carries loopDirective and span', () => {
    const iter: IterationRegion = {
      step: 3,
      loopDirective: { action: 'stop' },
      response: 'done',
      tokenUsage: { input: 10, output: 5 },
    };
    expect(iter.step).toBe(3);
    expect(iter.loopDirective?.action).toBe('stop');
    expect(iter.response).toBe('done');
  });
});
