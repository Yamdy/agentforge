/**
 * Shared Mock Implementations for LLM, Tools, and Permissions
 *
 * Canonical mocks extracted from tests/loop/agent-loop.spec.ts.
 * Import these instead of defining private copies in each test file.
 *
 * @module
 */

import type {
  LLMAdapter,
  LLMResponse,
  LLMChunk,
  ToolRegistry,
  ToolDefinition,
  PermissionController,
  PermissionDecision,
} from '../../src/core/interfaces.js';
import type { ToolCall, Message } from '../../src/core/events.js';

// ============================================================
// MockLLMAdapter
// ============================================================

export interface MockLLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';
  usage?: { promptTokens: number; completionTokens: number };
}

export class MockLLMAdapter implements LLMAdapter {
  readonly name = 'mock';
  readonly provider = 'mock';

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

  async chat(_messages: Message[]): Promise<LLMResponse> {
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

  async *stream(_messages: Message[]): AsyncGenerator<LLMChunk> {
    yield { text: 'stream' };
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// ============================================================
// MockToolRegistry
// ============================================================

type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

export class MockToolRegistry implements ToolRegistry {
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

  setToolRiskLevel(name: string, riskLevel: 'low' | 'medium' | 'high' | 'critical'): void {
    const tool = this.tools.get(name);
    if (tool) {
      tool.riskLevel = riskLevel;
    }
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
// MockPermissionController
// ============================================================

export class MockPermissionController implements PermissionController {
  private decisions: PermissionDecision[] = [];
  private decisionIndex = 0;

  setDecisions(decisions: PermissionDecision[]): void {
    this.decisions = decisions;
    this.decisionIndex = 0;
  }

  async ask(): Promise<PermissionDecision> {
    if (this.decisionIndex < this.decisions.length) {
      return this.decisions[this.decisionIndex++]!;
    }
    return 'deny';
  }

  onAsk(): () => void {
    return () => {};
  }

  answer(): void {}

  isAutoAllowed(): boolean {
    return false;
  }

  cancel(): void {}
}
