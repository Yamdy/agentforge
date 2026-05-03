/**
 * Phase 0: Agent Loop Test
 *
 * Imperative async queue-based agent loop (imperative).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

// ============================================================
// Part 1: Core Types (Zod Schemas)
// ============================================================

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
});

type Message = z.infer<typeof MessageSchema>;

const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});

type ToolCall = z.infer<typeof ToolCallSchema>;

const FinishReasonSchema = z.enum(['stop', 'tool_calls', 'length', 'error', 'cancelled']);

type AgentEvent = 
  | { type: 'agent.start'; sessionId: string; input: string }
  | { type: 'agent.step'; sessionId: string; step: number }
  | { type: 'agent.complete'; sessionId: string; output: string }
  | { type: 'agent.error'; sessionId: string; error: { name: string; message: string } }
  | { type: 'llm.request'; sessionId: string }
  | { type: 'llm.response'; sessionId: string; content: string; toolCalls?: ToolCall[]; finishReason: FinishReasonSchema }
  | { type: 'llm.output.invalid'; sessionId: string; reason: string; attempt: number }
  | { type: 'tool.call'; sessionId: string; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool.execute'; sessionId: string; toolCallId: string; toolName: string }
  | { type: 'tool.result'; sessionId: string; toolCallId: string; toolName: string; result: string; isError: boolean }
  | { type: 'tool.batch'; sessionId: string; batchId: string; calls: ToolCall[] }
  | { type: 'tool.batch.start'; sessionId: string; batchId: string; totalCalls: number }
  | { type: 'tool.batch.complete'; sessionId: string; batchId: string; totalCalls: number; successCount: number }
  | { type: 'hitl.ask'; sessionId: string; askId: string; question: string }
  | { type: 'hitl.answer'; sessionId: string; askId: string; answer: string }
  | { type: 'done'; sessionId: string; reason: FinishReasonSchema };

interface BatchContext {
  batchId: string;
  totalCalls: number;
  completedCalls: number;
}

interface AgentState {
  sessionId: string;
  messages: Message[];
  step: number;
  maxSteps: number;
  output: string;
  pendingToolCalls: ToolCall[];
  batchContext?: BatchContext;
}

interface StepContext {
  event: AgentEvent;
  state: AgentState;
}

// ============================================================
// Part 2: Mock LLM Adapter
// ============================================================

interface MockLLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: FinishReasonSchema;
}

class MockLLMAdapter {
  private responses: MockLLMResponse[] = [];
  private callCount = 0;
  private failNTimes = 0;
  private failureCount = 0;

  setResponses(responses: MockLLMResponse[]): void {
    this.responses = responses;
    this.callCount = 0;
    this.failureCount = 0;
  }

  setFailNTimes(n: number): void {
    this.failNTimes = n;
    this.failureCount = 0;
  }

  async chat(_messages: Message[]): Promise<MockLLMResponse> {
    this.callCount++;
    
    if (this.failureCount < this.failNTimes) {
      this.failureCount++;
      throw new Error(`LLM API Error (attempt ${this.failureCount})`);
    }
    
    if (this.callCount <= this.responses.length) {
      return this.responses[this.callCount - 1];
    }
    
    return { content: 'Default response', finishReason: 'stop' };
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// ============================================================
// Part 3: Mock Tool Registry
// ============================================================

type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

class MockToolRegistry {
  private tools = new Map<string, ToolExecutor>();
  private executionLog: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];

  register(name: string, executor: ToolExecutor): void {
    this.tools.set(name, executor);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const executor = this.tools.get(name);
    if (!executor) {
      throw new Error(`Tool "${name}" not found`);
    }
    const result = await executor(args);
    this.executionLog.push({ name, args, result });
    return result;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getExecutionLog(): Array<{ name: string; args: Record<string, unknown>; result: string }> {
    return [...this.executionLog];
  }

  clearLog(): void {
    this.executionLog = [];
  }
}

// ============================================================
// Part 4: Agent Loop Implementation (Clean Rewrite)
// ============================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function serializeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'UnknownError', message: String(error) };
}

interface AgentLoopConfig {
  sessionId: string;
  maxSteps: number;
  maxLLMRepairAttempts: number;
  parallelToolCalls: boolean;
}

/**
 * Agent Loop - imperative async queue-based (imperative)
 */
function createAgentLoop(
  llm: MockLLMAdapter,
  toolRegistry: MockToolRegistry,
  config: AgentLoopConfig,
) {
  const sessionId = config.sessionId;
  let aborted = false;

  const initialState: AgentState = {
    sessionId,
    messages: [],
    step: 0,
    maxSteps: config.maxSteps,
    output: '',
    pendingToolCalls: [],
  };

  // Core step function - routes events, returns next contexts
  async function step(ctx: StepContext): Promise<StepContext[]> {
    const { event, state } = ctx;

    if (event.type === 'done' || event.type === 'agent.error') {
      return [];
    }

    switch (event.type) {
      case 'agent.start':
        return handleAgentStart(state);
      case 'llm.response':
        return handleLLMResponse(event, state);
      case 'tool.result':
        return handleToolResult(event, state);
      case 'tool.batch.complete':
        return handleBatchComplete(event, state);
      default:
        return [];
    }
  }

  async function handleAgentStart(state: AgentState): Promise<StepContext[]> {
    return callLLM({ ...state, step: 1 });
  }

  function handleLLMResponse(event: AgentEvent, state: AgentState): StepContext[] | Promise<StepContext[]> {
    if (event.type !== 'llm.response') return [];
    
    const { content, toolCalls, finishReason } = event;

    if (finishReason === 'stop' || !toolCalls?.length) {
      return [
        { event: { type: 'agent.complete', sessionId, output: content }, state },
        { event: { type: 'done', sessionId, reason: finishReason }, state },
      ] as StepContext[];
    }

    const invalidTools = toolCalls.filter(tc => !toolRegistry.has(tc.name));
    if (invalidTools.length > 0) {
      const reason = `Unknown tool(s): ${invalidTools.map(t => t.name).join(', ')}`;
      return [
        { event: { type: 'llm.output.invalid', sessionId, reason, attempt: 1 }, state },
        { event: { type: 'agent.error', sessionId, error: { name: 'InvalidTool', message: reason } }, state },
        { event: { type: 'done', sessionId, reason: 'error' }, state },
      ] as StepContext[];
    }

    if (toolCalls.length === 1 || !config.parallelToolCalls) {
      return executeSingleTool(toolCalls[0]!, state);
    }
    return executeBatchTools(toolCalls, state);
  }

  function handleToolResult(event: AgentEvent, state: AgentState): StepContext[] | Promise<StepContext[]> {
    if (event.type !== 'tool.result') return [];
    if (state.batchContext) return []; // batch handles its own

    const newState: AgentState = { ...state, step: state.step + 1 };
    
    if (newState.step > newState.maxSteps) {
      return [
        { event: { type: 'agent.complete', sessionId, output: 'Max steps reached' }, state: newState },
        { event: { type: 'done', sessionId, reason: 'length' }, state: newState },
      ] as StepContext[];
    }
    return callLLM(newState);
  }

  function handleBatchComplete(event: AgentEvent, state: AgentState): StepContext[] | Promise<StepContext[]> {
    if (event.type !== 'tool.batch.complete') return [];
    
    const newState: AgentState = { ...state, step: state.step + 1, batchContext: undefined, pendingToolCalls: [] };

    if (newState.step > newState.maxSteps) {
      return [
        { event: { type: 'agent.complete', sessionId, output: 'Max steps reached' }, state: newState },
        { event: { type: 'done', sessionId, reason: 'length' }, state: newState },
      ] as StepContext[];
    }
    return callLLM(newState);
  }

  async function executeSingleTool(tc: ToolCall, state: AgentState): Promise<StepContext[]> {
    const execEvent: AgentEvent = { type: 'tool.execute', sessionId, toolCallId: tc.id, toolName: tc.name };
    try {
      const result = await toolRegistry.execute(tc.name, tc.args);
      const resultEvent: AgentEvent = { type: 'tool.result', sessionId, toolCallId: tc.id, toolName: tc.name, result, isError: false };
      const newState: AgentState = { ...state, messages: [...state.messages, { role: 'tool', content: result, toolCallId: tc.id, toolName: tc.name }] };
      return [
        { event: execEvent, state },
        { event: resultEvent, state: newState },
      ] as StepContext[];
    } catch {
      const resultEvent: AgentEvent = { type: 'tool.result', sessionId, toolCallId: tc.id, toolName: tc.name, result: '', isError: true };
      return [
        { event: execEvent, state },
        { event: resultEvent, state },
      ] as StepContext[];
    }
  }

  async function executeBatchTools(toolCalls: ToolCall[], state: AgentState): Promise<StepContext[]> {
    const batchId = `batch-${generateId()}`;
    const batchState: AgentState = { ...state, pendingToolCalls: toolCalls, batchContext: { batchId, totalCalls: toolCalls.length, completedCalls: 0 } };

    const results = await Promise.all(
      toolCalls.map(async tc => {
        try {
          const result = await toolRegistry.execute(tc.name, tc.args);
          return { tc, result, isError: false };
        } catch {
          return { tc, result: '', isError: true };
        }
      })
    );

    let successCount = 0;
    const newMessages: Message[] = [];
    const events: StepContext[] = [];

    events.push({ event: { type: 'tool.batch.start', sessionId, batchId, totalCalls: toolCalls.length }, state: batchState });
    events.push({ event: { type: 'tool.batch', sessionId, batchId, calls: toolCalls }, state: batchState });

    for (const r of results) {
      events.push({ event: { type: 'tool.execute', sessionId, toolCallId: r.tc.id, toolName: r.tc.name }, state: batchState });
      events.push({ event: { type: 'tool.result', sessionId, toolCallId: r.tc.id, toolName: r.tc.name, result: r.result, isError: r.isError }, state: batchState });
      newMessages.push({ role: 'tool', content: r.result, toolCallId: r.tc.id, toolName: r.tc.name });
      if (!r.isError) successCount++;
    }

    const completeState: AgentState = { ...state, messages: [...state.messages, ...newMessages], pendingToolCalls: [], batchContext: undefined };
    events.push({ event: { type: 'tool.batch.complete', sessionId, batchId, totalCalls: toolCalls.length, successCount }, state: completeState });

    return events;
  }

  async function callLLM(state: AgentState): Promise<StepContext[]> {
    try {
      const response = await llm.chat(state.messages);
      const event: AgentEvent = {
        type: 'llm.response',
        sessionId,
        content: response.content,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason,
      };
      return [{ event, state } as StepContext];
    } catch (error) {
      const event: AgentEvent = { type: 'agent.error', sessionId, error: serializeError(error) };
      const doneEvent: AgentEvent = { type: 'done', sessionId, reason: 'error' };
      return [
        { event, state },
        { event: doneEvent, state },
      ] as StepContext[];
    }
  }

  // Run entry �?returns all events in order
  async function run(input: string): Promise<AgentEvent[]> {
    const allEvents: AgentEvent[] = [];
    const startEvent: AgentEvent = { type: 'agent.start', sessionId, input };
    const stateWithInput: AgentState = { ...initialState, messages: [{ role: 'user', content: input }] };

    const queue: StepContext[] = [{ event: startEvent, state: stateWithInput }];

    while (queue.length > 0 && !aborted) {
      const ctx = queue.shift()!;
      allEvents.push(ctx.event);
      const next = await step(ctx);
      queue.push(...next);
    }

    return allEvents;
  }

  return { run };
}

// ============================================================
// Part 5: Tests
// ============================================================

describe('Agent Loop - Phase 0 Prototype', () => {
  let llm: MockLLMAdapter;
  let toolRegistry: MockToolRegistry;
  const sessionId = 'test-session';

  beforeEach(() => {
    llm = new MockLLMAdapter();
    toolRegistry = new MockToolRegistry();
    
    toolRegistry.register('weather', async (args) => {
      const city = args.city as string;
      return JSON.stringify({ city, temp: 25, condition: 'sunny' });
    });
    
    toolRegistry.register('calculator', async (args) => {
      const a = args.a as number;
      const b = args.b as number;
      return String(a + b);
    });
    
    toolRegistry.register('search', async (args) => {
      const query = args.query as string;
      return `Results for: ${query}`;
    });
  });

  // ========================================
  // Test 1: Normal conversation
  // ========================================
  describe('Scenario 1: Normal conversation', () => {
    it('should complete without tool calls', async () => {
      llm.setResponses([
        { content: 'Hello! How can I help you?', finishReason: 'stop' },
      ]);

      const agent = createAgentLoop(llm, toolRegistry, {
        sessionId,
        maxSteps: 10,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: true,
      });

      const events = await agent.run('Hi there');

      const types = events.map(e => e.type);
      expect(types).toContain('agent.start');
      expect(types).toContain('llm.response');
      expect(types).toContain('agent.complete');
      expect(types).toContain('done');

      const complete = events.find(e => e.type === 'agent.complete');
      expect(complete).toBeDefined();
      if (complete?.type === 'agent.complete') {
        expect(complete.output).toBe('Hello! How can I help you?');
      }
    });
  });

  // ========================================
  // Test 2: Single tool call
  // ========================================
  describe('Scenario 2: Single tool call', () => {
    it('should execute single tool and continue', async () => {
      llm.setResponses([
        { 
          content: '', 
          toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Beijing' } }],
          finishReason: 'tool_calls',
        },
        { content: 'The weather in Beijing is sunny with 25°C.', finishReason: 'stop' },
      ]);

      const agent = createAgentLoop(llm, toolRegistry, {
        sessionId,
        maxSteps: 10,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: false,
      });

      const events = await agent.run('What is the weather in Beijing?');

      const types = events.map(e => e.type);
      expect(types).toContain('tool.execute');
      expect(types).toContain('tool.result');

      // 验证事件顺序：tool.execute �?tool.result 之前
      const execIdx = types.indexOf('tool.execute');
      const resultIdx = types.indexOf('tool.result');
      expect(execIdx).toBeGreaterThan(-1);
      expect(resultIdx).toBeGreaterThan(execIdx);

      const log = toolRegistry.getExecutionLog();
      expect(log).toHaveLength(1);
      expect(log[0].name).toBe('weather');
      expect(log[0].args).toEqual({ city: 'Beijing' });

      const complete = events.find(e => e.type === 'agent.complete');
      expect(complete).toBeDefined();

      expect(llm.getCallCount()).toBe(2);
    });
  });

  // ========================================
  // Test 3: Parallel tool calls
  // ========================================
  describe('Scenario 3: Parallel tool calls', () => {
    it('should execute tools in parallel and detect batch completion', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: 'weather', args: { city: 'Beijing' } },
            { id: 'tc-2', name: 'weather', args: { city: 'Shanghai' } },
            { id: 'tc-3', name: 'calculator', args: { a: 10, b: 20 } },
          ],
          finishReason: 'tool_calls',
        },
        { content: 'Here are the results for all three queries.', finishReason: 'stop' },
      ]);

      const agent = createAgentLoop(llm, toolRegistry, {
        sessionId,
        maxSteps: 10,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: true,
      });

      const events = await agent.run('Check weather and calculate');

      expect(events.find(e => e.type === 'tool.batch.start')).toBeDefined();
      expect(events.find(e => e.type === 'tool.batch')).toBeDefined();
      expect(events.find(e => e.type === 'tool.batch.complete')).toBeDefined();

      const log = toolRegistry.getExecutionLog();
      expect(log).toHaveLength(3);

      const batchComplete = events.find(e => e.type === 'tool.batch.complete');
      expect(batchComplete).toBeDefined();
      if (batchComplete?.type === 'tool.batch.complete') {
        expect(batchComplete.totalCalls).toBe(3);
      }

      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });

    it('should handle batch with tool failure', async () => {
      toolRegistry.register('failing_tool', async () => {
        throw new Error('Tool execution failed');
      });

      llm.setResponses([
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: 'weather', args: { city: 'Beijing' } },
            { id: 'tc-2', name: 'failing_tool', args: {} },
          ],
          finishReason: 'tool_calls',
        },
        { content: 'Processed results.', finishReason: 'stop' },
      ]);

      const agent = createAgentLoop(llm, toolRegistry, {
        sessionId,
        maxSteps: 10,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: true,
      });

      const events = await agent.run('Test batch with failure');

      const toolResults = events.filter(e => e.type === 'tool.result');
      expect(toolResults).toHaveLength(2);

      const errorResult = toolResults.find(r => 
        r.type === 'tool.result' && r.isError === true
      );
      expect(errorResult).toBeDefined();
    });
  });

  // ========================================
  // Test 4: LLM output validation
  // ========================================
  describe('Scenario 4: LLM output validation', () => {
    it('should detect invalid tool call', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'nonexistent_tool', args: {} }],
          finishReason: 'tool_calls',
        },
      ]);

      const agent = createAgentLoop(llm, toolRegistry, {
        sessionId,
        maxSteps: 10,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: false,
      });

      const events = await agent.run('Get weather');

      expect(events.find(e => e.type === 'llm.output.invalid')).toBeDefined();
      expect(events.find(e => e.type === 'agent.error')).toBeDefined();

      // 验证事件顺序：llm.output.invalid �?agent.error 之前
      const invalidIdx = events.findIndex(e => e.type === 'llm.output.invalid');
      const errorIdx = events.findIndex(e => e.type === 'agent.error');
      expect(invalidIdx).toBeGreaterThan(-1);
      expect(errorIdx).toBeGreaterThan(invalidIdx);
    });
  });

  // ========================================
  // Test 5: HITL simulation
  // ========================================
  describe('Scenario 5: HITL simulation', () => {
    it('should execute tool that simulates HITL', async () => {
      toolRegistry.register('ask_permission', async (args) => {
        const action = args.action as string;
        return `HITL_REQUIRED:${action}`;
      });

      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'ask_permission', args: { action: 'delete_file' } }],
          finishReason: 'tool_calls',
        },
        { content: 'Permission granted. Proceeding with action.', finishReason: 'stop' },
      ]);

      const agent = createAgentLoop(llm, toolRegistry, {
        sessionId,
        maxSteps: 10,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: false,
      });

      const events = await agent.run('Delete the test file');

      // 验证工具被调用（通过 registry log�?
      const log = toolRegistry.getExecutionLog();
      expect(log).toHaveLength(1);
      expect(log[0].name).toBe('ask_permission');
      expect(log[0].result).toContain('HITL_REQUIRED');

      // 验证 tool.result 事件包含 HITL 标记
      const toolResult = events.find(
        (e): e is Extract<AgentEvent, { type: 'tool.result' }> => e.type === 'tool.result'
      );
      expect(toolResult).toBeDefined();
      expect(toolResult!.result).toContain('HITL_REQUIRED');
    });
  });

  // ========================================
  // Test 6: Error handling
  // ========================================
  describe('Scenario 6: Error handling', () => {
    it('should handle tool execution errors gracefully', async () => {
      toolRegistry.register('crash_tool', async () => {
        throw new Error('Tool crashed');
      });

      llm.setResponses([
        { content: '', toolCalls: [{ id: 'tc-1', name: 'crash_tool', args: {} }], finishReason: 'tool_calls' },
      ]);

      const agent = createAgentLoop(llm, toolRegistry, {
        sessionId,
        maxSteps: 10,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: false,
      });

      const events = await agent.run('Test error handling');

      const toolResult = events.find(e => e.type === 'tool.result');
      expect(toolResult).toBeDefined();
      if (toolResult?.type === 'tool.result') {
        expect(toolResult.isError).toBe(true);
      }
    });

    it('should handle LLM errors', async () => {
      // LLM 错误被转换为 agent.error + done 事件（errors-as-events 设计�?
      // 外层 retry 不会触发因为流正常完成（只是事件类型是错误）
      llm.setFailNTimes(1);
      llm.setResponses([
        { content: 'Success after retry!', finishReason: 'stop' },
      ]);

      const agent = createAgentLoop(llm, toolRegistry, {
        sessionId,
        maxSteps: 10,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: false,
      });

      const events = await agent.run('Test LLM error');

      // LLM 错误被捕获并转换为事�?
      expect(events.find(e => e.type === 'agent.error')).toBeDefined();
      expect(events.find(e => e.type === 'done')).toBeDefined();
      if (events.find(e => e.type === 'done')?.type === 'done') {
        expect(events.find(e => e.type === 'done')?.reason).toBe('error');
      }
    });

    it('should respect max steps limit', async () => {
      // 每次都返�?tool_calls，导致循�?
      llm.setResponses([
        { content: '', toolCalls: [{ id: 'tc-1', name: 'calculator', args: { a: 1, b: 2 } }], finishReason: 'tool_calls' },
        { content: '', toolCalls: [{ id: 'tc-2', name: 'calculator', args: { a: 2, b: 3 } }], finishReason: 'tool_calls' },
        { content: '', toolCalls: [{ id: 'tc-3', name: 'calculator', args: { a: 3, b: 4 } }], finishReason: 'tool_calls' },
        { content: '', toolCalls: [{ id: 'tc-4', name: 'calculator', args: { a: 4, b: 5 } }], finishReason: 'tool_calls' },
      ]);

      const agent = createAgentLoop(llm, toolRegistry, {
        sessionId,
        maxSteps: 2,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: false,
      });

      const events = await agent.run('Loop test');

      // 验证�?max steps 而完�?
      const complete = events.find(e => e.type === 'agent.complete');
      expect(complete).toBeDefined();
      if (complete?.type === 'agent.complete') {
        expect(complete.output).toBe('Max steps reached');
      }
      
      const done = events.find(e => e.type === 'done');
      expect(done).toBeDefined();
      if (done?.type === 'done') {
        expect(done.reason).toBe('length');
      }
    });
  });
});
