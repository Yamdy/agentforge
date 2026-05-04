/**
 * DefaultPermissionController Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DefaultPermissionController } from '../../src/security/permission/permission-controller.js';
import { DefaultApprovalChannel } from '../../src/core/approval-channel.js';
import type { PermissionDecision } from '../../src/security/permission/permission-controller.js';

describe('DefaultPermissionController', () => {
  let channel: DefaultApprovalChannel;
  let controller: DefaultPermissionController;

  beforeEach(() => {
    channel = new DefaultApprovalChannel();
    controller = new DefaultPermissionController(channel);
  });

  afterEach(() => {
    channel.destroy();
  });

  describe('ask()', () => {
    it('should return "allow" immediately for auto-allowed permissions', async () => {
      // Pre-seed auto-allow via allow_always answer
      controller.ask({ promptId: 'p0', permission: 'tool:read' });
      controller.answer('p0', 'allow_always');

      // Now tool:read is auto-allowed
      const decision = await controller.ask({ promptId: 'p1', permission: 'tool:read' });
      expect(decision).toBe('allow');
    });

    it('should emit prompt to onAsk() for non-auto-allowed permissions', () => {
      let receivedPrompt: any = null;
      controller.onAsk(prompt => {
        receivedPrompt = prompt;
      });

      controller.ask({ promptId: 'p1', permission: 'tool:write' });

      expect(receivedPrompt).not.toBeNull();
      expect(receivedPrompt.promptId).toBe('p1');
      expect(receivedPrompt.permission).toBe('Allow tool: tool:write?');
      expect(receivedPrompt.options).toEqual(['allow', 'deny', 'allow_always']);
    });

    it('should resolve when answer is provided', async () => {
      const promise = controller.ask({ promptId: 'p1', permission: 'tool:write' });
      controller.answer('p1', 'allow');
      const decision = await promise;
      expect(decision).toBe('allow');
    });

    it('should use custom approval message from context', () => {
      let receivedPrompt: any = null;
      controller.onAsk(prompt => {
        receivedPrompt = prompt;
      });

      controller.ask({
        promptId: 'p1',
        permission: 'tool:dangerous',
        context: { approvalMessage: 'This is dangerous!' },
      });

      // permission field in PermissionPrompt maps to question text
      expect(receivedPrompt.permission).toBe('This is dangerous!');
    });

    it('should auto-allow future requests after "allow_always"', async () => {
      let callCount = 0;
      controller.onAsk(() => callCount++);

      // First request - needs approval
      controller.ask({ promptId: 'p1', permission: 'tool:read' });
      controller.answer('p1', 'allow_always');

      // Second request - should be auto-allowed
      const secondDecision = await controller.ask({ promptId: 'p2', permission: 'tool:read' });

      expect(secondDecision).toBe('allow');
      expect(callCount).toBe(1); // Only one prompt emitted
    });
  });

  describe('isAutoAllowed()', () => {
    it('should return false by default', () => {
      expect(controller.isAutoAllowed('tool:read')).toBe(false);
    });

    it('should return true after "allow_always"', () => {
      controller.ask({ promptId: 'p1', permission: 'tool:read' });
      controller.answer('p1', 'allow_always');

      expect(controller.isAutoAllowed('tool:read')).toBe(true);
    });
  });

  describe('clearAutoAllow()', () => {
    it('should clear all auto-allowed permissions', () => {
      controller.ask({ promptId: 'p1', permission: 'tool:read' });
      controller.answer('p1', 'allow_always');

      expect(controller.isAutoAllowed('tool:read')).toBe(true);

      controller.clearAutoAllow();
      expect(controller.isAutoAllowed('tool:read')).toBe(false);
    });
  });

  describe('cancel()', () => {
    it('should not throw', () => {
      expect(() => controller.cancel('nonexistent')).not.toThrow();
    });
  });

  describe('concurrency', () => {
    it('should resolve all concurrent asks when answered', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        controller.ask({
          promptId: `concurrent-${i}`,
          permission: `tool.${i}`,
          context: { approvalMessage: `Allow tool ${i}?` },
        })
      );

      // Answer all concurrently
      for (let i = 0; i < 5; i++) {
        controller.answer(`concurrent-${i}`, 'allow');
      }

      const decisions = await Promise.all(promises);
      expect(decisions).toEqual(['allow', 'allow', 'allow', 'allow', 'allow']);
    });

    it('should not lose responses when answering concurrently with new asks', async () => {
      // Start all asks
      const promises = Array.from({ length: 10 }, (_, i) =>
        controller.ask({
          promptId: `mixed-${i}`,
          permission: `tool.${i}`,
          context: { approvalMessage: `Allow tool ${i}?` },
        })
      );

      // Answer them — some allow, some deny
      for (let i = 0; i < 10; i++) {
        controller.answer(`mixed-${i}`, i % 2 === 0 ? 'allow' : 'deny');
      }

      const decisions = await Promise.all(promises);
      const allowed = decisions.filter((d) => d === 'allow').length;
      const denied = decisions.filter((d) => d === 'deny').length;
      expect(allowed).toBe(5);
      expect(denied).toBe(5);
    });

    it('should auto-allow after allow_always response even when followed by concurrent asks', async () => {
      // First ask — answer with allow_always
      const firstPromise = controller.ask({
        promptId: 'first',
        permission: 'tool.read',
        context: { approvalMessage: 'Allow read?' },
      });
      controller.answer('first', 'allow_always');
      const firstDecision = await firstPromise;
      expect(firstDecision).toBe('allow_always');

      // Subsequent concurrent asks for same permission should auto-resolve
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          controller.ask({
            promptId: `auto-${i}`,
            permission: 'tool.read',
          })
        )
      );

      // All should resolve immediately as 'allow' (auto-allowed)
      expect(results).toEqual(['allow', 'allow', 'allow', 'allow', 'allow']);
    });

    it('should dispatch unique promptIds under concurrent ask', () => {
      const receivedIds: string[] = [];
      controller.onAsk((prompt) => {
        receivedIds.push(prompt.promptId);
      });

      // Fire concurrent asks
      for (let i = 0; i < 5; i++) {
        controller.ask({
          promptId: `unique-${i}`,
          permission: `tool.${i}`,
        });
      }

      expect(receivedIds).toHaveLength(5);
      expect(new Set(receivedIds).size).toBe(5); // all unique
      expect(receivedIds.sort()).toEqual([
        'unique-0', 'unique-1', 'unique-2', 'unique-3', 'unique-4',
      ]);
    });

    it('should maintain correct autoAllowSet state under concurrent allow_always resolutions', async () => {
      // Set up 3 different permission asks, all answered with allow_always concurrently
      const permissions = ['tool.a', 'tool.b', 'tool.c'];
      const promises = permissions.map((perm, i) =>
        controller.ask({
          promptId: `perm-${i}`,
          permission: perm,
          context: { approvalMessage: `Allow ${perm}?` },
        })
      );

      // Answer all with allow_always
      for (let i = 0; i < permissions.length; i++) {
        controller.answer(`perm-${i}`, 'allow_always');
      }

      await Promise.all(promises);

      // All three permissions should now be auto-allowed
      for (const perm of permissions) {
        expect(controller.isAutoAllowed(perm)).toBe(true);
      }

      // Subsequent asks for these permissions should auto-resolve
      const secondResults = await Promise.all(
        permissions.map((perm, i) =>
          controller.ask({
            promptId: `second-${i}`,
            permission: perm,
          })
        )
      );
      expect(secondResults).toEqual(['allow', 'allow', 'allow']);
    });
  });
});
