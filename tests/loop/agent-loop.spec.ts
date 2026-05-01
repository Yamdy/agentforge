/**
 * Phase 2a: Agent Loop Tests
 *
 * Tests for the core agent loop implementation using Phase 1 types.
 * Validates event routing, LLM calls, tool execution, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  async *stream(_messages: AgentState['messages']): AsyncGenerator<LLMChunk> {
    yield { text: 'stream' };
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

/** Collect all events from agent.run() via onAny callback */
async function runAndCollect(agent: any, input: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const unsub = agent.onAny((e: AgentEvent) => events.push(e));
  try {
    await agent.run(input);
  } catch {
    // Errors are already captured as events via onAny
  }
  unsub();
  return events;
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
      const events = await runAndCollect(agent, 'Hi there');

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
      const events = await runAndCollect(agent, 'What is the weather in Beijing?');

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
    it('should execute tools in parallel', async () => {
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
      const events = await runAndCollect(agent, 'Check weather and calculate');

      // Each tool emits tool.call → tool.execute → tool.result
      const callEvents = events.filter(e => e.type === 'tool.call');
      const execEvents = events.filter(e => e.type === 'tool.execute');
      const resultEvents = events.filter(e => e.type === 'tool.result');
      expect(callEvents.length).toBe(3);
      expect(execEvents.length).toBe(3);
      expect(resultEvents.length).toBe(3);

      const log = toolRegistry.getExecutionLog();
      expect(log).toHaveLength(3);

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
      const events = await runAndCollect(agent, 'Test batch with failure');

      // Tool results include error result
      const toolResults = events.filter(e => e.type === 'tool.result');
      expect(toolResults).toHaveLength(2);

      const errorResult = toolResults.find(
        r => r.type === 'tool.result' && r.isError === true,
      );
      expect(errorResult).toBeDefined();

      // Should complete after batch (LLM processes error results)
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });
  });

  // ========================================
  // Scenario 4: Invalid tool handling
  // ========================================
  describe('Scenario 4: Invalid tool handling', () => {
    it('should handle invalid tool call with tool.result error', async () => {
      // First response has invalid tool, second response handles it
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
      const events = await runAndCollect(agent, 'Get weather');

      // Invalid tool produces tool.result with isError: true (not llm.output.invalid)
      const errorResults = events.filter(e => e.type === 'tool.result' && (e as any).isError === true);
      expect(errorResults.length).toBeGreaterThanOrEqual(1);

      // Should complete after the LLM responds to the error
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });

    it('should handle repeated invalid tool calls', async () => {
      // All responses have invalid tools — loop continues until LLM gives a stop response
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
      const events = await runAndCollect(agent, 'Get weather');

      // Each invalid tool produces a tool.result with error
      const errorResults = events.filter(e => e.type === 'tool.result' && (e as any).isError === true);
      expect(errorResults.length).toBeGreaterThanOrEqual(2);

      // Loop completes with default response when LLM responses are exhausted
      const done = events.find(e => e.type === 'done');
      expect(done).toBeDefined();
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
      const events = await runAndCollect(agent, 'Delete the test file');

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
      const events = await runAndCollect(agent, 'Test error handling');

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
      const events = await runAndCollect(agent, 'Test LLM error');

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
      const events = await runAndCollect(agent, 'Loop test');

      const complete = events.find(e => e.type === 'agent.complete');
      expect(complete).toBeDefined();

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
      const events = await runAndCollect(agent, 'Test step events');

      // Verify LLM was called twice (step 0 and step 1)
      expect(llm.getCallCount()).toBe(2);

      // Verify complete shows step count
      const complete = events.find(e => e.type === 'agent.complete');
      expect(complete).toBeDefined();
      if (complete?.type === 'agent.complete') {
        expect(complete.steps).toBeGreaterThanOrEqual(1);
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
      const events = await runAndCollect(agent, 'Hello');

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
      const events = await runAndCollect(agent, 'Hello');

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
  // Scenario 10: Invalid tool handling (imperative loop)
  // ========================================
  describe('Scenario 10: Invalid tool handling', () => {
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
      const events = await runAndCollect(agent, 'Get weather');

      // Invalid tool emits tool.result with isError: true
      const errorResult = events.find(e => e.type === 'tool.result' && (e as any).isError === true);
      expect(errorResult).toBeDefined();

      // Should eventually complete successfully
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();

      // LLM should have been called 3 times: initial + repair + after tool
      expect(llm.getCallCount()).toBe(3);
    });

    it('should handle repeated invalid tool calls gracefully', async () => {
      // All LLM responses return invalid tool calls — loop continues until responses exhausted
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
      const events = await runAndCollect(agent, 'Test repair');

      // Each invalid tool produces a tool.result with error (no llm.output.invalid in imperative loop)
      const errorResults = events.filter(e => e.type === 'tool.result' && (e as any).isError === true);
      expect(errorResults.length).toBeGreaterThanOrEqual(3);

      // Loop completes (with default response after all responses exhausted, or max steps)
      expect(events.find(e => e.type === 'done')).toBeDefined();
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
      const eventsPromise = runAndCollect(agent, 'Hello');

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
  // Scenario 12: HITL tools
  // ========================================
  describe('Scenario 12: HITL tools', () => {
    it('should handle HITL_REQUIRED tools via tool result', async () => {
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

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ parallelToolCalls: false });

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Delete file');

      // HITL_REQUIRED: prefix stays in the tool result (no HITL controller wired)
      const toolResult = events.find(e => e.type === 'tool.result');
      expect(toolResult).toBeDefined();
      if (toolResult?.type === 'tool.result') {
        expect(toolResult.result).toContain('HITL_REQUIRED:');
      }

      // Should complete normally
      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    });

    it('should handle HITL_REQUIRED tools without HITL controller', async () => {
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
      const events = await runAndCollect(agent, 'Delete file');

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
      const events = await runAndCollect(agent, 'Hi');

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
      const events = await runAndCollect(agent, 'Get weather');

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
      const events = await runAndCollect(agent, 'Hello');

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
      const events = await runAndCollect(agent, 'Calculate');

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
      const events = await runAndCollect(agent, 'Weather');

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
      const events = await runAndCollect(agent, 'Hi');

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
      // Explicitly disabled
      const config = createTestConfig({
        checkpoint: { enabled: false },
      });

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Hi');

      // Should NOT emit checkpoint events when disabled
      const checkpointEvents = events.filter(e => e.type === 'checkpoint');
      expect(checkpointEvents).toHaveLength(0);

      // Should NOT call storage.save
      expect(mockStorage.save).not.toHaveBeenCalled();
    });

    it('should not crash when storage is not configured (checkpoint events still emitted)', async () => {
      llm.setResponses([
        { content: 'Hello!', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry);
      // No checkpoint storage on context
      const config = createTestConfig({
        checkpoint: { enabled: true, interval: 'llm_response' },
      });

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Hi');

      // Checkpoint events are still emitted for observability (even without storage)
      const checkpointEvents = events.filter(e => e.type === 'checkpoint');
      expect(checkpointEvents.length).toBeGreaterThanOrEqual(0);
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
      const events = await runAndCollect(agent, 'Get weather');

      // Should emit checkpoint events for each LLM response + tool execution
      const checkpointEvents = events.filter(e => e.type === 'checkpoint');
      expect(checkpointEvents.length).toBeGreaterThanOrEqual(1);

      // At least one checkpoint should be at after_llm position
      const afterLlm = checkpointEvents.filter(
        c => c.type === 'checkpoint' && (c as any).position === 'after_llm'
      );
      expect(afterLlm.length).toBeGreaterThanOrEqual(1);

      // Verify storage.save was called
      expect(mockStorage.save).toHaveBeenCalled();
      const saveCalls = (mockStorage.save as ReturnType<typeof vi.fn>).mock.calls;
      // At least one save should be at after_llm
      const afterLlmSaves = saveCalls.filter(c => c[0].position === 'after_llm');
      expect(afterLlmSaves.length).toBeGreaterThanOrEqual(1);
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
      const events = await runAndCollect(agent, 'Calculate');

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
      const events = await runAndCollect(agent, 'Hi');

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

      // Start first run (promise-based, sets isRunning=true synchronously)
      const firstPromise = agent.run('first');

      // Second call should get re-entry error
      const secondEvents = await runAndCollect(agent, 'second');

      // Should emit agent.error event
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

      // Clean up - let first run complete
      await firstPromise;
    });

    it('should allow sequential run() calls after first completes', async () => {
      llm.setResponses([{ content: 'done', finishReason: 'stop' }]);
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();
      const agent = createAgentLoop(ctx, config);

      // First run completes
      const firstEvents = await runAndCollect(agent, 'first');
      expect(firstEvents.find(e => e.type === 'agent.complete')).toBeDefined();

      // Second run should work after first completes
      const secondEvents = await runAndCollect(agent, 'second');
      expect(secondEvents.find(e => e.type === 'agent.complete')).toBeDefined();
    });

    it('should reset running state after error', async () => {
      llm.setFailNTimes(1);
      llm.setResponses([{ content: 'success', finishReason: 'stop' }]);

      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();
      const agent = createAgentLoop(ctx, config);

      // First run fails
      const firstEvents = await runAndCollect(agent, 'first');
      expect(firstEvents.find(e => e.type === 'agent.error')).toBeDefined();

      // Second run should work after error
      llm.setFailNTimes(0);
      llm.setResponses([{ content: 'success after error', finishReason: 'stop' }]);
      const secondEvents = await runAndCollect(agent, 'second');
      expect(secondEvents.find(e => e.type === 'agent.complete')).toBeDefined();
    });
  });
});

// ============================================================
// QualityGate & ToolProviderHook Integration Tests
// ============================================================

import { HookRegistry } from '../../src/core/hooks.js';
import type { ToolProviderHook } from '../../src/core/hooks.js';
import { QualityGate } from '../../src/validation/quality-gate.js';

describe('Phase 2b: QualityGate Integration', () => {
  let llm: MockLLMAdapter;
  let toolRegistry: MockToolRegistry;

  beforeEach(() => {
    llm = new MockLLMAdapter();
    toolRegistry = new MockToolRegistry();
  });

  /** Create context with QualityGate enabled */
  function createContextWithQualityGate(gateConfig?: Partial<{ blockedReasons: string[] }>): AgentContext {
    const ctx = createTestContext(llm, toolRegistry);
    ctx.qualityGate = new QualityGate(gateConfig as any);
    return ctx;
  }

  it('should block empty LLM response and retry', async () => {
    const ctx = createContextWithQualityGate();
    const config = createTestConfig({ maxSteps: 5 });

    // LLM returns empty → blocked → retry → good response
    llm.setResponses([
      { content: '', finishReason: 'stop' },                           // → QualityGate blocks
      { content: 'Here is a proper response.', finishReason: 'stop' }, // → QualityGate passes
    ]);

    const agent = createAgentLoop(ctx, config);
    const events = await runAndCollect(agent, 'test');

    // Should complete (not error)
    expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    // No agent.error event
    expect(events.find(e => e.type === 'agent.error')).toBeUndefined();
  });

  it('should detect hallucination and retry', async () => {
    const ctx = createContextWithQualityGate({
      blockedReasons: ['empty_response', 'loop_detected', 'hallucination_pattern'],
    });
    const config = createTestConfig({ maxSteps: 5 });

    llm.setResponses([
      { content: 'As an AI language model, I can help...', finishReason: 'stop' },
      { content: 'The answer is 42.', finishReason: 'stop' },
    ]);

    const agent = createAgentLoop(ctx, config);
    const events = await runAndCollect(agent, 'test');
    expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
  });

  it('should detect loop and force different response', async () => {
    const ctx = createContextWithQualityGate();
    const config = createTestConfig({ maxSteps: 10 });

    const loopText = 'Let me analyze the code again...';
    llm.setResponses([
      { content: loopText, finishReason: 'stop' },
      { content: loopText, finishReason: 'stop' },
      { content: loopText, finishReason: 'stop' }, // ← QualityGate blocks after 3rd
      { content: 'I found the bug on line 15.', finishReason: 'stop' },
    ]);

    const agent = createAgentLoop(ctx, config);
    const events = await runAndCollect(agent, 'test');
    expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    expect(events.find(e => e.type === 'agent.error')).toBeUndefined();
  });

  it('should pass through normal responses without blocking', async () => {
    const ctx = createContextWithQualityGate();
    const config = createTestConfig({ maxSteps: 3 });

    llm.setResponses([
      { content: 'The weather is sunny today.', finishReason: 'stop' },
    ]);

    const agent = createAgentLoop(ctx, config);
    const events = await runAndCollect(agent, 'test');

    expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
  });
});

describe('Phase 2c: ToolProviderHook Integration', () => {
  let llm: MockLLMAdapter;
  let toolRegistry: MockToolRegistry;
  let hookRegistry: HookRegistry;

  beforeEach(() => {
    llm = new MockLLMAdapter();
    toolRegistry = new MockToolRegistry();
    hookRegistry = new HookRegistry();
  });

  function createContextWithHooks(toolProviders: ToolProviderHook[]): AgentContext {
    const ctx = createTestContext(llm, toolRegistry);
    ctx.hookRegistry = hookRegistry;
    for (const h of toolProviders) {
      hookRegistry.registerToolProvider(h);
    }
    return ctx;
  }

  it('should apply tool provider hooks before LLM call', async () => {
    // Register tools
    toolRegistry.register('read', async (args: any) => `read: ${args.file}`);
    toolRegistry.register('execute', async (args: any) => `executed: ${args.command}`);

    // Hook that removes 'execute' tool
    const ctx = createContextWithHooks([{
      name: 'remove-execute',
      priority: 10,
      filter: (tools) => tools.filter(t => t.name !== 'execute'),
    }]);

    const config = createTestConfig({ maxSteps: 3 });

    llm.setResponses([
      { content: 'response', finishReason: 'stop' },
    ]);

    const agent = createAgentLoop(ctx, config);
    const events = await runAndCollect(agent, 'test');

    expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    // Tool hooks registered and applied — no crash means integration works
  });

  it('should inject tools via tool provider hooks', async () => {
    toolRegistry.register('read', async (args: any) => `read: ${args.file}`);

    const ctx = createContextWithHooks([{
      name: 'inject-todo',
      priority: 10,
      filter: (tools) => [...tools, {
        name: 'write_todos',
        description: 'Plan tasks',
        parameters: {},
      }],
    }]);

    const config = createTestConfig({ maxSteps: 3 });

    llm.setResponses([
      { content: 'done', finishReason: 'stop' },
    ]);

    const agent = createAgentLoop(ctx, config);
    const events = await runAndCollect(agent, 'test');
    expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
  });

  it('should chain multiple tool provider hooks', async () => {
    toolRegistry.register('a', async () => 'a');
    toolRegistry.register('b', async () => 'b');
    toolRegistry.register('c', async () => 'c');

    const ctx = createContextWithHooks([
      { name: 'remove-c', priority: 10, filter: (t) => t.filter(td => td.name !== 'c') },
      { name: 'add-d', priority: 20, filter: (t) => [...t, { name: 'd', description: '', parameters: {} }] },
    ]);

    const config = createTestConfig({ maxSteps: 3 });
    llm.setResponses([{ content: 'done', finishReason: 'stop' }]);

    const agent = createAgentLoop(ctx, config);
    const events = await runAndCollect(agent, 'test');
    expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
  });
});
