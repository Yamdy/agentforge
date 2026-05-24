import { describe, it, expect, vi } from 'vitest';
import { LoopOrchestrator, RunMode } from '../src/loop-orchestrator.js';
import type { PipelineRunner } from '../src/pipeline.js';
import type { HookManager } from '../src/hook-manager.js';
import type { PipelineContext, StreamEvent } from '@primo-ai/sdk';
import type { LoopOptions } from '../src/loop-orchestrator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRunner(): { runner: PipelineRunner } {
  const streamFn = vi.fn().mockImplementation(
    async function* (ctx: PipelineContext, _stages: unknown, _opts?: unknown): AsyncGenerator<StreamEvent> {
      // Inject loopDirective.stop so the orchestration loop terminates after 1 iteration
      const modified: PipelineContext = {
        ...ctx,
        iteration: { ...ctx.iteration, step: 0, loopDirective: { action: 'stop' as const } },
      };
      yield { type: 'complete', context: modified } as StreamEvent;
    },
  );

  return {
    runner: { stream: streamFn } as unknown as PipelineRunner,
  };
}

function createMockHookManager(): HookManager {
  return { invoke: vi.fn().mockResolvedValue(undefined) } as unknown as HookManager;
}

function createMinimalContext(): PipelineContext {
  return {
    agent: {
      config: { model: 'test-model' },
      toolDeclarations: [],
      promptFragments: [],
    },
    iteration: { step: 0 },
    session: { input: 'hello', sessionId: 'test-session', custom: {} },
  } as unknown as PipelineContext;
}

const defaultOptions: LoopOptions = {
  maxIterations: 10,
  modelString: 'test-model',
  sessionId: 'test-session',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoopOrchestrator RunMode', () => {
  describe('RunMode.Normal (default)', () => {
    it('starts in Normal mode', () => {
      const { runner } = createMockRunner();
      const orchestrator = new LoopOrchestrator(runner, createMockHookManager());
      expect(orchestrator.mode).toBe(RunMode.Normal);
    });

    it('runs loop immediately in Normal mode', async () => {
      const { runner } = createMockRunner();
      const orchestrator = new LoopOrchestrator(runner, createMockHookManager());

      const result = await orchestrator.runLoop(createMinimalContext(), defaultOptions);

      expect(result).toBeDefined();
      expect(result.context).toBeDefined();
      expect(runner.stream).toHaveBeenCalled();
    });

    it('returns LoopResult with context and compatRetries', async () => {
      const { runner } = createMockRunner();
      const orchestrator = new LoopOrchestrator(runner, createMockHookManager());

      const result = await orchestrator.runLoop(createMinimalContext(), { ...defaultOptions });

      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('compatRetries');
      expect(result.compatRetries).toBe(0);
      expect(runner.stream).toHaveBeenCalled();
    });
  });

  describe('RunMode.Shell', () => {
    it('queues run instead of executing when mode is Shell', async () => {
      const { runner } = createMockRunner();
      const orchestrator = new LoopOrchestrator(runner, createMockHookManager());

      orchestrator.setMode(RunMode.Shell);
      expect(orchestrator.mode).toBe(RunMode.Shell);

      const runPromise = orchestrator.runLoop(createMinimalContext(), defaultOptions);

      // Should not execute while in Shell mode
      expect(runner.stream).not.toHaveBeenCalled();

      // Drain queue by switching to Normal
      orchestrator.setMode(RunMode.Normal);

      const result = await runPromise;
      expect(result).toBeDefined();
      expect(result.context).toBeDefined();
      expect(runner.stream).toHaveBeenCalled();
    });

    it('queued run uses the same context and options', async () => {
      const { runner } = createMockRunner();
      const orchestrator = new LoopOrchestrator(runner, createMockHookManager());

      orchestrator.setMode(RunMode.Shell);

      const ctx = createMinimalContext();
      const runPromise = orchestrator.runLoop(ctx, { ...defaultOptions, sessionId: 'custom-session' });

      orchestrator.setMode(RunMode.Normal);

      const result = await runPromise;
      expect(result).toBeDefined();
      expect(result.context.session.sessionId).toBe('test-session');
    });

    it('rejects additional queued runs while one is pending', async () => {
      const { runner } = createMockRunner();
      const orchestrator = new LoopOrchestrator(runner, createMockHookManager());

      orchestrator.setMode(RunMode.Shell);

      const ctx = createMinimalContext();
      // First queue succeeds
      const firstPromise = orchestrator.runLoop(ctx, defaultOptions);

      // Second queue is rejected
      await expect(orchestrator.runLoop(ctx, defaultOptions)).rejects.toThrow(/already queued/i);

      // Drain to clean up
      orchestrator.setMode(RunMode.Normal);
      await firstPromise;
    });
  });

  describe('Shell -> Normal transition (drain)', () => {
    it('auto-starts queued run when mode changes to Normal', async () => {
      const { runner } = createMockRunner();
      const orchestrator = new LoopOrchestrator(runner, createMockHookManager());

      orchestrator.setMode(RunMode.Shell);

      let executed = false;
      const runPromise = orchestrator.runLoop(createMinimalContext(), defaultOptions).then((r) => {
        executed = true;
        return r;
      });

      // Not yet executed
      expect(executed).toBe(false);

      // Transition triggers execution
      orchestrator.setMode(RunMode.Normal);

      await runPromise;
      expect(executed).toBe(true);
      expect(runner.stream).toHaveBeenCalled();
    });

    it('queued runs execute serially (one at a time)', async () => {
      const { runner } = createMockRunner();
      const orchestrator = new LoopOrchestrator(runner, createMockHookManager());

      orchestrator.setMode(RunMode.Shell);

      const firstPromise = orchestrator.runLoop(createMinimalContext(), defaultOptions);

      // Drain and verify one run
      orchestrator.setMode(RunMode.Normal);

      await firstPromise;
      // stream should have been called once for the pre-loop + once for the loop + once for post-loop
      // But the mock runner only gets called via runLoop -> streamCore, so the first run calls stream 3 times
      // Actually runner.stream is called once per stage group: pre-loop, loop, post-loop.
      expect(runner.stream).toHaveBeenCalledTimes(3);
    });
  });

  describe('mode transition validation', () => {
    it('allows Normal -> Shell transition', () => {
      const orchestrator = new LoopOrchestrator(createMockRunner().runner, createMockHookManager());
      expect(orchestrator.mode).toBe(RunMode.Normal);
      orchestrator.setMode(RunMode.Shell);
      expect(orchestrator.mode).toBe(RunMode.Shell);
    });

    it('allows Shell -> Normal transition (drains queue)', () => {
      const orchestrator = new LoopOrchestrator(createMockRunner().runner, createMockHookManager());
      orchestrator.setMode(RunMode.Shell);
      orchestrator.setMode(RunMode.Normal);
      expect(orchestrator.mode).toBe(RunMode.Normal);
    });

    it('is no-op when setting Normal -> Normal', () => {
      const orchestrator = new LoopOrchestrator(createMockRunner().runner, createMockHookManager());
      orchestrator.setMode(RunMode.Normal);
      expect(orchestrator.mode).toBe(RunMode.Normal);
    });

    it('is no-op when setting Shell -> Shell', () => {
      const orchestrator = new LoopOrchestrator(createMockRunner().runner, createMockHookManager());
      orchestrator.setMode(RunMode.Shell);
      orchestrator.setMode(RunMode.Shell);
      expect(orchestrator.mode).toBe(RunMode.Shell);
    });
  });

  describe('onModeChange callback', () => {
    it('fires callback on mode change', () => {
      const orchestrator = new LoopOrchestrator(createMockRunner().runner, createMockHookManager());
      const transitions: RunMode[] = [];
      orchestrator.onModeChange((m) => transitions.push(m));

      orchestrator.setMode(RunMode.Shell);
      expect(transitions).toEqual([RunMode.Shell]);

      orchestrator.setMode(RunMode.Normal);
      expect(transitions).toEqual([RunMode.Shell, RunMode.Normal]);
    });

    it('does not fire callback on no-op transition', () => {
      const orchestrator = new LoopOrchestrator(createMockRunner().runner, createMockHookManager());
      const cb = vi.fn();
      orchestrator.onModeChange(cb);

      orchestrator.setMode(RunMode.Normal); // no-op
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
