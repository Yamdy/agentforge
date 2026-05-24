import { describe, it, expect, vi } from 'vitest';
import type { PipelineContext, Processor } from '@primo-ai/sdk';
import { ProcessorContextImpl, AbortControlFlow, SuspendControlFlow } from '@primo-ai/core';
import { createPermissionProcessor, type PermissionRule } from '../src/permission/index.js';
import type { PermissionManager } from '@primo-ai/core';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { input: 'test', sessionId: 'session-1', custom: {} },
    ...overrides,
  };
}

async function executeProcessor(processor: Processor, ctx: PipelineContext): Promise<{ type: 'ok' | 'abort' | 'suspend'; reason?: string; suspensionId?: string }> {
  const pCtx = new ProcessorContextImpl(ctx);
  try {
    await processor.execute(pCtx);
    return { type: 'ok' };
  } catch (e) {
    if (e instanceof AbortControlFlow) {
      return { type: 'abort', reason: e.reason };
    }
    if (e instanceof SuspendControlFlow) {
      return { type: 'suspend', reason: e.reason, suspensionId: e.suspensionId };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Permission Processor with PermissionManager integration tests
// ---------------------------------------------------------------------------

describe('PermissionProcessor with PermissionManager', () => {
  describe('interactive mode with ask rule and permissionManager', () => {
    it('processor awaits decision from permissionManager', async () => {
      let resolveDecision!: (approved: boolean) => void;
      const decisionPromise = new Promise<boolean>((resolve) => { resolveDecision = resolve; });

      const permissionManager: Partial<PermissionManager> = {
        awaitDecision: vi.fn(() => decisionPromise),
      };

      const rules: PermissionRule[] = [
        { tool: 'file_write', action: 'ask' },
      ];

      const decisions: Array<Record<string, unknown>> = [];
      const processor = createPermissionProcessor({
        mode: 'interactive',
        rules,
        onDecision: (event) => decisions.push(event),
        permissionManager,
      } as any);

      const ctx = makeContext({
        iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'file_write', args: { path: '/tmp/test' } }] },
      });

      // Execute should not resolve until we resolve the decision
      const resultPromise = executeProcessor(processor, ctx);

      // Should not be resolved yet
      expect(resultPromise).toBeInstanceOf(Promise);

      // Now resolve with true (approve)
      resolveDecision(true);

      const result = await resultPromise;

      // Should return ok (allow execution)
      expect(result.type).toBe('ok');

      // Should have emitted 'ask' then 'allow'
      expect(decisions[0].decision).toBe('ask');
      expect(decisions[1].decision).toBe('allow');
    });

    it('when permissionManager resolves false: processor returns abort signal', async () => {
      let resolveDecision!: (approved: boolean) => void;
      const decisionPromise = new Promise<boolean>((resolve) => { resolveDecision = resolve; });

      const permissionManager: Partial<PermissionManager> = {
        awaitDecision: vi.fn(() => decisionPromise),
      };

      const rules: PermissionRule[] = [
        { tool: 'file_write', action: 'ask' },
      ];

      const decisions: Array<Record<string, unknown>> = [];
      const processor = createPermissionProcessor({
        mode: 'interactive',
        rules,
        onDecision: (event) => decisions.push(event),
        permissionManager,
      } as any);

      const ctx = makeContext({
        iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'file_write', args: { path: '/tmp/test' } }] },
      });

      const resultPromise = executeProcessor(processor, ctx);

      // Deny the permission
      resolveDecision(false);

      const result = await resultPromise;

      expect(result.type).toBe('abort');
      expect(result.reason).toContain('file_write');
      expect(result.reason).toContain('denied');

      // Should have emitted 'ask' then 'deny'
      expect(decisions[0].decision).toBe('ask');
      expect(decisions[1].decision).toBe('deny');
    });
  });

  describe('without permissionManager', () => {
    it('falls back to current suspend behavior', async () => {
      const rules: PermissionRule[] = [
        { tool: 'file_write', action: 'ask' },
      ];

      const processor = createPermissionProcessor({
        mode: 'interactive',
        rules,
      });

      const ctx = makeContext({
        iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'file_write', args: { path: '/tmp/test' } }] },
      });

      const result = await executeProcessor(processor, ctx);

      // Should return suspend signal (current behavior)
      expect(result.type).toBe('suspend');
      expect(result.suspensionId).toContain('perm-file_write');
    });
  });

  describe('full-auto mode', () => {
    it('permissionManager is ignored, all allowed', async () => {
      const permissionManager: Partial<PermissionManager> = {
        awaitDecision: vi.fn(),
      };

      const rules: PermissionRule[] = [
        { tool: 'file_write', action: 'ask' },
      ];

      const processor = createPermissionProcessor({
        mode: 'full-auto',
        rules,
        permissionManager,
      } as any);

      const ctx = makeContext({
        iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'file_write', args: { path: '/tmp/test' } }] },
      });

      const result = await executeProcessor(processor, ctx);

      // full-auto mode: allow everything, permissionManager should never be called
      expect(result.type).toBe('ok');
      expect(permissionManager.awaitDecision).not.toHaveBeenCalled();
    });
  });

  describe('multiple ask rules', () => {
    it('each creates separate permission entry', async () => {
      const decisions: Array<Record<string, unknown>> = [];
      const pendingResolvers: Array<(approved: boolean) => void> = [];

      const permissionManager: Partial<PermissionManager> = {
        awaitDecision: vi.fn(() => new Promise<boolean>((resolve) => {
          pendingResolvers.push(resolve);
        })),
      };

      const rules: PermissionRule[] = [
        { tool: 'file_write', action: 'ask' },
      ];

      const processor = createPermissionProcessor({
        mode: 'interactive',
        rules,
        onDecision: (event) => decisions.push(event),
        permissionManager,
      } as any);

      // First call — file_write
      const ctx1 = makeContext({
        iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'file_write', args: { path: '/tmp/a' } }] },
      });

      const promise1 = executeProcessor(processor, ctx1);
      // Resolve first
      pendingResolvers[0]!(true);
      const result1 = await promise1;

      expect(result1.type).toBe('ok');

      // Second call — file_write again
      const ctx2 = makeContext({
        iteration: { step: 1, pendingToolCalls: [{ id: 'call_2', name: 'file_write', args: { path: '/tmp/b' } }] },
      });

      const promise2 = executeProcessor(processor, ctx2);
      pendingResolvers[1]!(false);
      const result2 = await promise2;

      expect(result2.type).toBe('abort');

      // awaitDecision should have been called twice with different permissionIds
      expect(permissionManager.awaitDecision).toHaveBeenCalledTimes(2);
      const call1 = (permissionManager.awaitDecision as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const call2 = (permissionManager.awaitDecision as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(call1.permissionId).not.toBe(call2.permissionId);

      // Total 4 decisions: ask+allow for first, ask+deny for second
      expect(decisions).toHaveLength(4);
      expect(decisions.map(d => d.decision)).toEqual(['ask', 'allow', 'ask', 'deny']);
    });
  });
});
