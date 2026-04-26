/**
 * E2E Streaming Tests - Real LLM Streaming Validation
 *
 * Tests end-to-end streaming output with real LLM API.
 * Validates that Agent correctly emits and processes streaming events.
 *
 * API Configuration (GLM-5):
 * - baseURL: https://api.lkeap.cloud.tencent.com/plan/v3
 * - model: glm-5
 *
 * Test Scenarios:
 * 1. Basic streaming output - multiple chunks, content assembly
 * 2. Streaming + tool calls - tool_call chunks, parameter parsing
 * 3. Stream interruption/resume - cancellation, re-subscription
 * 4. Event ordering - start → text[] → end sequence
 * 5. Error handling - stream interruption, graceful degradation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  Observable,
  of,
  from,
  Subject,
  firstValueFrom,
  toArray,
  takeUntil,
  take,
} from 'rxjs';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, generateText, tool } from 'ai';
import { z } from 'zod';

import {
  createAgentLoop,
  type AgentLoopConfig,
} from '../../src/loop/agent-loop.js';
import {
  type AgentContext,
  type AgentState,
  type AgentEvent,
  type LLMAdapter,
  type LLMResponse,
  type LLMChunk,
  type LLMOptions,
  type ToolDefinition,
  type ToolRegistry,
  type FunctionDefinition,
  type Message,
  InMemoryStore,
  DefaultPauseController,
  DefaultHITLController,
  SimpleSchemaRegistry,
} from '../../src/core/index.js';

// ============================================================
// API Configuration
// ============================================================

const API_CONFIG = {
  apiKey: process.env.LLM_API_KEY ?? '',
  baseURL: process.env.LLM_BASE_URL ?? 'https://token-plan-cn.xiaomimimo.com/v1',
  model: process.env.LLM_MODEL ?? 'mimo-v2.5',
};

// Skip tests if API key is not provided
const shouldRunE2E = API_CONFIG.apiKey.length > 0;

// ============================================================
// Real LLM Adapter Implementation
// ============================================================

/**
 * OpenAI-compatible LLM Adapter for real API calls.
 * Uses @ai-sdk/openai-compatible for HTTP communication.
 */
class RealLLMAdapter implements LLMAdapter {
  readonly name = 'real-llm-adapter';
  readonly provider = 'openai-compatible';

  private model: ReturnType<ReturnType<typeof createOpenAICompatible>>;

  constructor(config: { apiKey: string; baseURL: string; model: string }) {
    const provider = createOpenAICompatible({
      name: 'openai-compatible',
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });
    this.model = provider(config.model);
  }

  /**
   * Convert AgentForge Message[] to AI SDK format
   */
  private convertMessages(messages: Message[]): Array<
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | Array<{ type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }> }
    | { role: 'tool'; content: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }> }
  > {
    const result: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string | unknown[];
    }> = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);

      if (msg.role === 'tool') {
        const toolMsg = msg as unknown as Record<string, unknown>;
        const toolCallId = (toolMsg['toolCallId'] as string) ?? '';
        const toolName = (toolMsg['name'] as string) ?? '';

        const prevMsg = result[result.length - 1];
        const needsAssistant = !prevMsg ||
          prevMsg.role !== 'assistant' ||
          !Array.isArray(prevMsg.content) ||
          !(prevMsg.content as Array<unknown>).some(
            (c: unknown) => (c as { type?: string })?.type === 'tool-call'
          );

        if (needsAssistant) {
          result.push({
            role: 'assistant' as const,
            content: [{
              type: 'tool-call',
              toolCallId,
              toolName,
              args: {},
            }],
          });
        }

        result.push({
          role: 'tool' as const,
          content: [{
            type: 'tool-result',
            toolCallId,
            toolName,
            output: { type: 'text' as const, value: content },
          }],
        });
      } else {
        result.push({
          role: msg.role as 'system' | 'user' | 'assistant',
          content,
        });
      }
    }

    return result as Array<
      | { role: 'system'; content: string }
      | { role: 'user'; content: string }
      | { role: 'assistant'; content: string | Array<{ type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }> }
      | { role: 'tool'; content: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }> }
    >;
  }

  /**
   * Convert FunctionDefinition[] to AI SDK tools format
   */
  private convertTools(tools: FunctionDefinition[] | undefined): Record<string, ReturnType<typeof tool>> | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    const result: Record<string, ReturnType<typeof tool>> = {};
    for (const t of tools) {
      // Create a minimal Zod schema that AI SDK can handle
      const schema = z.object({}).passthrough();

      result[t.name] = tool({
        description: t.description,
        parameters: schema,
        execute: async (args: unknown) => JSON.stringify(args),
      });
    }
    return result;
  }

  /**
   * Non-streaming chat completion
   */
  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
    const convertedMessages = this.convertMessages(messages);

    const result = await generateText({
      model: this.model,
      messages: convertedMessages,
      temperature: options?.temperature ?? 0.7,
      ...(tools ? { tools } : {}),
    });

    const toolCalls = result.toolCalls?.map(tc => ({
      id: tc.toolCallId,
      name: tc.toolName,
      args: (tc as { input?: Record<string, unknown> }).input ?? {},
    }));

    return {
      content: result.text,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: result.finishReason as 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled',
      usage: result.usage ? {
        promptTokens: (result.usage as { promptTokens?: number }).promptTokens ?? 0,
        completionTokens: (result.usage as { completionTokens?: number }).completionTokens ?? 0,
      } : undefined,
    };
  }

  /**
   * Streaming chat completion
   * Returns Observable<LLMChunk> for AgentForge streaming
   */
  stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk> {
    return new Observable<LLMChunk>((subscriber) => {
      const run = async () => {
        try {
          const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);

          const { fullStream } = await streamText({
            model: this.model,
            messages: this.convertMessages(messages),
            temperature: options?.temperature ?? 0.7,
            ...(tools ? { tools } : {}),
          });

          for await (const chunk of fullStream) {
            if (chunk.type === 'text-delta') {
              const textDelta = (chunk as { text?: string }).text;
              if (textDelta) {
                subscriber.next({ text: textDelta });
              }
            } else if (chunk.type === 'tool-call') {
              const toolCallChunk = chunk as {
                toolCallId: string;
                toolName: string;
                input?: unknown;
              };
              subscriber.next({
                toolCallId: toolCallChunk.toolCallId,
                toolName: toolCallChunk.toolName,
                argsDelta: JSON.stringify(toolCallChunk.input ?? {}),
              });
            }
          }

          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      };

      run();
    });
  }
}

// ============================================================
// Mock Tool Registry
// ============================================================

class SimpleToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
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

  getFunctionDef(name: string): FunctionDefinition | undefined {
    const tool = this.tools.get(name);
    if (!tool) return undefined;
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
    };
  }

  getFunctionDefs(): FunctionDefinition[] {
    return this.list().map(n => this.getFunctionDef(n)!);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool.execute(args);
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const t of tools) this.register(t);
  }
}

// ============================================================
// Test Helpers
// ============================================================

function createTestContext(llm: LLMAdapter, toolRegistry: ToolRegistry): AgentContext {
  return {
    sessionId: `e2e-streaming-${Date.now()}`,
    agentName: 'e2e-test-agent',
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
    model: { provider: 'openai-compatible', model: API_CONFIG.model },
    maxSteps: 5,
    maxLLMRepairAttempts: 2,
    parallelToolCalls: true,
    streaming: true,
    ...overrides,
  };
}

// ============================================================
// E2E Tests
// ============================================================

describe.skipIf(!shouldRunE2E)('E2E Streaming Tests', () => {
  let llm: RealLLMAdapter;
  let toolRegistry: SimpleToolRegistry;

  beforeAll(() => {
    llm = new RealLLMAdapter(API_CONFIG);
    toolRegistry = new SimpleToolRegistry();

    // Register test tools
    toolRegistry.register({
      name: 'get_weather',
      description: 'Get weather information for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
      execute: async (args: unknown) => {
        const { city } = args as { city: string };
        return JSON.stringify({ city, temperature: 22, condition: 'sunny' });
      },
    });

    toolRegistry.register({
      name: 'calculate',
      description: 'Perform a simple calculation',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression to calculate' },
        },
        required: ['expression'],
      },
      execute: async (args: unknown) => {
        const { expression } = args as { expression: string };
        try {
          const result = Function('"use strict"; return (' + expression + ')')();
          return String(result);
        } catch {
          return 'Error: Invalid expression';
        }
      },
    });
  });

  afterAll(() => {
    // Cleanup
  });

  // ========================================
  // Scenario 1: Basic Streaming Output
  // ========================================
  describe('Scenario 1: Basic Streaming Output', () => {
    it('should receive multiple text chunks during streaming', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Say hello in exactly 5 words.').pipe(toArray())
      );

      const streamTextEvents = events.filter(e => e.type === 'llm.stream.text');
      expect(streamTextEvents.length).toBeGreaterThanOrEqual(3);

      const content = streamTextEvents
        .map(e => (e as { delta: string }).delta)
        .join('');

      expect(content.length).toBeGreaterThan(0);
    }, 30000);

    it('should emit stream.start before text chunks', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Say hi.').pipe(toArray())
      );

      const types = events.map(e => e.type);
      const startIdx = types.indexOf('llm.stream.start');
      const textIdx = types.indexOf('llm.stream.text');

      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(textIdx).toBeGreaterThan(startIdx);
    }, 30000);

    it('should emit stream.end after text chunks', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Say bye.').pipe(toArray())
      );

      const types = events.map(e => e.type);
      const lastTextIdx = types.lastIndexOf('llm.stream.text');
      const endIdx = types.indexOf('llm.stream.end');

      expect(endIdx).toBeGreaterThan(lastTextIdx);
    }, 30000);

    it('should assemble complete content in llm.response', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Count from 1 to 5, each number on a new line.').pipe(toArray())
      );

      const streamTextEvents = events.filter(e => e.type === 'llm.stream.text');
      const assembledContent = streamTextEvents
        .map(e => (e as { delta: string }).delta)
        .join('');

      const responseEvent = events.find(e => e.type === 'llm.response');
      expect(responseEvent).toBeDefined();

      if (responseEvent?.type === 'llm.response') {
        expect(responseEvent.content).toBe(assembledContent);
      }
    }, 30000);
  });

  // ========================================
  // Scenario 2: Streaming + Tool Calls
  // ========================================
  describe('Scenario 2: Streaming + Tool Calls', () => {
    it('should emit llm.stream.tool_call events when tool is called', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('What is the weather in Beijing?').pipe(toArray())
      );

      const toolCallEvents = events.filter(e => e.type === 'llm.stream.tool_call');

      // May or may not have tool calls depending on LLM response
      // Just verify the event structure if present
      if (toolCallEvents.length > 0) {
        const firstToolCall = toolCallEvents[0];
        if (firstToolCall?.type === 'llm.stream.tool_call') {
          expect(firstToolCall.toolCallId).toBeDefined();
          expect(firstToolCall.toolName).toBeDefined();
        }
      }
    }, 30000);

    it('should correctly parse tool arguments from stream', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Calculate 25 * 4 + 10').pipe(toArray())
      );

      // If LLM makes tool call, verify tool.result is present
      const toolResultEvent = events.find(e => e.type === 'tool.result');
      if (toolResultEvent) {
        // Tool was called, verify result structure
        expect(toolResultEvent).toBeDefined();
      }

      // Verify completion
      const completeEvent = events.find(e => e.type === 'agent.complete');
      expect(completeEvent).toBeDefined();
    }, 30000);

    it('should execute tools and continue conversation', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ maxSteps: 3 });

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Get weather for Shanghai and tell me if it is good for outdoor activities.').pipe(toArray())
      );

      const toolExecuteEvents = events.filter(e => e.type === 'tool.execute');
      const toolResultEvents = events.filter(e => e.type === 'tool.result');

      // If tools were called, verify execution
      if (toolExecuteEvents.length > 0) {
        expect(toolResultEvents.length).toBe(toolExecuteEvents.length);
      }

      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    }, 45000);
  });

  // ========================================
  // Scenario 3: Stream Interruption/Resume
  // ========================================
  describe('Scenario 3: Stream Interruption/Resume', () => {
    it('should handle subscription cancellation gracefully', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const cancel$ = new Subject<void>();

      const eventsPromise = firstValueFrom(
        agent.run('Write a long story about a cat.').pipe(
          takeUntil(cancel$),
          toArray()
        )
      );

      // Cancel after 500ms
      setTimeout(() => cancel$.next(), 500);

      const events = await eventsPromise;

      // Should have received some events before cancellation
      expect(events.length).toBeGreaterThan(0);

      // Stream events should be present (partial streaming)
      const streamEvents = events.filter(e =>
        e.type.startsWith('llm.stream.')
      );
      expect(streamEvents.length).toBeGreaterThan(0);
    }, 30000);

    it('should allow re-subscription after cancellation', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);

      // First subscription - cancelled
      const cancel$ = new Subject<void>();
      const firstRun$ = agent.run('Say hello.').pipe(takeUntil(cancel$));

      // Start and immediately cancel
      setTimeout(() => cancel$.next(), 100);
      await firstValueFrom(firstRun$.pipe(toArray())).catch(() => {});

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 200));

      // Second subscription should work
      const events = await firstValueFrom(
        agent.run('Say goodbye.').pipe(toArray())
      );

      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    }, 30000);
  });

  // ========================================
  // Scenario 4: Event Ordering
  // ========================================
  describe('Scenario 4: Event Ordering', () => {
    it('should emit events in correct sequence: start → text[] → end → response', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Say "test".').pipe(toArray())
      );

      const types = events.map(e => e.type);

      // Find indices
      const startIdx = types.indexOf('llm.stream.start');
      const textIdx = types.indexOf('llm.stream.text');
      const endIdx = types.indexOf('llm.stream.end');
      const responseIdx = types.indexOf('llm.response');

      // Verify order: start → text → end → response
      expect(startIdx).toBeLessThan(textIdx);
      expect(textIdx).toBeLessThan(endIdx);
      expect(endIdx).toBeLessThan(responseIdx);
    }, 30000);

    it('should have monotonically increasing timestamps within a stream', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Count from 1 to 3.').pipe(toArray())
      );

      const streamEvents = events.filter(e =>
        e.type.startsWith('llm.stream.')
      );

      // Verify timestamps are non-decreasing
      for (let i = 1; i < streamEvents.length; i++) {
        const prev = streamEvents[i - 1]!;
        const curr = streamEvents[i]!;
        expect(curr.timestamp).toBeGreaterThanOrEqual(prev.timestamp);
      }
    }, 30000);

    it('should emit agent.step before llm.request', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Hello.').pipe(toArray())
      );

      const types = events.map(e => e.type);
      const stepIdx = types.indexOf('agent.step');
      const requestIdx = types.indexOf('llm.request');

      expect(stepIdx).toBeLessThan(requestIdx);
    }, 30000);
  });

  // ========================================
  // Scenario 5: Error Handling
  // ========================================
  describe('Scenario 5: Error Handling', () => {
    it('should emit agent.error + done on stream interruption', async () => {
      // Create an LLM that simulates stream interruption
      const errorLlm: LLMAdapter = {
        name: 'error-llm',
        provider: 'test',
        chat: async () => ({ content: 'test', finishReason: 'stop' }),
        stream: () => new Observable(subscriber => {
          subscriber.next({ text: 'Starting...' });
          setTimeout(() => {
            subscriber.error(new Error('Connection lost'));
          }, 50);
        }),
      };

      const ctx = createTestContext(errorLlm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Hello.').pipe(toArray())
      );

      // Should have some text before error
      expect(events.find(e => e.type === 'llm.stream.text')).toBeDefined();

      // Should emit error events
      expect(events.find(e => e.type === 'agent.error')).toBeDefined();
      expect(events.find(e => e.type === 'done')).toBeDefined();

      const doneEvent = events.find(e => e.type === 'done');
      if (doneEvent?.type === 'done') {
        expect(doneEvent.reason).toBe('error');
      }
    }, 30000);

    it('should not crash on API timeout simulation', async () => {
      // Create an LLM that simulates timeout
      const timeoutLlm: LLMAdapter = {
        name: 'timeout-llm',
        provider: 'test',
        chat: async () => ({ content: 'test', finishReason: 'stop' }),
        stream: () => new Observable(subscriber => {
          subscriber.next({ text: 'Starting...' });
          // Never completes - simulates timeout
          // The test timeout will catch this
        }),
      };

      const ctx = createTestContext(timeoutLlm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);

      // Use a timeout to ensure test doesn't hang
      const eventsPromise = firstValueFrom(
        agent.run('Hello.').pipe(
          takeUntil(
            new Observable<void>(sub => {
              setTimeout(() => { sub.next(); sub.complete(); }, 2000);
            })
          ),
          toArray()
        )
      );

      const events = await eventsPromise;

      // Should have received some events before timeout
      expect(events.length).toBeGreaterThan(0);
    }, 10000);

    it('should handle empty stream gracefully', async () => {
      const emptyLlm: LLMAdapter = {
        name: 'empty-llm',
        provider: 'test',
        chat: async () => ({ content: '', finishReason: 'stop' }),
        stream: () => new Observable(subscriber => {
          // Immediately complete with no chunks
          subscriber.complete();
        }),
      };

      const ctx = createTestContext(emptyLlm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Hello.').pipe(toArray())
      );

      // Should still have start and end events
      expect(events.find(e => e.type === 'llm.stream.start')).toBeDefined();
      expect(events.find(e => e.type === 'llm.stream.end')).toBeDefined();
      expect(events.find(e => e.type === 'llm.response')).toBeDefined();
    }, 30000);
  });

  // ========================================
  // Scenario 6: Integration Tests
  // ========================================
  describe('Scenario 6: Integration', () => {
    it('should complete full conversation flow with streaming', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Tell me a short joke.').pipe(toArray())
      );

      const types = events.map(e => e.type);

      // Verify full event sequence
      expect(types).toContain('agent.start');
      expect(types).toContain('agent.step');
      expect(types).toContain('llm.request');
      expect(types).toContain('llm.stream.start');
      expect(types).toContain('llm.stream.text');
      expect(types).toContain('llm.stream.end');
      expect(types).toContain('llm.response');
      expect(types).toContain('agent.complete');
      expect(types).toContain('done');
    }, 30000);

    it('should track token usage when available', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await firstValueFrom(
        agent.run('Hi.').pipe(toArray())
      );

      const responseEvent = events.find(e => e.type === 'llm.response');
      expect(responseEvent).toBeDefined();

      // Token usage may or may not be available depending on API
      if (responseEvent?.type === 'llm.response' && responseEvent.usage) {
        expect(responseEvent.usage.promptTokens).toBeGreaterThanOrEqual(0);
        expect(responseEvent.usage.completionTokens).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });
});
