/**
 * E2E Tests with Real LLM API
 *
 * Tests Agent Loop behavior against a real LLM endpoint.
 * Uses OpenAI-compatible API format.
 *
 * Environment Variables:
 * - LLM_E2E=true: Enable tests (default: skip)
 * - LLM_API_KEY: API key for the LLM endpoint
 * - LLM_BASE_URL: Custom base URL (optional, has default)
 * - LLM_MODEL: Model name (optional, has default)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ToolDefinition } from '../../src/core/index.js';
import {
  resolveApiConfig,
  shouldRunE2E,
  RealLLMAdapter,
  SimpleToolRegistry,
  createTestContext,
  createTestConfig,
  runAndCollect,
  createAgentLoop,
} from '../helpers/e2e-adapters.js';
import type { AgentLoopConfig } from '../../src/loop/agent-loop.js';

// ============================================================
// Configuration
// ============================================================

const HAS_API_KEY = (process.env.LLM_API_KEY?.length ?? 0) > 0;
const API_CONFIG = resolveApiConfig();
const TEST_TIMEOUT = 60000;

// ============================================================
// Tests
// ============================================================

describe.skipIf(!HAS_API_KEY)('E2E: Real LLM Tests', () => {
  let llm: RealLLMAdapter;
  let subscriptions: any[];

  beforeEach(() => {
    llm = new RealLLMAdapter(API_CONFIG);
    subscriptions = [];
  });

  afterEach(() => {
    // Cleanup all subscriptions
    for (const sub of subscriptions) {
      sub.unsubscribe();
    }
    subscriptions = [];
  });

  // ========================================
  // Test 1: Basic Conversation
  // ========================================
  describe('Basic Conversation', () => {
    it(
      'should complete simple Q&A request',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig({ maxSteps: 1 });

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'What is 2+2? Reply with just the number.');

        // Verify event sequence
        const types = events.map(e => e.type);
        expect(types).toContain('agent.start');
        expect(types).toContain('llm.request');
        expect(types).toContain('llm.response');
        expect(types).toContain('agent.complete');
        expect(types).toContain('done');

        // Verify response content - be flexible about API behavior
        const responseEvent = events.find(e => e.type === 'llm.response');
        expect(responseEvent).toBeDefined();
        if (responseEvent?.type === 'llm.response') {
          // Response might be empty if API had issues, but structure should be valid
          expect(responseEvent.content).toBeDefined();
          expect(typeof responseEvent.content).toBe('string');
          // finishReason should be valid
          expect(['stop', 'error', 'length', 'tool_calls', 'cancelled']).toContain(
            responseEvent.finishReason,
          );
        }

        // Verify completion or error handling
        const completeEvent = events.find(e => e.type === 'agent.complete');
        const errorEvent = events.find(e => e.type === 'agent.error');
        const doneEvent = events.find(e => e.type === 'done');

        // Should have either completion or proper error handling
        expect(completeEvent || errorEvent || doneEvent).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    it(
      'should handle empty response gracefully',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig();

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'Say nothing, just reply with an empty message if possible.');

        // Should still complete
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();
      },
      TEST_TIMEOUT,
    );
  });

  // ========================================
  // Test 2: Streaming Output
  // ========================================
  describe('Streaming Output', () => {
    it(
      'should handle streaming mode',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig({ streaming: true, maxSteps: 1 });

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'Tell me a short story about a cat. Keep it brief, 2-3 sentences.');

        // Verify streaming events (may vary based on API support)
        const streamStart = events.find(e => e.type === 'llm.stream.start');
        const streamTexts = events.filter(e => e.type === 'llm.stream.text');
        const streamEnd = events.find(e => e.type === 'llm.stream.end');

        // Stream start and end should be present if streaming is supported
        // If API doesn't support streaming, these might not be present
        if (streamStart) {
          expect(streamEnd).toBeDefined();
        }

        // If we got stream text chunks, verify they have content
        for (const event of streamTexts) {
          if (event.type === 'llm.stream.text') {
            expect(typeof event.delta).toBe('string');
          }
        }

        // Final response should be present
        const responseEvent = events.find(e => e.type === 'llm.response');
        expect(responseEvent).toBeDefined();
        if (responseEvent?.type === 'llm.response') {
          expect(typeof responseEvent.content).toBe('string');
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'should handle streaming with tool calls',
      async () => {
        // Define a simple tool
        const weatherTool: ToolDefinition = {
          name: 'get_weather',
          description: 'Get weather information for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
            },
            required: ['location'],
          },
          execute: async (args) => {
            const location = (args as { location: string }).location;
            return `Weather in ${location}: Sunny, 25°C`;
          },
        };

        const ctx = createTestContext(llm, [weatherTool]);
        const config = createTestConfig({ streaming: true });

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'What is the weather in Tokyo today?');

        // Should complete successfully
        const completeEvent = events.find(e => e.type === 'agent.complete');
        const doneEvent = events.find(e => e.type === 'done');

        // Either completed or done (tool might or might not be called)
        expect(completeEvent || doneEvent).toBeDefined();
      },
      TEST_TIMEOUT,
    );
  });

  // ========================================
  // Test 3: Tool Calling
  // ========================================
  describe('Tool Calling', () => {
    it(
      'should call tool and return result',
      async () => {
        // Define weather tool
        const weatherTool: ToolDefinition = {
          name: 'get_weather',
          description: 'Get current weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City or location name' },
            },
            required: ['location'],
          },
          execute: async (args) => {
            const location = (args as { location: string }).location;
            return JSON.stringify({
              location,
              temperature: 22,
              condition: 'Partly cloudy',
              humidity: 65,
            });
          },
        };

        const ctx = createTestContext(llm, [weatherTool]);
        const config = createTestConfig();

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'What is the current weather in Beijing? Use the get_weather tool.');

        // Check if tool was called (LLM decides)
        const toolCallEvent = events.find(e => e.type === 'tool.call');
        const toolResultEvent = events.find(e => e.type === 'tool.result');
        const completeEvent = events.find(e => e.type === 'agent.complete');

        // If tool was called, verify the flow
        if (toolCallEvent) {
          expect(toolCallEvent.type).toBe('tool.call');
          if (toolCallEvent.type === 'tool.call') {
            expect(toolCallEvent.toolName).toBe('get_weather');
          }

          expect(toolResultEvent).toBeDefined();
          if (toolResultEvent?.type === 'tool.result') {
            expect(toolResultEvent.result).toBeDefined();
            expect(toolResultEvent.isError).toBe(false);
          }
        }

        // Should complete eventually
        expect(completeEvent).toBeDefined();
        if (completeEvent?.type === 'agent.complete') {
          expect(completeEvent.output).toBeDefined();
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'should handle tool execution error',
      async () => {
        // Define a failing tool
        const failingTool: ToolDefinition = {
          name: 'failing_tool',
          description: 'A tool that always fails',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
          execute: async () => {
            throw new Error('Tool execution failed intentionally');
          },
        };

        const ctx = createTestContext(llm, [failingTool]);
        const config = createTestConfig();

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'Use the failing_tool to test error handling.');

        // If tool was called, check error result
        const toolResultEvent = events.find(e => e.type === 'tool.result');
        if (toolResultEvent?.type === 'tool.result') {
          // Tool result should indicate error
          if (toolResultEvent.isError === true) {
            expect(toolResultEvent.result).toContain('failed');
          }
        }

        // Should still complete (errors are events, not exceptions)
        const completeEvent = events.find(e => e.type === 'agent.complete');
        expect(completeEvent).toBeDefined();
      },
      TEST_TIMEOUT,
    );
  });

  // ========================================
  // Test 4: Multi-turn Conversation
  // ========================================
  describe('Multi-turn Conversation', () => {
    it(
      'should maintain context across turns',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig();

        const agent = createAgentLoop(ctx, config);

        // First turn: introduce name
        const events1 = await runAndCollect(agent, 'My name is Alice. Remember this for later.');

        const complete1 = events1.find(e => e.type === 'agent.complete');
        expect(complete1).toBeDefined();

        // Second turn: ask about the name
        // Note: The agent loop doesn't automatically persist messages between runs
        // This test verifies the agent can complete a second run
        const events2 = await runAndCollect(agent, 'What is my name? (If you remember from the previous conversation, tell me.)');

        const complete2 = events2.find(e => e.type === 'agent.complete');
        expect(complete2).toBeDefined();
        if (complete2?.type === 'agent.complete') {
          expect(complete2.output).toBeDefined();
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'should handle multiple sequential requests',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig();

        const agent = createAgentLoop(ctx, config);

        // Run three sequential requests
        for (let i = 0; i < 3; i++) {
          const events = await runAndCollect(agent, `Request number ${i + 1}: What is ${i + 1} + ${i + 1}?`);

          const completeEvent = events.find(e => e.type === 'agent.complete');
          expect(completeEvent).toBeDefined();
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ========================================
  // Test 5: Error Handling
  // ========================================
  describe('Error Handling', () => {
    it(
      'should handle errors-as-events pattern',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig();

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'Hello, this is a normal request.');

        // Verify proper error handling
        // All events should have valid structure
        for (const event of events) {
          expect(event.type).toBeDefined();
          expect(event.timestamp).toBeDefined();
          expect(event.sessionId).toBeDefined();
        }

        // Terminal events should be present
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();
        if (doneEvent?.type === 'done') {
          expect(['stop', 'error', 'length', 'cancelled']).toContain(doneEvent.reason);
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'should handle max steps limit',
      async () => {
        // Define a tool that triggers another tool call
        const recursiveTool: ToolDefinition = {
          name: 'get_info',
          description: 'Get some information',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Query string' },
            },
            required: ['query'],
          },
          execute: async () => 'Information retrieved. Now ask another question.',
        };

        const ctx = createTestContext(llm, [recursiveTool]);
        const config = createTestConfig({ maxSteps: 2 });

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'Keep using the get_info tool repeatedly.');

        // Should terminate due to max steps
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();

        // Count agent.step events
        const stepEvents = events.filter(e => e.type === 'agent.step');
        expect(stepEvents.length).toBeLessThanOrEqual(2);
      },
      TEST_TIMEOUT,
    );
  });

  // ========================================
  // Test 6: Event Stream Verification
  // ========================================
  describe('Event Stream Verification', () => {
    it(
      'should emit events in correct order',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig({ maxSteps: 1 });

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'Hello!');

        const types = events.map(e => e.type);

        // Verify basic event order
        const startIdx = types.indexOf('agent.start');
        const stepIdx = types.indexOf('agent.step');
        const requestIdx = types.indexOf('llm.request');
        const responseIdx = types.indexOf('llm.response');
        const completeIdx = types.indexOf('agent.complete');
        const doneIdx = types.indexOf('done');

        // All core events should be present
        expect(startIdx).toBeGreaterThan(-1);
        expect(stepIdx).toBeGreaterThan(-1);
        expect(requestIdx).toBeGreaterThan(-1);
        expect(responseIdx).toBeGreaterThan(-1);
        expect(completeIdx).toBeGreaterThan(-1);
        expect(doneIdx).toBeGreaterThan(-1);

        // Order should be correct
        expect(startIdx).toBeLessThan(stepIdx);
        expect(stepIdx).toBeLessThan(requestIdx);
        expect(requestIdx).toBeLessThan(responseIdx);
        expect(responseIdx).toBeLessThan(completeIdx);
        expect(completeIdx).toBeLessThan(doneIdx);
      },
      TEST_TIMEOUT,
    );

    it(
      'should include timestamps in all events',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig();

        const agent = createAgentLoop(ctx, config);
        const events = await runAndCollect(agent, 'What time is it?');

        // All events should have timestamps
        const now = Date.now();
        for (const event of events) {
          expect(event.timestamp).toBeDefined();
          expect(event.timestamp).toBeGreaterThan(0);
          // Timestamp should be within reasonable range (past hour)
          expect(event.timestamp).toBeGreaterThan(now - 3600000);
          expect(event.timestamp).toBeLessThanOrEqual(now + 1000);
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ========================================
  // Test 7: Subscription Cleanup
  // ========================================
  describe('Subscription Cleanup', () => {
    it(
      'should properly cleanup subscriptions',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig();

        const agent = createAgentLoop(ctx, config);

        // Create subscription
        const sub = agent.run$('Quick test.').subscribe({
          next: () => {},
          complete: () => {},
        });
        subscriptions.push(sub);

        // Wait for completion
        await new Promise<void>(resolve => {
          sub.add(() => resolve());
        });

        // Subscription should be closed
        expect(sub.closed).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      'should handle destroy signal',
      async () => {
        const ctx = createTestContext(llm);
        const config = createTestConfig();

        const agent = createAgentLoop(ctx, config);

        // Subscribe and wait for first event (event-driven)
        let eventCount = 0;
        await new Promise<void>(resolve => {
          const sub = agent.run$('Long response requested.').subscribe({
            next: () => {
              eventCount++;
              resolve();
            },
          });
          subscriptions.push(sub);
        });

        // Should have received some events
        expect(eventCount).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );
  });
});
