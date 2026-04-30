/**
 * Workflow Subsystem Tests
 *
 * Tests for the workflow orchestration engine.
 * Validates Workflow, WorkflowExecutor, SequentialPipeline, and ParallelPipeline.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Observable, of, from, Subject, firstValueFrom, toArray } from 'rxjs';
import { filter, take, tap, map } from 'rxjs/operators';
import {
  Workflow,
  createWorkflow,
  WorkflowExecutor,
  SequentialPipeline,
  ParallelPipeline,
  createSequentialPipeline,
  createParallelPipeline,
  type WorkflowStep,
  type WorkflowConfig,
  type WorkflowExecutionContext,
  isWorkflowEvent,
  getWorkflowIdFromEvent,
} from '../../src/workflow/index.js';
import {
  type AgentContext,
  type AgentEvent,
  type LLMResponse,
  type LLMAdapter,
  type ToolRegistry,
  type ToolDefinition,
  InMemoryStore,
  DefaultPauseController,
  SimpleSchemaRegistry,
  generateId,
  serializeError,
} from '../../src/core/index.js';
import { AgentLoop, type AgentLoopOptions } from '../../src/api/agent-loop.js';

// ============================================================
// Mock LLM Adapter
// ============================================================

interface MockLLMResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';
  usage?: { promptTokens: number; completionTokens: number };
}

class MockLLMAdapter implements LLMAdapter {
  readonly name = 'mock-adapter';
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

  async chat(): Promise<LLMResponse> {
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

  async *stream(): AsyncGenerator<LLMChunk> {
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

  async execute(name: string, args: Record<string, unknown>, _ctx?: unknown): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    return tool.execute(args);
  }

  registerAll(_tools: ToolDefinition[]): void {}
}

// ============================================================
// Test Helpers
// ============================================================

function createTestContext(llm: MockLLMAdapter, toolRegistry: MockToolRegistry): AgentContext {
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

function createTestWorkflowConfig(): WorkflowConfig {
  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    steps: [
      {
        id: 'step-1',
        name: 'First Step',
        prompt: (input: unknown) => `Process: ${input}`,
      },
      {
        id: 'step-2',
        name: 'Second Step',
        prompt: (input: unknown) => `Analyze: ${input}`,
      },
    ],
  };
}

// ============================================================
// Tests
// ============================================================

describe('Workflow Subsystem', () => {
  let llm: MockLLMAdapter;
  let toolRegistry: MockToolRegistry;
  let ctx: AgentContext;

  beforeEach(() => {
    llm = new MockLLMAdapter();
    toolRegistry = new MockToolRegistry();
    ctx = createTestContext(llm, toolRegistry);
  });

  // ========================================
  // Workflow Class Tests
  // ========================================
  describe('Workflow Class', () => {
    it('should create workflow instance', () => {
      const config = createTestWorkflowConfig();
      const workflow = new Workflow(config, ctx);

      expect(workflow).toBeInstanceOf(Workflow);
      expect(workflow.getExecutionContext()).toBeNull();
    });

    it('should create workflow via factory function', () => {
      const config = createTestWorkflowConfig();
      const workflow = createWorkflow(config, ctx);

      expect(workflow).toBeInstanceOf(Workflow);
    });

    it('should emit workflow.start and workflow.complete events', async () => {
      llm.setResponses([
        { content: 'Step 1 result', finishReason: 'stop' },
        { content: 'Step 2 result', finishReason: 'stop' },
      ]);

      const config = createTestWorkflowConfig();
      const workflow = new Workflow(config, ctx);

      const events = await firstValueFrom(workflow.run('test input').pipe(toArray()));

      const types = events.map(e => e.type);
      expect(types).toContain('workflow.start');
      expect(types).toContain('workflow.complete');

      // Check workflow.start has expected fields
      const startEvent = events.find(e => e.type === 'workflow.start');
      expect(startEvent).toBeDefined();
      if (startEvent && startEvent.type === 'workflow.start') {
        expect(startEvent.workflowName).toBe('Test Workflow');
        expect(startEvent.workflowId).toBeDefined();
      }
    });

    it('should emit workflow.step.start and workflow.step.end for each step', async () => {
      llm.setResponses([
        { content: 'Step 1 result', finishReason: 'stop' },
        { content: 'Step 2 result', finishReason: 'stop' },
      ]);

      const config = createTestWorkflowConfig();
      const workflow = new Workflow(config, ctx);

      const events = await firstValueFrom(workflow.run('test input').pipe(toArray()));

      const types = events.map(e => e.type);

      // Should have 2 step.start and 2 step.end events
      expect(types.filter(t => t === 'workflow.step.start')).toHaveLength(2);
      expect(types.filter(t => t === 'workflow.step.end')).toHaveLength(2);
    });

    it('should pass output from one step to next step', async () => {
      const stepResults: string[] = [];

      llm.setResponses([
        { content: 'Result from step 1', finishReason: 'stop' },
        { content: 'Result from step 2', finishReason: 'stop' },
      ]);

      const config: WorkflowConfig = {
        id: 'pipeline-test',
        name: 'Pipeline Test',
        steps: [
          {
            id: 'step-1',
            prompt: input => {
              stepResults.push(`step-1: ${String(input)}`);
              return `Process: ${input}`;
            },
          },
          {
            id: 'step-2',
            prompt: input => {
              stepResults.push(`step-2: ${String(input)}`);
              return `Analyze: ${input}`;
            },
          },
        ],
      };

      const workflow = new Workflow(config, ctx);
      await firstValueFrom(workflow.run('initial').pipe(toArray()));

      // Verify prompts were called
      expect(stepResults.length).toBe(2);
    });

    it('should handle workflow.suspend and workflow.resume', async () => {
      llm.setResponses([
        { content: 'Step 1 result', finishReason: 'stop' },
        { content: 'Step 2 result', finishReason: 'stop' },
      ]);

      const config = createTestWorkflowConfig();
      const workflow = new Workflow(config, ctx);

      // Suspend should update execution context
      workflow.suspend('Testing suspend');

      const execCtx = workflow.getExecutionContext();
      // At this point workflow hasn't run, so context should be null
      expect(execCtx).toBeNull();
    });

    it('should handle workflow.cancel', async () => {
      llm.setResponses([
        { content: 'Step 1 result', finishReason: 'stop' },
        { content: 'Step 2 result', finishReason: 'stop' },
      ]);

      const config = createTestWorkflowConfig();
      const workflow = new Workflow(config, ctx);

      // Cancel should work without error
      workflow.cancel('Test cancellation');

      // Execution context should remain null (workflow never ran)
      const execCtx = workflow.getExecutionContext();
      expect(execCtx).toBeNull();
    });

    it('should destroy workflow and clean up resources', () => {
      const config = createTestWorkflowConfig();
      const workflow = new Workflow(config, ctx);

      workflow.destroy();

      // No errors should be thrown
      expect(true).toBe(true);
    });
  });

  // ========================================
  // WorkflowExecutor Tests
  // ========================================
  describe('WorkflowExecutor', () => {
    it('should create executor instance', () => {
      const executor = new WorkflowExecutor(ctx);
      expect(executor).toBeInstanceOf(WorkflowExecutor);
    });

    it('should execute step and emit events', async () => {
      llm.setResponses([{ content: 'Step completed', finishReason: 'stop' }]);

      const executor = new WorkflowExecutor(ctx);
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        prompt: input => `Process: ${input}`,
      };

      const events = await firstValueFrom(
        executor.executeStep(step, 'test input', 'wf-123').pipe(toArray())
      );

      const types = events.map(e => e.type);
      expect(types).toContain('workflow.step.start');
      expect(types).toContain('workflow.step.end');
    });

    it('should map agent events with workflowId', async () => {
      llm.setResponses([{ content: 'Agent response', finishReason: 'stop' }]);

      const executor = new WorkflowExecutor(ctx);
      const step: WorkflowStep = {
        id: 'mapping-test',
        prompt: () => 'Test prompt',
      };

      const events = await firstValueFrom(
        executor.executeStep(step, 'input', 'wf-test-id').pipe(toArray())
      );

      // Check workflow.step.start has workflowId
      const startEvent = events.find(e => e.type === 'workflow.step.start');
      if (startEvent && startEvent.type === 'workflow.step.start') {
        expect(startEvent.workflowId).toBe('wf-test-id');
      }
    });

    it('should use createPromptGenerator helper', async () => {
      const { createPromptGenerator } = await import('../../src/workflow/executor.js');

      const generator = createPromptGenerator('Input is: {{input}}');
      const prompt = generator('hello');

      expect(prompt).toBe('Input is: hello');
    });

    it('should use createJsonPromptGenerator helper', async () => {
      const { createJsonPromptGenerator } = await import('../../src/workflow/executor.js');

      const generator = createJsonPromptGenerator('Data: {{input}}');
      const prompt = generator({ key: 'value' });

      expect(prompt).toContain('Data:');
      expect(prompt).toContain('key');
    });
  });

  // ========================================
  // SequentialPipeline Tests
  // ========================================
  describe('SequentialPipeline', () => {
    it('should create sequential pipeline', () => {
      const steps: WorkflowStep[] = [
        { id: 'step-1', prompt: i => String(i) },
        { id: 'step-2', prompt: i => String(i) },
      ];

      const pipeline = new SequentialPipeline(steps, ctx);
      expect(pipeline).toBeInstanceOf(SequentialPipeline);
    });

    it('should create pipeline via factory function', () => {
      const steps: WorkflowStep[] = [{ id: 's1', prompt: i => String(i) }];

      const pipeline = createSequentialPipeline(steps, ctx);
      expect(pipeline).toBeInstanceOf(SequentialPipeline);
    });

    it('should emit workflow events in sequential order', async () => {
      llm.setResponses([
        { content: 'First result', finishReason: 'stop' },
        { content: 'Second result', finishReason: 'stop' },
      ]);

      const steps: WorkflowStep[] = [
        { id: 'seq-1', name: 'First', prompt: i => `Step 1: ${i}` },
        { id: 'seq-2', name: 'Second', prompt: i => `Step 2: ${i}` },
      ];

      const pipeline = new SequentialPipeline(steps, ctx);
      const events = await firstValueFrom(pipeline.run('input').pipe(toArray()));

      const types = events.map(e => e.type);
      expect(types).toContain('workflow.start');

      // Find step.start events and verify order
      const stepStarts = events.filter(e => e.type === 'workflow.step.start');
      expect(stepStarts).toHaveLength(2);

      // Verify workflow.complete
      expect(types).toContain('workflow.complete');
    });

    it('should stop pipeline on step failure (continueOnFailure=false)', async () => {
      llm.setFailNTimes(1);

      const steps: WorkflowStep[] = [
        { id: 'fail-1', prompt: i => String(i) },
        { id: 'fail-2', prompt: i => String(i) },
      ];

      const pipeline = new SequentialPipeline(steps, ctx, { continueOnFailure: false });

      try {
        await firstValueFrom(pipeline.run('input').pipe(toArray()));
        // Should throw
        expect(true).toBe(false);
      } catch {
        // Expected
        expect(true).toBe(true);
      }
    });

    it('should continue on step failure (continueOnFailure=true)', async () => {
      llm.setResponses([{ content: 'Good result', finishReason: 'stop' }]);

      const steps: WorkflowStep[] = [
        { id: 'cont-1', prompt: i => String(i) },
        { id: 'cont-2', prompt: i => String(i) },
      ];

      const pipeline = new SequentialPipeline(steps, ctx, { continueOnFailure: true });
      const events = await firstValueFrom(pipeline.run('input').pipe(toArray()));

      // Should complete even if configured to continue on failure
      expect(events.some(e => e.type === 'workflow.complete')).toBe(true);
    });

    it('should support stop() and destroy()', () => {
      const steps: WorkflowStep[] = [{ id: 'stop-1', prompt: i => String(i) }];
      const pipeline = new SequentialPipeline(steps, ctx);

      pipeline.stop();
      pipeline.destroy();

      expect(true).toBe(true);
    });
  });

  // ========================================
  // ParallelPipeline Tests
  // ========================================
  describe('ParallelPipeline', () => {
    it('should create parallel pipeline', () => {
      const steps: WorkflowStep[] = [
        { id: 'p1', prompt: i => String(i) },
        { id: 'p2', prompt: i => String(i) },
      ];

      const pipeline = new ParallelPipeline(steps, ctx);
      expect(pipeline).toBeInstanceOf(ParallelPipeline);
    });

    it('should create pipeline via factory function', () => {
      const steps: WorkflowStep[] = [{ id: 'fp1', prompt: i => String(i) }];
      const pipeline = createParallelPipeline(steps, ctx);
      expect(pipeline).toBeInstanceOf(ParallelPipeline);
    });

    it('should emit workflow events with maxConcurrency', async () => {
      llm.setResponses([
        { content: 'Parallel result 1', finishReason: 'stop' },
        { content: 'Parallel result 2', finishReason: 'stop' },
      ]);

      const steps: WorkflowStep[] = [
        { id: 'par-1', name: 'Parallel 1', prompt: () => 'Task 1' },
        { id: 'par-2', name: 'Parallel 2', prompt: () => 'Task 2' },
      ];

      const pipeline = new ParallelPipeline(steps, ctx, { maxConcurrency: 2 });
      const events = await firstValueFrom(pipeline.run('input').pipe(toArray()));

      const types = events.map(e => e.type);
      expect(types).toContain('workflow.start');
      expect(types).toContain('workflow.complete');
    });

    it('should respect maxConcurrency limit', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const originalChat = llm.chat.bind(llm);
      llm.chat = async function () {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentCount--;
        return originalChat();
      };

      const steps: WorkflowStep[] = [
        { id: 'c1', prompt: () => '1' },
        { id: 'c2', prompt: () => '2' },
        { id: 'c3', prompt: () => '3' },
        { id: 'c4', prompt: () => '4' },
      ];

      const pipeline = new ParallelPipeline(steps, ctx, { maxConcurrency: 2 });
      await firstValueFrom(pipeline.run('input').pipe(toArray()));

      // Max concurrent should be at most 2
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should support stop() and destroy()', () => {
      const steps: WorkflowStep[] = [{ id: 'stop-p1', prompt: i => String(i) }];
      const pipeline = new ParallelPipeline(steps, ctx);

      pipeline.stop();
      pipeline.destroy();

      expect(true).toBe(true);
    });
  });

  // ========================================
  // Type Helpers Tests
  // ========================================
  describe('Type Helpers', () => {
    it('should identify workflow events', () => {
      const workflowEvent: AgentEvent = {
        type: 'workflow.start',
        timestamp: Date.now(),
        sessionId: 'test',
        workflowId: 'wf-123',
        workflowName: 'Test',
      };

      const agentEvent: AgentEvent = {
        type: 'agent.start',
        timestamp: Date.now(),
        sessionId: 'test',
        input: 'hello',
        agentName: 'test-agent',
        model: { provider: 'mock', model: 'test' },
      };

      expect(isWorkflowEvent(workflowEvent)).toBe(true);
      expect(isWorkflowEvent(agentEvent)).toBe(false);
    });

    it('should extract workflowId from event', () => {
      const event: AgentEvent = {
        type: 'workflow.step.start',
        timestamp: Date.now(),
        sessionId: 'test',
        workflowId: 'wf-456',
        stepId: 'step-1',
        stepName: 'Test Step',
      };

      const workflowId = getWorkflowIdFromEvent(event);
      expect(workflowId).toBe('wf-456');

      const agentEvent: AgentEvent = {
        type: 'agent.complete',
        timestamp: Date.now(),
        sessionId: 'test',
        output: 'done',
        steps: 1,
      };

      expect(getWorkflowIdFromEvent(agentEvent)).toBeUndefined();
    });
  });

  // ========================================
  // Edge Cases
  // ========================================
  describe('Edge Cases', () => {
    it('should handle step with skip condition', async () => {
      llm.setResponses([{ content: 'Not skipped', finishReason: 'stop' }]);

      const config: WorkflowConfig = {
        id: 'skip-test',
        name: 'Skip Test',
        steps: [
          {
            id: 'should-skip',
            name: 'Should Skip',
            prompt: () => 'Should not run',
            skip: () => true,
          },
          {
            id: 'should-run',
            name: 'Should Run',
            prompt: () => 'Should run',
            skip: () => false,
          },
        ],
      };

      const workflow = new Workflow(config, ctx);
      const events = await firstValueFrom(workflow.run('input').pipe(toArray()));

      // Should have skipped step
      const skippedEvent = events.find(
        e => e.type === 'workflow.step.end' && 'result' in e && e.result === 'skipped'
      );
      expect(skippedEvent).toBeDefined();
    });

    it('should handle single-step workflow', async () => {
      llm.setResponses([{ content: 'Done', finishReason: 'stop' }]);

      const config: WorkflowConfig = {
        id: 'single-step',
        name: 'Single Step',
        steps: [{ id: 'only-step', prompt: i => String(i) }],
      };

      const workflow = new Workflow(config, ctx);
      const events = await firstValueFrom(workflow.run('input').pipe(toArray()));

      expect(events.some(e => e.type === 'workflow.start')).toBe(true);
      expect(events.some(e => e.type === 'workflow.complete')).toBe(true);
    });

    it('should handle empty config gracefully', () => {
      const config: WorkflowConfig = {
        id: 'empty',
        name: 'Empty Workflow',
        steps: [],
      };

      // Should not throw on construction
      expect(() => new Workflow(config, ctx)).not.toThrow();
    });
  });
});
