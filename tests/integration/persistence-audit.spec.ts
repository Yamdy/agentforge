/**
 * Integration Tests: Persistence + Audit Logging
 *
 * Tests for M1 checkpoint persistence and M5 audit logging integration
 * in the agent loop event stream.
 *
 * Test Cases:
 * - Checkpoint should auto-save after each step
 * - Audit log should record on LLM request
 * - Audit log should record on tool execution
 * - Audit log should record on error
 * - Audit log should contain correct sessionId
 * - Audit log should contain correct eventType
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAgentLoop,
  type AgentLoop,
  type AgentLoopConfig,
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
  type Checkpoint,
  type AuditLogger,
  InMemoryStore,
  DefaultPauseController,
  SimpleSchemaRegistry,
} from '../../src/core/index.js';
import { HookRegistry } from '../../src/core/hooks.js';

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
  private shouldFail = false;

  setResponses(responses: MockLLMResponse[]): void {
    this.responses = responses;
    this.callCount = 0;
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  async chat(_messages: AgentState['messages']): Promise<LLMResponse> {
    if (this.shouldFail) {
      throw new Error('LLM API Error');
    }

    this.callCount++;
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
}

// ============================================================
// Mock Tool Registry
// ============================================================

type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

class MockToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

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

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    return tool.execute(args);
  }

  registerAll(_tools: ToolDefinition[]): void {}
}

// ============================================================
// Mock Checkpoint Storage
// ============================================================

class MockCheckpointStorage implements CheckpointStorage {
  public savedCheckpoints: Checkpoint[] = [];

  async save(checkpoint: Checkpoint): Promise<void> {
    this.savedCheckpoints.push(checkpoint);
  }

  async load(sessionId: string): Promise<Checkpoint | null> {
    const cp = this.savedCheckpoints.find(c => c.sessionId === sessionId);
    return cp ?? null;
  }

  async list(sessionId?: string): Promise<Checkpoint[]> {
    if (sessionId) {
      return this.savedCheckpoints.filter(c => c.sessionId === sessionId);
    }
    return [...this.savedCheckpoints];
  }

  async delete(id: string): Promise<void> {
    this.savedCheckpoints = this.savedCheckpoints.filter(c => c.id !== id);
  }

  async deleteAll(sessionId: string): Promise<void> {
    this.savedCheckpoints = this.savedCheckpoints.filter(c => c.sessionId !== sessionId);
  }
}

// ============================================================
// Mock Audit Logger
// ============================================================

interface AuditEntry {
  sessionId: string;
  agentName: string;
  eventType: string;
  action: string;
  resource: string;
  result: 'success' | 'denied' | 'error';
  details: Record<string, unknown>;
}

class MockAuditLogger implements AuditLogger {
  public entries: AuditEntry[] = [];

  append(entry: AuditEntry): void {
    this.entries.push({ ...entry, details: { ...entry.details } });
  }

  getEntriesByEventType(eventType: string): AuditEntry[] {
    return this.entries.filter(e => e.eventType === eventType);
  }

  clear(): void {
    this.entries = [];
  }
}

// ============================================================
// Test Helper: Create Agent Context
// ============================================================

function createTestContext(
  llm: MockLLMAdapter,
  toolRegistry: MockToolRegistry,
  options?: {
    checkpointStorage?: CheckpointStorage;
    auditLogger?: AuditLogger;
  },
): AgentContext {
  const sessionId = `test-session-${Date.now()}`;

  return {
    sessionId,
    agentName: 'test-agent',
    llm,
    tools: toolRegistry,
    memory: new InMemoryStore(),
    pauseController: new DefaultPauseController(),
    services: {
      schemaRegistry: new SimpleSchemaRegistry(),
      llmFactory: { create: () => llm },
      toolRegistry,
    },
    hookRegistry: new HookRegistry(),
    ...(options?.auditLogger ? { auditLogger: options.auditLogger } : {}),
    ...(options?.checkpointStorage ? { checkpoint: options.checkpointStorage } : {}),
  };
}

function createTestConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    model: { provider: 'mock', model: 'test-model' },
    maxSteps: 10,
    maxLLMRepairAttempts: 3,
    parallelToolCalls: false,
    checkpoint: { enabled: true, interval: 'step' },
    ...overrides,
  };
}

// ============================================================
// Helper: run agent and collect all events (Promise-based API)
// ============================================================

async function runAndCollect(agent: AgentLoop, input: string): Promise<any[]> {
  const events: any[] = [];
  const unsub = agent.onAny((e: any) => events.push(e));
  try { await agent.run(input); } catch {}
  unsub();
  return events;
}

// ============================================================
// Tests
// ============================================================

describe('Integration: Persistence + Audit Logging', () => {
  let llm: MockLLMAdapter;
  let toolRegistry: MockToolRegistry;
  let checkpointStorage: MockCheckpointStorage;
  let auditLogger: MockAuditLogger;

  beforeEach(() => {
    llm = new MockLLMAdapter();
    toolRegistry = new MockToolRegistry();
    checkpointStorage = new MockCheckpointStorage();
    auditLogger = new MockAuditLogger();

    toolRegistry.register('weather', async (args) => {
      const city = args.city as string;
      return JSON.stringify({ city, temp: 25, condition: 'sunny' });
    });

    toolRegistry.register('calculator', async (args) => {
      const a = args.a as number;
      const b = args.b as number;
      return String(a + b);
    });
  });

  // ========================================
    // ========================================
  describe('Checkpoint auto-save', () => {
    it('should save checkpoint after LLM response when enabled', async () => {
      llm.setResponses([
        {
          content: 'Hello!',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5 },
        },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { checkpointStorage });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Hi');

      // Should have at least one checkpoint saved
      expect(checkpointStorage.savedCheckpoints.length).toBeGreaterThan(0);

      // Verify checkpoint event is emitted as state.change with checkpoint metadata
      const checkpointEvents = events.filter(
        e => e.type === 'state.change' && 'checkpoint' in e
      );
      expect(checkpointEvents.length).toBeGreaterThan(0);
    });

    it('should NOT save checkpoint when disabled', async () => {
      llm.setResponses([
        { content: 'Hello!', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { checkpointStorage });
      const config = createTestConfig({ checkpoint: { enabled: false } });

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Hi');

      expect(checkpointStorage.savedCheckpoints).toHaveLength(0);
    });

    it('should save checkpoint after tool execution', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Beijing' } }],
          finishReason: 'tool_calls',
        },
        { content: 'The weather is sunny.', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { checkpointStorage });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Weather?');

      // Should have multiple checkpoints (after_llm for both LLM calls)
      expect(checkpointStorage.savedCheckpoints.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================
    // ========================================
  describe('Audit log on LLM request', () => {
    it('should record audit entry when LLM request is made', async () => {
      llm.setResponses([
        { content: 'Hello!', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { auditLogger });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Hi');

      const llmRequestEntries = auditLogger.getEntriesByEventType('llm.request');
      expect(llmRequestEntries.length).toBeGreaterThan(0);

      const entry = llmRequestEntries[0]!;
      expect(entry.action).toBe('llm.request');
      expect(entry.result).toBe('success');
      expect(entry.details).toHaveProperty('messages');
      expect(entry.details).toHaveProperty('model');
    });
  });

  // ========================================
    // ========================================
  describe('Audit log on tool execution', () => {
    it('should record audit entry when tool is executed', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Beijing' } }],
          finishReason: 'tool_calls',
        },
        { content: 'Done.', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { auditLogger });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Weather?');

      // Should have tool.execute audit entry
      const toolExecuteEntries = auditLogger.getEntriesByEventType('tool.call');
      expect(toolExecuteEntries.length).toBeGreaterThan(0);

      const execEntry = toolExecuteEntries[0]!;
      expect(execEntry.resource).toBe('weather');
      expect(execEntry.action).toBe('tool.call');

      // Should have tool.result audit entry
      const toolResultEntries = auditLogger.getEntriesByEventType('tool.result');
      expect(toolResultEntries.length).toBeGreaterThan(0);

      const resultEntry = toolResultEntries[0]!;
      expect(resultEntry.resource).toBe('weather');
      expect(resultEntry.result).toBe('success');
    });

    it('should record error result when tool fails', async () => {
      toolRegistry.register('failing-tool', async () => {
        throw new Error('Tool failed');
      });

      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'failing-tool', args: {} }],
          finishReason: 'tool_calls',
        },
        { content: 'Error occurred.', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { auditLogger });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Do something');

      const toolResultEntries = auditLogger.getEntriesByEventType('tool.result');
      expect(toolResultEntries.length).toBeGreaterThan(0);

      const errorResult = toolResultEntries.find(e => e.result === 'error');
      expect(errorResult).toBeDefined();
    });
  });

  // ========================================
    // ========================================
  describe('Audit log on error', () => {
    it('should record audit entry when LLM error occurs', async () => {
      llm.setShouldFail(true);

      const ctx = createTestContext(llm, toolRegistry, { auditLogger });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Hi');

      const errorEntries = auditLogger.getEntriesByEventType('agent.error');
      expect(errorEntries.length).toBeGreaterThan(0);

      const entry = errorEntries[0]!;
      expect(entry.action).toBe('agent.error');
      expect(entry.result).toBe('error');
      expect(entry.details).toHaveProperty('error');
    });
  });

  // ========================================
    // ========================================
  describe('Audit log sessionId', () => {
    it('should include correct sessionId in all audit entries', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Beijing' } }],
          finishReason: 'tool_calls',
        },
        { content: 'Done.', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { auditLogger });
      const expectedSessionId = ctx.sessionId;
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Weather?');

      // All audit entries should have the correct sessionId
      for (const entry of auditLogger.entries) {
        expect(entry.sessionId).toBe(expectedSessionId);
      }

      expect(auditLogger.entries.length).toBeGreaterThan(0);
    });
  });

  // ========================================
    // ========================================
  describe('Audit log eventType', () => {
    it('should record llm.response audit with correct eventType and token usage', async () => {
      llm.setResponses([
        {
          content: 'Hello!',
          finishReason: 'stop',
          usage: { promptTokens: 50, completionTokens: 20 },
        },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { auditLogger });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Hi');

      const llmResponseEntries = auditLogger.getEntriesByEventType('llm.response');
      expect(llmResponseEntries.length).toBeGreaterThan(0);

      const entry = llmResponseEntries[0]!;
      expect(entry.eventType).toBe('llm.response');
      expect(entry.action).toBe('llm.response');
      expect(entry.details).toHaveProperty('finishReason');
      expect(entry.details).toHaveProperty('usage');
    });

    it('should record tool.execute with correct eventType', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'calculator', args: { a: 1, b: 2 } }],
          finishReason: 'tool_calls',
        },
        { content: '3', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { auditLogger });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Calculate 1+2');

      const toolExecuteEntries = auditLogger.getEntriesByEventType('tool.call');
      expect(toolExecuteEntries.length).toBeGreaterThan(0);

      const entry = toolExecuteEntries[0]!;
      expect(entry.eventType).toBe('tool.call');
      expect(entry.resource).toBe('calculator');
    });

    it('should record multiple event types in a tool-call conversation', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Shanghai' } }],
          finishReason: 'tool_calls',
        },
        { content: 'Weather is sunny.', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry, { auditLogger });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      await runAndCollect(agent, 'Weather in Shanghai?');

      const eventTypes = new Set(auditLogger.entries.map(e => e.eventType));

      // Should have both LLM and tool audit entries
      expect(eventTypes.has('llm.request')).toBe(true);
      expect(eventTypes.has('llm.response')).toBe(true);
      expect(eventTypes.has('tool.call')).toBe(true);
      expect(eventTypes.has('tool.result')).toBe(true);
    });
  });

  // ========================================
  // Combined: Persistence + Audit working together
  // ========================================
  describe('Combined: Checkpoint + Audit integration', () => {
    it('should produce both checkpoint events and audit entries', async () => {
      llm.setResponses([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Guangzhou' } }],
          finishReason: 'tool_calls',
        },
        { content: 'Done.', finishReason: 'stop' },
      ]);

      const ctx = createTestContext(llm, toolRegistry, {
        checkpointStorage,
        auditLogger,
      });
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Weather?');

      // Checkpoint events emitted as state.change with checkpoint metadata
      const checkpointEvents = events.filter(
        e => e.type === 'state.change' && 'checkpoint' in e
      );
      expect(checkpointEvents.length).toBeGreaterThan(0);

      // Checkpoints persisted to storage
      expect(checkpointStorage.savedCheckpoints.length).toBeGreaterThan(0);

      // Audit entries recorded
      expect(auditLogger.entries.length).toBeGreaterThan(0);
      expect(auditLogger.getEntriesByEventType('llm.request').length).toBeGreaterThan(0);
      expect(auditLogger.getEntriesByEventType('tool.call').length).toBeGreaterThan(0);
    });
  });
});
