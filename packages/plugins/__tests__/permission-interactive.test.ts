import { describe, it, expect, vi } from 'vitest';
import type { PipelineContext } from '@primo-ai/sdk';
import { createPermissionProcessor, type PermissionRule } from '../src/permission/index.js';
import type { PermissionManager } from '@primo-ai/core';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

function isAbort(result: PipelineContext | { type: string; reason: string }): result is { type: 'abort'; reason: string } {
  return 'type' in result && result.type === 'abort';
}

function isSuspend(result: PipelineContext | { type: string; reason: string }): result is { type: 'suspend'; suspensionId: string; reason: string } {
  return 'type' in result && result.type === 'suspend';
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
      const resultPromise = processor.execute(ctx);

      // Should not be resolved yet
      expect(resultPromise).toBeInstanceOf(Promise);

      // Now resolve with true (approve)
      resolveDecision(true);

      const result = await resultPromise;

      // Should return ctx (allow execution)
      expect(isAbort(result)).toBe(false);
      expect(isSuspend(result)).toBe(false);

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

      const resultPromise = processor.execute(ctx);

      // Deny the permission
      resolveDecision(false);

      const result = await resultPromise;

      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('file_write');
        expect(result.reason).toContain('denied');
      }

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

      const result = await processor.execute(ctx);

      // Should return suspend signal (current behavior)
      expect(isSuspend(result)).toBe(true);
      if (isSuspend(result)) {
        expect(result.reason).toContain('requires approval');
      }
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

      const result = await processor.execute(ctx);

      // full-auto mode: allow everything, permissionManager should never be called
      expect(isAbort(result)).toBe(false);
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

      const promise1 = processor.execute(ctx1);
      // Resolve first
      pendingResolvers[0](true);
      const result1 = await promise1;

      expect(isAbort(result1)).toBe(false);

      // Second call — file_write again
      const ctx2 = makeContext({
        iteration: { step: 1, pendingToolCalls: [{ id: 'call_2', name: 'file_write', args: { path: '/tmp/b' } }] },
      });

      const promise2 = processor.execute(ctx2);
      pendingResolvers[1](false);
      const result2 = await promise2;

      expect(isAbort(result2)).toBe(true);

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
