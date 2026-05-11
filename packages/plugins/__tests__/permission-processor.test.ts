import { describe, it, expect } from 'vitest';
import type { PipelineContext } from '@agentforge/sdk';
import { createPermissionProcessor, type PermissionRule } from '../src/permission/index.js';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

function isAbort(result: PipelineContext | { type: 'abort'; reason: string }): result is { type: 'abort'; reason: string } {
  return 'type' in result && result.type === 'abort';
}

describe('PermissionProcessor', () => {
  describe('full-auto mode', () => {
    it('allows all tool calls to pass through', async () => {
      const rules: PermissionRule[] = [];
      const processor = createPermissionProcessor({ mode: 'full-auto', rules });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'shell_exec', args: { command: 'rm -rf /' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(false);
    });
  });

  describe('plan-only mode', () => {
    it('denies write tool calls with correct reason', async () => {
      const rules: PermissionRule[] = [{
        tool: 'file_write',
        action: 'deny',
      }];
      const processor = createPermissionProcessor({ mode: 'plan-only', rules });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_write', args: { path: '/etc/hosts', content: 'malicious' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('file_write');
      }
    });

    it('allows read-only tool calls in plan-only mode', async () => {
      const rules: PermissionRule[] = [{
        tool: 'file_read',
        action: 'allow',
      }];
      const processor = createPermissionProcessor({ mode: 'plan-only', rules });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_read', args: { path: '/etc/hosts' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(false);
    });

    it('denies shell_exec in plan-only mode even without explicit rules', async () => {
      const rules: PermissionRule[] = [];
      const processor = createPermissionProcessor({ mode: 'plan-only', rules });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'shell_exec', args: { command: 'ls' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('shell_exec');
      }
    });
  });

  describe('glob pattern matching', () => {
    it('matches tool names with glob patterns', async () => {
      const rules: PermissionRule[] = [
        { tool: 'file_*', action: 'deny' },
        { tool: 'file_read', action: 'allow' },
      ];
      const processor = createPermissionProcessor({ mode: 'plan-only', rules });

      // "file_read" matches "file_*" first (first-match-wins), so it's denied
      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_read', args: { path: '/etc/hosts' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('file_read');
      }
    });

    it('matches argument paths using pattern glob', async () => {
      const rules: PermissionRule[] = [
        { tool: 'file_read', action: 'deny', pattern: '/etc/*' },
        { tool: 'file_read', action: 'allow' },
      ];
      const processor = createPermissionProcessor({ mode: 'interactive', rules });

      // Reading /etc/passwd should hit the deny rule first (pattern matches)
      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_read', args: { path: '/etc/passwd' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(true);
    });

    it('allows tool call when pattern does not match', async () => {
      const rules: PermissionRule[] = [
        { tool: 'file_read', action: 'deny', pattern: '/etc/*' },
        { tool: 'file_read', action: 'allow' },
      ];
      const processor = createPermissionProcessor({ mode: 'interactive', rules });

      // Reading /home/user/doc.txt — pattern doesn't match, skip to allow rule
      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_read', args: { path: '/home/user/doc.txt' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(false);
    });

    it('first-match-wins: earlier rule takes precedence', async () => {
      const rules: PermissionRule[] = [
        { tool: 'file_write', action: 'allow' },
        { tool: 'file_write', action: 'deny' },
      ];
      const processor = createPermissionProcessor({ mode: 'plan-only', rules });

      // First rule says allow — should pass even though second rule says deny
      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_write', args: { path: '/tmp/test' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(false);
    });
  });

  describe('interactive mode', () => {
    it('allows tool calls that match an allow rule', async () => {
      const rules: PermissionRule[] = [
        { tool: 'file_read', action: 'allow' },
      ];
      const processor = createPermissionProcessor({ mode: 'interactive', rules });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_read', args: { path: '/tmp/data.txt' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(false);
    });

    it('denies tool calls that match a deny rule', async () => {
      const rules: PermissionRule[] = [
        { tool: 'shell_exec', action: 'deny' },
      ];
      const processor = createPermissionProcessor({ mode: 'interactive', rules });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'shell_exec', args: { command: 'rm -rf /' } } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('shell_exec');
      }
    });

    it('suspends for approval on ask rule', async () => {
      const rules: PermissionRule[] = [
        { tool: 'file_write', action: 'ask' },
      ];
      const processor = createPermissionProcessor({ mode: 'interactive', rules });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_write', args: { path: '/tmp/test' } } },
      });

      const result = await processor.execute(ctx);

      // In interactive mode with 'ask', the processor should return an abort
      // signal indicating that human approval is required
      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('requires approval');
      }
    });

    it('allows tool calls with no matching rules in interactive mode', async () => {
      const rules: PermissionRule[] = [];
      const processor = createPermissionProcessor({ mode: 'interactive', rules });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'any_tool', args: {} } },
      });

      const result = await processor.execute(ctx);

      expect(isAbort(result)).toBe(false);
    });
  });

  describe('audit events', () => {
    it('emits permission.decision event on allow', async () => {
      const decisions: Array<{ decision: string; toolName: string; rule?: string; mode: string }> = [];
      const rules: PermissionRule[] = [
        { tool: 'file_read', action: 'allow' },
      ];
      const processor = createPermissionProcessor({
        mode: 'plan-only',
        rules,
        onDecision: (event) => decisions.push(event),
      });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_read', args: { path: '/tmp/data' } } },
      });

      await processor.execute(ctx);

      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision).toBe('allow');
      expect(decisions[0].toolName).toBe('file_read');
      expect(decisions[0].rule).toBe('file_read');
      expect(decisions[0].mode).toBe('plan-only');
    });

    it('emits permission.decision event on deny', async () => {
      const decisions: Array<{ decision: string; toolName: string; rule?: string; mode: string }> = [];
      const rules: PermissionRule[] = [
        { tool: 'shell_exec', action: 'deny' },
      ];
      const processor = createPermissionProcessor({
        mode: 'interactive',
        rules,
        onDecision: (event) => decisions.push(event),
      });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'shell_exec', args: { command: 'ls' } } },
      });

      await processor.execute(ctx);

      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision).toBe('deny');
      expect(decisions[0].toolName).toBe('shell_exec');
    });

    it('emits permission.decision event on ask (suspended)', async () => {
      const decisions: Array<{ decision: string; toolName: string; rule?: string; mode: string }> = [];
      const rules: PermissionRule[] = [
        { tool: 'file_write', action: 'ask' },
      ];
      const processor = createPermissionProcessor({
        mode: 'interactive',
        rules,
        onDecision: (event) => decisions.push(event),
      });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'file_write', args: { path: '/tmp/test' } } },
      });

      await processor.execute(ctx);

      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision).toBe('ask');
    });

    it('emits permission.decision event on default deny (dangerous tool in plan-only)', async () => {
      const decisions: Array<{ decision: string; toolName: string; rule?: string; mode: string }> = [];
      const rules: PermissionRule[] = [];
      const processor = createPermissionProcessor({
        mode: 'plan-only',
        rules,
        onDecision: (event) => decisions.push(event),
      });

      const ctx = makeContext({
        iteration: { step: 0, currentToolCall: { name: 'shell_exec', args: { command: 'ls' } } },
      });

      await processor.execute(ctx);

      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision).toBe('deny');
      expect(decisions[0].rule).toBeUndefined(); // No explicit rule — default deny
    });
  });
});
