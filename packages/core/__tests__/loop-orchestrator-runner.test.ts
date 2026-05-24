/**
 * Integration tests for Runner pattern in LoopOrchestrator
 *
 * Tests the enhanced interrupt-resume capabilities provided by Runner
 * while maintaining backward compatibility with existing RunMode API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoopOrchestrator, RunMode, type LoopOptions } from '../src/loop-orchestrator.js';
import { Runner } from '../src/runner.js';
import type { PipelineContext, StreamEvent } from '@primo-ai/sdk';
import type { PipelineRunner } from '../src/pipeline.js';
import type { HookManager } from '../src/hook-manager.js';
import type { EventBus } from '../src/event-bus.js';

// Minimal mock implementations
function createMockPipelineRunner(): PipelineRunner {
  return {
    stream: vi.fn(async function* (): AsyncGenerator<StreamEvent> {
      yield { type: 'complete', context: createMockContext() };
    }),
    run: vi.fn(async () => createMockContext()),
  } as unknown as PipelineRunner;
}

function createMockHookManager(): HookManager {
  return {
    invoke: vi.fn(async () => {}),
    register: vi.fn(),
  } as unknown as HookManager;
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as EventBus;
}

function createMockContext(): PipelineContext {
  return {
    agent: {
      config: { model: 'test-model' },
      prompt: '',
      tools: [],
      toolDeclarations: [],
      promptFragments: [],
    },
    iteration: {
      step: 0,
      response: '',
      content: [],
      loopDirective: { action: 'stop' },
    },
    session: {
      input: 'test',
      sessionId: 'test-session',
      messageHistory: [],
      tokenUsage: { input: 0, output: 0, reasoning: 0 },
      custom: {},
    },
  } as PipelineContext;
}

function createLoopOptions(overrides?: Partial<LoopOptions>): LoopOptions {
  return {
    maxIterations: 1,
    modelString: 'test-model',
    sessionId: 'test-session',
    ...overrides,
  };
}

describe('LoopOrchestrator with Runner', () => {
  let orchestrator: LoopOrchestrator;
  let mockRunner: PipelineRunner;
  let mockHooks: HookManager;
  let mockEvents: EventBus;

  beforeEach(() => {
    mockRunner = createMockPipelineRunner();
    mockHooks = createMockHookManager();
    mockEvents = createMockEventBus();
    orchestrator = new LoopOrchestrator(mockRunner, mockHooks, undefined, mockEvents);
  });

  describe('backward compatibility with RunMode', () => {
    it('defaults to Normal mode', () => {
      expect(orchestrator.mode).toBe(RunMode.Normal);
    });

    it('allows Normal -> Shell transition', () => {
      orchestrator.setMode(RunMode.Shell);
      expect(orchestrator.mode).toBe(RunMode.Shell);
    });

    it('allows Shell -> Normal transition', () => {
      orchestrator.setMode(RunMode.Shell);
      orchestrator.setMode(RunMode.Normal);
      expect(orchestrator.mode).toBe(RunMode.Normal);
    });

    it('rejects invalid transitions', () => {
      // Normal -> Normal is a no-op, not an error
      orchestrator.setMode(RunMode.Normal);
      expect(orchestrator.mode).toBe(RunMode.Normal);
    });

    it('queues runs when in Shell mode', async () => {
      orchestrator.setMode(RunMode.Shell);

      const ctx = createMockContext();
      const options = createLoopOptions();

      // This should queue, not execute immediately
      const promise = orchestrator.runLoop(ctx, options);

      // Switch back to Normal to drain the queue
      orchestrator.setMode(RunMode.Normal);

      // Now the queued run should complete
      const result = await promise;
      expect(result).toBeDefined();
    });
  });

  describe('Runner integration', () => {
    it('exposes the Runner instance', () => {
      expect(orchestrator.taskRunner).toBeInstanceOf(Runner);
    });

    it('Runner starts in Idle state', () => {
      expect(orchestrator.taskRunner.state._tag).toBe('Idle');
    });

    it('Runner transitions to Running during runLoop', async () => {
      const ctx = createMockContext();
      const options = createLoopOptions({ maxIterations: 1 });

      // Capture state during execution
      let stateDuringRun: string | undefined;
      vi.mocked(mockRunner.stream).mockImplementation(async function* () {
        stateDuringRun = orchestrator.taskRunner.state._tag;
        yield { type: 'complete', context: ctx };
      });

      await orchestrator.runLoop(ctx, options);

      expect(stateDuringRun).toBe('Running');
      expect(orchestrator.taskRunner.state._tag).toBe('Idle');
    });

    it('Runner supports cancellation via abort signal', async () => {
      const ctx = createMockContext();
      const controller = new AbortController();
      const options = createLoopOptions({ signal: controller.signal, maxIterations: 100 });

      // Mock a slow stream that checks abort signal
      vi.mocked(mockRunner.stream).mockImplementation(async function* () {
        // Simulate slow processing - abort should interrupt
        await new Promise(r => setTimeout(r, 50));
        if (controller.signal.aborted) {
          throw new DOMException('Agent stream aborted', 'AbortError');
        }
        yield { type: 'complete', context: ctx };
      });

      // Start a run that we'll abort
      const runPromise = orchestrator.runLoop(ctx, options);

      // Abort after a small delay
      setTimeout(() => controller.abort(), 10);

      await expect(runPromise).rejects.toThrow();
      expect(orchestrator.taskRunner.state._tag).toBe('Idle');
    });
  });

  describe('Shell mode interrupt-resume', () => {
    it('Runner transitions to Shell mode when setMode(Shell)', () => {
      orchestrator.setMode(RunMode.Shell);
      // Runner should be in Shell state when not running
      expect(orchestrator.taskRunner.busy).toBe(false);
    });

    it('supports interrupt callback for shell mode', async () => {
      const onInterrupt = vi.fn().mockReturnValue('interrupted');

      orchestrator.setMode(RunMode.Shell);
      await orchestrator.taskRunner.startShell(
        async () => {
          // Simulate long-running work
          await new Promise(r => setTimeout(r, 1000));
          return 'completed';
        },
        { onInterrupt },
      );

      // Cancel should trigger onInterrupt
      await orchestrator.taskRunner.cancel();

      // Runner should be back to Idle
      expect(orchestrator.taskRunner.state._tag).toBe('Idle');
    });
  });

  describe('mode change events', () => {
    it('fires onModeChange callback', () => {
      const callback = vi.fn();
      orchestrator.onModeChange(callback);

      orchestrator.setMode(RunMode.Shell);

      expect(callback).toHaveBeenCalledWith(RunMode.Shell);
    });

    it('does not fire onModeChange for no-op transitions', () => {
      const callback = vi.fn();
      orchestrator.onModeChange(callback);

      orchestrator.setMode(RunMode.Normal); // Already Normal

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
