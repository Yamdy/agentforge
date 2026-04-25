/**
 * Phase 2a: Agent Loop Tests
 *
 * Tests for the core agent loop implementation using Phase 1 types.
 * Validates event routing, LLM calls, tool execution, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Observable,
  of,
  from,
  Subject,
  firstValueFrom,
  toArray,
} from 'rxjs';
import {
  createAgentLoop,
  type AgentLoopConfig,
  type StepContext,
} from '../../src/loop/agent-loop.js';
import {
  type AgentContext,
  type AgentState,
  type AgentEvent,
  type ToolCall,
  type LLMResponse,
  type LLMAdapter,
  type ToolRegistry,
  type ToolDefinition,
  type CheckpointStorage,
  InMemoryStore,
  DefaultPauseController,
  DefaultHITLController,
  SimpleSchemaRegistry,
} from '../../src/core/index.js';

// ============================================================
// Mock LLM Adapter
// ============================================================

interface MockLLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';
  usage?: { promptTokens: number; completionTokens: number };
}

class MockLLMAdapter implements LLMAdapter {
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

  async chat(_messages: AgentState['messages']): Promise<LLMResponse> {
    this.callCount++;

    if (this.failureCount < this.failNTimes) {
      this.failureCount++;
      throw new Error(`LLM API Error (attempt ${this.failureCount})`);
    }

    if (this.callCount <= this.responses.length) {
      const r = this.responses[this.callCount - 1]!;
      return {
        content: r.content,
        toolCalls: r.toolCalls,
        finishReason: r.finishReason,
        usage: r.usage,
      };
    }

    return { content: 'Default response', finishReason: 'stop' };
  }

  stream(_messages: AgentState['messages']): Observable<LLMResponse> {
    return of({ content: 'stream', finishReason: 'stop' });
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// ============================================================
// Mock Tool Registry
// ============================================================

type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

class MockToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private executionLog: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];

  register(name: string, executor: ToolExecutor): void {
    this.tools.set(name, {
      name,
      description: `Tool: ${name}`,
      parameters: {},
      execute: executor,
    });
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getFunctionDef(name: string) {
    const tool = this.tools.get(name);
    if (!tool) return undefined;
    return {
      name: tool.name,
      description: tool.description,
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  getFunctionDefs() {
    return this.list().map(n => this.getFunctionDef(n)!);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    _ctx?: unknown,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    const result = await tool.execute(args);
    this.executionLog.push({ name, args, result });
    return result;
  }

  registerAll(_tools: ToolDefinition[]): void {}

  getExecutionLog(): Array<{ name: string; args: Record<string, unknown>; result: string }> {
    return [...this.executionLog];
  }

  clearLog(): void {
    this.executionLog = [];
  }
}

// ============================================================
// Test Helper: Create Agent Context
// ============================================================

function createTestContext(
  llm: MockLLMAdapter,
  toolRegistry: MockToolRegistry,
): AgentContext {
  const sessionId = `test-session-${Date.now()}`;

  return {
    sessionId,
    agentName: 'test-agent',
    memory: new InMemoryStore(),
    pauseController: new DefaultPauseController(),
    services: {
      schemaRegistry: new SimpleSchemaRegistry(),
      llmFactory: { create: () => llm },
      toolRegistry,
    },
    llm,
    tools: toolRegistry,
  };
}

function createTestConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    model: { provider: 'mock', model: 'test-model' },
    maxSteps: 10,
    maxLLMRepairAttempts: 3,
    parallelToolCalls: true,
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('Phase 2a: Agent Loop', () => {
  let llm: MockLLMAdapter;
  let toolRegistry: MockToolRegistry;

  beforeEach(() => {
    llm = new MockLLMAdapter();
    toolRegistry = new MockToolRegistry();

    // Register test tools
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
  // Scenario 1: Normal conversation
  // ========================================
  describe('Scenario 1: Normal conversation', () => {
    it('should complete without tool calls', async () => {
      llm.setResponses([
        { content: 'Hello! How can I help you?', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Hi there').pipe(toArray()));

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

      // Verify timestamps are present
      for (const event of events) {
        expect(event.timestamp).toBeDefined();
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });
  });

  // ========================================
  // Scenario 2: Single tool call
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

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('What is the weather in Beijing?').pipe(toArray()));

      const types = events.map(e => e.type);
      expect(types).toContain('tool.execute');
      expect(types).toContain('tool.result');

      // Verify event order: tool.execute before tool.result
      const execIdx = types.indexOf('tool.execute');
      const resultIdx = types.indexOf('tool.result');
      expect(execIdx).toBeGreaterThan(-1);
      expect(resultIdx).toBeGreaterThan(execIdx);

      const log = toolRegistry.getExecutionLog();
      expect(log).toHaveLength(1);
      expect(log[0]?.name).toBe('weather');
      expect(log[0]?.args).toEqual({ city: 'Beijing' });

      const complete = events.find(e => e.type === 'agent.complete');
      expect(complete).toBeDefined();

      expect(llm.getCallCount()).toBe(2);
    });
  });

  // ========================================
  // Scenario 3: Parallel tool calls
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

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: true });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Check weather and calculate').pipe(toArray()));

      expect(events.find(e => e.type === 'tool.batch.start')).toBeDefined();
      expect(events.find(e => e.type === 'tool.batch')).toBeDefined();
      expect(events.find(e => e.type === 'tool.batch.complete')).toBeDefined();

      const log = toolRegistry.getExecutionLog();
      expect(log).toHaveLength(3);

      const batchComplete = events.find(e => e.type === 'tool.batch.complete');
      expect(batchComplete).toBeDefined();
      if (batchComplete?.type === 'tool.batch.complete') {
        expect(batchComplete.totalCalls).toBe(3);
        expect(batchComplete.successCount).toBe(3);
        expect(batchComplete.errorCount).toBe(0);
        expect(batchComplete.durationMs).toBeGreaterThanOrEqual(0);
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

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: true });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Test batch with failure').pipe(toArray()));

      // Batch emits tool.result for each tool in the batch
      const toolResults = events.filter(e => e.type === 'tool.result');
      expect(toolResults).toHaveLength(2);

      const errorResult = toolResults.find(
        r => r.type === 'tool.result' && r.isError === true,
      );
      expect(errorResult).toBeDefined();

      const batchComplete = events.find(e => e.type === 'tool.batch.complete');
      expect(batchComplete).toBeDefined();
      if (batchComplete?.type === 'tool.batch.complete') {
        expect(batchComplete.errorCount).toBe(1);
        expect(batchComplete.successCount).toBe(1);
      }

      // Should complete after batch (LLM processes error results)
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });
  });

  // ========================================
  // Scenario 4: LLM output validation
  // ========================================
  describe('Scenario 4: LLM output validation', () => {
    it('should detect invalid tool call and attempt repair', async () => {
      // First response has invalid tool, subsequent responses are valid
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'nonexistent_tool', args: {} }],
          finishReason: 'tool_calls',
        },
        { content: 'I cannot find that tool.', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ maxLLMRepairAttempts: 2 });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Get weather').pipe(toArray()));

      expect(events.find(e => e.type === 'llm.output.invalid')).toBeDefined();

      // Should complete after repair (even if the repair response just stops)
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });

    it('should emit agent.error after exhausting repair attempts', async () => {
      // All responses have invalid tools
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'bad_tool_1', args: {} }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'tc-2', name: 'bad_tool_2', args: {} }],
          finishReason: 'tool_calls',
        },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ maxLLMRepairAttempts: 1 });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Get weather').pipe(toArray()));

      // Should emit invalid event
      expect(events.find(e => e.type === 'llm.output.invalid')).toBeDefined();

      // Should terminate with error after exhausting repair attempts
      expect(events.find(e => e.type === 'agent.error')).toBeDefined();

      const done = events.find(e => e.type === 'done');
      expect(done).toBeDefined();
      if (done?.type === 'done') {
        expect(done.reason).toBe('error');
      }
    });
  });

  // ========================================
  // Scenario 5: HITL simulation
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

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Delete the test file').pipe(toArray()));

      // Two LLM calls = two tool executions (ask_permission first, then nothing second)
      // Actually - second LLM call doesn't have tools, so only one tool execution
      const log = toolRegistry.getExecutionLog();
      // Note: The log might show multiple executions if we have multiple tool calls
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log[0]?.name).toBe('ask_permission');
      expect(log[0]?.result).toContain('HITL_REQUIRED');

      const toolResult = events.find(e => e.type === 'tool.result');
      expect(toolResult).toBeDefined();
      if (toolResult?.type === 'tool.result') {
        expect(toolResult.result).toContain('HITL_REQUIRED');
      }
    });
  });

  // ========================================
  // Scenario 6: Error handling
  // ========================================
  describe('Scenario 6: Error handling', () => {
    it('should handle tool execution errors gracefully', async () => {
      toolRegistry.register('crash_tool', async () => {
        throw new Error('Tool crashed');
      });

      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'crash_tool', args: {} }],
          finishReason: 'tool_calls',
        },
        { content: 'Tool execution failed, but I handled the error.', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Test error handling').pipe(toArray()));

      const toolResult = events.find(e => e.type === 'tool.result');
      expect(toolResult).toBeDefined();
      if (toolResult?.type === 'tool.result') {
        expect(toolResult.isError).toBe(true);
        expect(toolResult.result).toContain('Tool crashed');
      }

      // Should still complete after error
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });

    it('should handle LLM errors', async () => {
      llm.setFailNTimes(1);
      llm.setResponses([
        { content: 'Success after retry!', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Test LLM error').pipe(toArray()));

      // LLM error should be captured as events
      expect(events.find(e => e.type === 'agent.error')).toBeDefined();
      expect(events.find(e => e.type === 'done')).toBeDefined();

      const doneEvent = events.find(e => e.type === 'done');
      if (doneEvent?.type === 'done') {
        expect(doneEvent.reason).toBe('error');
      }
    });

    it('should respect max steps limit', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'calculator', args: { a: 1, b: 2 } }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'tc-2', name: 'calculator', args: { a: 2, b: 3 } }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'tc-3', name: 'calculator', args: { a: 3, b: 4 } }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'tc-4', name: 'calculator', args: { a: 4, b: 5 } }],
          finishReason: 'tool_calls',
        },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ maxSteps: 2, parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Loop test').pipe(toArray()));

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

  // ========================================
  // Scenario 7: Agent step events
  // ========================================
  describe('Scenario 7: Agent step events', () => {
    it('should increment step after tool execution', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'calculator', args: { a: 1, b: 2 } }],
          finishReason: 'tool_calls',
        },
        { content: 'Done!', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Test step events').pipe(toArray()));

      // Verify LLM was called twice (step 1 and step 2)
      expect(llm.getCallCount()).toBe(2);

      // Verify complete shows 2 steps
      const complete = events.find(e => e.type === 'agent.complete');
      expect(complete).toBeDefined();
      if (complete?.type === 'agent.complete') {
        expect(complete.steps).toBe(2);
      }
    });
  });

  // ========================================
  // Scenario 8: LLM request/response
  // ========================================
  describe('Scenario 8: LLM request/response', () => {
    it('should emit llm.response with content', async () => {
      llm.setResponses([
        { content: 'Response', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Hello').pipe(toArray()));

      const response = events.find(e => e.type === 'llm.response');
      expect(response).toBeDefined();
      if (response?.type === 'llm.response') {
        expect(response.content).toBe('Response');
        expect(response.finishReason).toBe('stop');
      }
    });
  });

  // ========================================
  // Scenario 9: Token tracking
  // ========================================
  describe('Scenario 9: Token tracking', () => {
    it('should include usage in llm.response when available', async () => {
      llm.setResponses([
        {
          content: 'Response',
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 50 },
        },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Hello').pipe(toArray()));

      const response = events.find(e => e.type === 'llm.response');
      expect(response).toBeDefined();
      if (response?.type === 'llm.response') {
        expect(response.usage).toBeDefined();
        expect(response.usage?.promptTokens).toBe(100);
        expect(response.usage?.completionTokens).toBe(50);
      }
    });
  });

  // ========================================
  // Scenario 10: LLM repair loop
  // ========================================
  describe('Scenario 10: LLM repair loop', () => {
    it('should retry LLM after invalid tool call and succeed', async () => {
      // First LLM response: invalid tool call
      // Second LLM response (after repair): valid tool call
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'nonexistent_tool', args: {} }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'tc-2', name: 'weather', args: { city: 'Beijing' } }],
          finishReason: 'tool_calls',
        },
        { content: 'The weather is sunny!', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ maxLLMRepairAttempts: 3, parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Get weather').pipe(toArray()));

      // Should emit llm.output.invalid then repair
      expect(events.find(e => e.type === 'llm.output.invalid')).toBeDefined();

      // Should eventually complete successfully
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();

      // LLM should have been called 3 times: initial + repair + after tool
      expect(llm.getCallCount()).toBe(3);
    });

    it('should terminate after max repair attempts', async () => {
      // All LLM responses return invalid tool calls
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'bad_tool', args: {} }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'tc-2', name: 'another_bad_tool', args: {} }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'tc-3', name: 'still_bad', args: {} }],
          finishReason: 'tool_calls',
        },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ maxLLMRepairAttempts: 2, parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Test repair').pipe(toArray()));

      // Should emit multiple invalid events
      const invalidEvents = events.filter(e => e.type === 'llm.output.invalid');
      expect(invalidEvents.length).toBeGreaterThanOrEqual(2);

      // Should terminate with error
      expect(events.find(e => e.type === 'agent.error')).toBeDefined();

      const done = events.find(e => e.type === 'done');
      expect(done).toBeDefined();
      if (done?.type === 'done') {
        expect(done.reason).toBe('error');
      }
    });
  });

  // ========================================
  // Scenario 11: Pause/Resume
  // ========================================
  describe('Scenario 11: Pause/Resume', () => {
    it('should pause and resume execution', async () => {
      llm.setResponses([
        { content: 'First response', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);

      // Pause before running
      ctx.pauseController.pause();

      // Start the loop - it should block
      const eventsPromise = firstValueFrom(agent.run('Hello').pipe(toArray()));

      // Resume after a short delay
      setTimeout(() => {
        ctx.pauseController.resume();
      }, 50);

      const events = await eventsPromise;

      // Should complete after resume
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });
  });

  // ========================================
  // Scenario 12: HITL with hitl.ask/hitl.answer
  // ========================================
  describe('Scenario 12: HITL with hitl.ask/hitl.answer events', () => {
    it('should emit hitl.ask and hitl.answer events for HITL tools', async () => {
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
        { content: 'Permission granted. Proceeding.', finishReason: 'stop' },
      ]);

      // Create context with HITL controller using Observable + Subject pattern
      // This tests the real async HITL flow: ask() returns Observable that
      // waits for external answer() call
      const sessionId = `test-hitl-${Date.now()}`;
      const hitlController = new DefaultHITLController();

      const ctx: AgentContext = {
        sessionId,
        agentName: 'test-agent',
        memory: new InMemoryStore(),
        pauseController: new DefaultPauseController(),
        services: {
          schemaRegistry: new SimpleSchemaRegistry(),
          llmFactory: { create: () => llm },
          toolRegistry,
        },
        llm,
        tools: toolRegistry,
        hitl: hitlController,
      };

      const config = createTestConfig({ parallelToolCalls: false });
      const agent = createAgentLoop(ctx, config);

      // Subscribe to onAsk() to answer when HITL prompts.
      // This simulates a UI that listens for prompts and calls answer().
      // Uses setTimeout to ensure answer arrives after the Observable subscription
      // is fully established (observeOn(asyncScheduler) in handleHITLAsk ensures this).
      const askSubscription = hitlController.onAsk().subscribe(ask => {
        setTimeout(() => {
          hitlController.answer(ask.askId, 'Yes, proceed');
        }, 0);
      });

      const events = await firstValueFrom(agent.run('Delete file').pipe(toArray()));
      askSubscription.unsubscribe();

      // Should emit hitl.ask event
      const askEvent = events.find(e => e.type === 'hitl.ask');
      expect(askEvent).toBeDefined();
      if (askEvent?.type === 'hitl.ask') {
        expect(askEvent.question).toContain('delete_file');
      }

      // hitl.answer is emitted when answer arrives
      const answerEvent = events.find(e => e.type === 'hitl.answer');
      expect(answerEvent).toBeDefined();
      if (answerEvent?.type === 'hitl.answer') {
        expect(answerEvent.answer).toBe('Yes, proceed');
      }

      // tool.result follows with the answer
      const toolResult = events.find(e => e.type === 'tool.result');
      expect(toolResult).toBeDefined();
      if (toolResult?.type === 'tool.result') {
        expect(toolResult.result).toBe('Yes, proceed');
      }

      // Should complete normally
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });

    it('should work without HITL controller for HITL_REQUIRED tools', async () => {
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
        { content: 'Proceeding without HITL.', finishReason: 'stop' },
      ]);

      // No HITL controller
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Delete file').pipe(toArray()));

      // Without HITL controller, the HITL_REQUIRED: prefix stays in the result
      const toolResult = events.find(e => e.type === 'tool.result');
      expect(toolResult).toBeDefined();
      if (toolResult?.type === 'tool.result') {
        expect(toolResult.result).toContain('HITL_REQUIRED:');
        expect(toolResult.isError).toBe(false);
      }

      // Should still complete
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });
  });

  // ========================================
  // Scenario 13: Event routing
  // ========================================
  describe('Scenario 13: Event routing', () => {
    it('should emit agent.step and llm.request on agent start', async () => {
      llm.setResponses([
        { content: 'Hello!', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Hi').pipe(toArray()));

      const types = events.map(e => e.type);

      // Should have agent.start, agent.step, llm.request in that order
      expect(types).toContain('agent.start');
      expect(types).toContain('agent.step');
      expect(types).toContain('llm.request');
      expect(types).toContain('llm.response');

      // Verify order: agent.start -> agent.step -> llm.request -> llm.response
      const startIdx = types.indexOf('agent.start');
      const stepIdx = types.indexOf('agent.step');
      const requestIdx = types.indexOf('llm.request');
      const responseIdx = types.indexOf('llm.response');

      expect(startIdx).toBeLessThan(stepIdx);
      expect(stepIdx).toBeLessThan(requestIdx);
      expect(requestIdx).toBeLessThan(responseIdx);

      // Verify llm.request has correct fields
      const requestEvent = events.find(e => e.type === 'llm.request');
      expect(requestEvent).toBeDefined();
      if (requestEvent?.type === 'llm.request') {
        expect(requestEvent.messages).toBeDefined();
        expect(requestEvent.model).toBeDefined();
        expect(requestEvent.tools).toEqual(['weather', 'calculator', 'search']);
      }
    });

    it('should emit tool.call before tool execution', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Beijing' } }],
          finishReason: 'tool_calls',
        },
        { content: 'Weather report complete.', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Get weather').pipe(toArray()));

      const types = events.map(e => e.type);

      // Should have tool.call, tool.execute, tool.result
      expect(types).toContain('tool.call');
      expect(types).toContain('tool.execute');
      expect(types).toContain('tool.result');

      // Verify order: tool.call -> tool.execute -> tool.result
      const callIdx = types.indexOf('tool.call');
      const execIdx = types.indexOf('tool.execute');
      const resultIdx = types.indexOf('tool.result');

      expect(callIdx).toBeGreaterThan(-1);
      expect(execIdx).toBeGreaterThan(callIdx);
      expect(resultIdx).toBeGreaterThan(execIdx);

      // Verify tool.call has correct fields
      const callEvent = events.find(e => e.type === 'tool.call');
      expect(callEvent).toBeDefined();
      if (callEvent?.type === 'tool.call') {
        expect(callEvent.toolCallId).toBe('tc-1');
        expect(callEvent.toolName).toBe('weather');
        expect(callEvent.args).toEqual({ city: 'Beijing' });
      }
    });

    it('should emit events in correct order: llm.request → llm.response', async () => {
      llm.setResponses([
        { content: 'First response', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Hello').pipe(toArray()));

      // Find all events before llm.response
      const responseIdx = events.findIndex(e => e.type === 'llm.response');
      const beforeResponse = events.slice(0, responseIdx);

      // llm.request should be before llm.response
      const hasRequestBefore = beforeResponse.some(e => e.type === 'llm.request');
      expect(hasRequestBefore).toBe(true);

      // agent.step should be before llm.request
      const requestIdxInBefore = beforeResponse.findIndex(e => e.type === 'llm.request');
      const hasStepBeforeRequest = beforeResponse.slice(0, requestIdxInBefore).some(e => e.type === 'agent.step');
      expect(hasStepBeforeRequest).toBe(true);
    });

    it('should emit llm.request after tool.result for next step', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'calculator', args: { a: 1, b: 2 } }],
          finishReason: 'tool_calls',
        },
        { content: 'Done!', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Calculate').pipe(toArray()));

      const types = events.map(e => e.type);

      // Should have two llm.request events (one per step)
      const requestCount = types.filter(t => t === 'llm.request').length;
      expect(requestCount).toBe(2);

      // Should have two agent.step events
      const stepCount = types.filter(t => t === 'agent.step').length;
      expect(stepCount).toBe(2);

      // Verify second llm.request comes after tool.result
      const resultIdx = types.indexOf('tool.result');
      const requestsAfterResult = types.slice(resultIdx + 1).filter(t => t === 'llm.request');
      expect(requestsAfterResult.length).toBe(1);
    });

    it('should emit tool.call for each single tool call', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: 'weather', args: { city: 'Tokyo' } },
          ],
          finishReason: 'tool_calls',
        },
        { content: 'Done', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Weather').pipe(toArray()));

      // Should have exactly one tool.call for single tool
      const callEvents = events.filter(e => e.type === 'tool.call');
      expect(callEvents.length).toBe(1);

      // Verify tool.call fields
      if (callEvents[0]?.type === 'tool.call') {
        expect(callEvents[0].toolCallId).toBe('tc-1');
        expect(callEvents[0].toolName).toBe('weather');
      }
    });
  });

  // ========================================
  // Scenario 14: Checkpoint integration
  // ========================================
  describe('Checkpoint integration', () => {
    it('should emit checkpoint event when enabled', async () => {
      const mockStorage: CheckpointStorage = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
        deleteAll: vi.fn().mockResolvedValue(undefined),
      };

      llm.setResponses([
        { content: 'Hello!', finishReason: 'stop' },
      ]);

      const ctx: AgentContext = {
        ...createTestContext(llm, toolRegistry),
        checkpoint: mockStorage,
      };
      const config = createTestConfig({
        checkpoint: { enabled: true, interval: 'llm_response' },
      });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Hi').pipe(toArray()));

      // Should emit a checkpoint event
      const checkpointEvents = events.filter(e => e.type === 'checkpoint');
      expect(checkpointEvents.length).toBeGreaterThan(0);

      // Verify checkpoint event fields
      const cpEvent = checkpointEvents[0]!;
      if (cpEvent.type === 'checkpoint') {
        expect(cpEvent.position).toBe('after_llm');
        expect(cpEvent.checkpointId).toBeDefined();
        expect(cpEvent.state).toBeDefined();
      }

      // Verify storage.save was called
      expect(mockStorage.save).toHaveBeenCalled();

      // Verify the saved checkpoint has the right position
      const savedCheckpoint = (mockStorage.save as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(savedCheckpoint.position).toBe('after_llm');
      expect(savedCheckpoint.sessionId).toBe(ctx.sessionId);
    });

    it('should not emit checkpoint event when disabled', async () => {
      const mockStorage: CheckpointStorage = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
        deleteAll: vi.fn().mockResolvedValue(undefined),
      };

      llm.setResponses([
        { content: 'Hello!', finishReason: 'stop' },
      ]);

      const ctx: AgentContext = {
        ...createTestContext(llm, toolRegistry),
        checkpoint: mockStorage,
      };
      // No checkpoint config = disabled by default
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Hi').pipe(toArray()));

      // Should NOT emit checkpoint events
      const checkpointEvents = events.filter(e => e.type === 'checkpoint');
      expect(checkpointEvents).toHaveLength(0);

      // Should NOT call storage.save
      expect(mockStorage.save).not.toHaveBeenCalled();
    });

    it('should not emit checkpoint event when storage is not configured', async () => {
      llm.setResponses([
        { content: 'Hello!', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      // No checkpoint storage on context
      const config = createTestConfig({
        checkpoint: { enabled: true, interval: 'llm_response' },
      });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Hi').pipe(toArray()));

      // Should NOT emit checkpoint events (no storage)
      const checkpointEvents = events.filter(e => e.type === 'checkpoint');
      expect(checkpointEvents).toHaveLength(0);
    });

    it('should save checkpoint at after_llm position after tool call response', async () => {
      const mockStorage: CheckpointStorage = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
        deleteAll: vi.fn().mockResolvedValue(undefined),
      };

      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Beijing' } }],
          finishReason: 'tool_calls',
        },
        { content: 'The weather is sunny!', finishReason: 'stop' },
      ]);

      const ctx: AgentContext = {
        ...createTestContext(llm, toolRegistry),
        checkpoint: mockStorage,
      };
      const config = createTestConfig({
        parallelToolCalls: false,
        checkpoint: { enabled: true, interval: 'llm_response' },
      });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Get weather').pipe(toArray()));

      // Should emit checkpoint events for each LLM response
      const checkpointEvents = events.filter(e => e.type === 'checkpoint');
      expect(checkpointEvents.length).toBeGreaterThanOrEqual(1);

      // All checkpoint events should be at after_llm position
      for (const cp of checkpointEvents) {
        if (cp.type === 'checkpoint') {
          expect(cp.position).toBe('after_llm');
        }
      }

      // Verify storage.save was called for each LLM response
      expect(mockStorage.save).toHaveBeenCalled();
      const saveCalls = (mockStorage.save as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of saveCalls) {
        expect(call[0].position).toBe('after_llm');
      }
    });

    it('should emit checkpoint before tool execution in event stream', async () => {
      const mockStorage: CheckpointStorage = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
        deleteAll: vi.fn().mockResolvedValue(undefined),
      };

      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'calculator', args: { a: 1, b: 2 } }],
          finishReason: 'tool_calls',
        },
        { content: 'Done!', finishReason: 'stop' },
      ]);

      const ctx: AgentContext = {
        ...createTestContext(llm, toolRegistry),
        checkpoint: mockStorage,
      };
      const config = createTestConfig({
        parallelToolCalls: false,
        checkpoint: { enabled: true, interval: 'llm_response' },
      });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(agent.run('Calculate').pipe(toArray()));

      const types = events.map(e => e.type);

      // Checkpoint should appear after llm.response but before tool.call
      const llmResponseIdx = types.indexOf('llm.response');
      const checkpointIdx = types.indexOf('checkpoint');
      const toolCallIdx = types.indexOf('tool.call');

      expect(checkpointIdx).toBeGreaterThan(llmResponseIdx);
      expect(toolCallIdx).toBeGreaterThan(checkpointIdx);
    });

    it('should not crash when checkpoint save fails', async () => {
      const mockStorage: CheckpointStorage = {
        save: vi.fn().mockRejectedValue(new Error('Storage error')),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
        deleteAll: vi.fn().mockResolvedValue(undefined),
      };

      llm.setResponses([
        { content: 'Hello!', finishReason: 'stop' },
      ]);

      const ctx: AgentContext = {
        ...createTestContext(llm, toolRegistry),
        checkpoint: mockStorage,
      };
      const config = createTestConfig({
        checkpoint: { enabled: true, interval: 'llm_response' },
      });

      const agent = createAgentLoop(ctx, config);
      // Should not throw - checkpoint save failure is fire-and-forget
      const events = await firstValueFrom(agent.run('Hi').pipe(toArray()));

      // Should still complete normally
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
      expect(events.find(e => e.type === 'done')).toBeDefined();

      // Checkpoint event should still be emitted even if save fails
      expect(events.some(e => e.type === 'checkpoint')).toBe(true);
    });
  });

  // ========================================
  // Scenario 15: Re-entry protection
  // ========================================
  describe('Scenario 15: Re-entry protection', () => {
    it('should emit agent.error for concurrent run() calls (errors-as-events)', async () => {
      llm.setResponses([{ content: 'done', finishReason: 'stop' }]);
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();
      const agent = createAgentLoop(ctx, config);

      // First call to run() sets isRunning = true
      const firstRun$ = agent.run('first');

      // Second call should emit agent.error + done (errors-as-events pattern)
      const secondRun$ = agent.run('second');
      const secondEvents = await firstValueFrom(secondRun$.pipe(toArray()));

      // Should emit agent.error event (not throw via RxJS error channel)
      const errorEvent = secondEvents.find(e => e.type === 'agent.error');
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === 'agent.error') {
        expect(errorEvent.error.message).toContain('already running');
      }

      // Should emit done event with reason 'error'
      const doneEvent = secondEvents.find(e => e.type === 'done');
      expect(doneEvent).toBeDefined();
      if (doneEvent?.type === 'done') {
        expect(doneEvent.reason).toBe('error');
      }

      // Clean up - subscribe to first run to let it complete
      await firstValueFrom(firstRun$.pipe(toArray()));
    });

    it('should allow sequential run() calls after first completes', async () => {
      llm.setResponses([{ content: 'done', finishReason: 'stop' }]);
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();
      const agent = createAgentLoop(ctx, config);

      // First run completes
      const firstEvents = await firstValueFrom(agent.run('first').pipe(toArray()));
      expect(firstEvents.find(e => e.type === 'agent.complete')).toBeDefined();

      // Second run should work after first completes
      const secondEvents = await firstValueFrom(agent.run('second').pipe(toArray()));
      expect(secondEvents.find(e => e.type === 'agent.complete')).toBeDefined();
    });

    it('should reset running state after error', async () => {
      llm.setFailNTimes(1);
      llm.setResponses([{ content: 'success', finishReason: 'stop' }]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();
      const agent = createAgentLoop(ctx, config);

      // First run fails
      const firstEvents = await firstValueFrom(agent.run('first').pipe(toArray()));
      expect(firstEvents.find(e => e.type === 'agent.error')).toBeDefined();

      // Second run should work after error
      llm.setFailNTimes(0);
      llm.setResponses([{ content: 'success after error', finishReason: 'stop' }]);
      const secondEvents = await firstValueFrom(agent.run('second').pipe(toArray()));
      expect(secondEvents.find(e => e.type === 'agent.complete')).toBeDefined();
    });
  });
});
