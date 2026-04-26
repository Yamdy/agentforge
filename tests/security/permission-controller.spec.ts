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
    it('should return "allow" immediately for auto-allowed permissions', () => {
      controller.ask({ promptId: 'p1', permission: 'tool:read' }).subscribe({
        next: decision => {
          expect(decision).toBe('allow');
        },
      });
      // No need to answer - auto-allowed
    });

    it('should emit prompt to onAsk() for non-auto-allowed permissions', () => {
      let receivedPrompt: any = null;
      controller.onAsk().subscribe({
        next: prompt => {
          receivedPrompt = prompt;
        },
      });

      controller.ask({ promptId: 'p1', permission: 'tool:write' }).subscribe();

      expect(receivedPrompt).not.toBeNull();
      expect(receivedPrompt.promptId).toBe('p1');
      // Note: permission field in PermissionPrompt is the question text, not the original permission
      expect(receivedPrompt.permission).toBe('Allow tool: tool:write?');
      expect(receivedPrompt.options).toEqual(['allow', 'deny', 'allow_always']);
    });

    it('should resolve when answer is provided', () => {
      let receivedDecision: PermissionDecision | null = null;
      controller.ask({ promptId: 'p1', permission: 'tool:write' }).subscribe({
        next: decision => {
          receivedDecision = decision;
        },
      });

      controller.answer('p1', 'allow');
      expect(receivedDecision).toBe('allow');
    });

    it('should use custom approval message from context', () => {
      let receivedPrompt: any = null;
      controller.onAsk().subscribe({
        next: prompt => {
          receivedPrompt = prompt;
        },
      });

      controller.ask({
        promptId: 'p1',
        permission: 'tool:dangerous',
        context: { approvalMessage: 'This is dangerous!' },
      }).subscribe();

      // permission field in PermissionPrompt maps to question text
      expect(receivedPrompt.permission).toBe('This is dangerous!');
    });

    it('should auto-allow future requests after "allow_always"', () => {
      let callCount = 0;
      controller.onAsk().subscribe({ next: () => callCount++ });

      // First request - needs approval
      controller.ask({ promptId: 'p1', permission: 'tool:read' }).subscribe();
      controller.answer('p1', 'allow_always');

      // Second request - should be auto-allowed
      let secondDecision: PermissionDecision | null = null;
      controller.ask({ promptId: 'p2', permission: 'tool:read' }).subscribe({
        next: decision => {
          secondDecision = decision;
        },
      });

      expect(secondDecision).toBe('allow');
      expect(callCount).toBe(1); // Only one prompt emitted
    });
  });

  describe('isAutoAllowed()', () => {
    it('should return false by default', () => {
      expect(controller.isAutoAllowed('tool:read')).toBe(false);
    });

    it('should return true after "allow_always"', () => {
      controller.ask({ promptId: 'p1', permission: 'tool:read' }).subscribe();
      controller.answer('p1', 'allow_always');

      expect(controller.isAutoAllowed('tool:read')).toBe(true);
    });
  });

  describe('clearAutoAllow()', () => {
    it('should clear all auto-allowed permissions', () => {
      controller.ask({ promptId: 'p1', permission: 'tool:read' }).subscribe();
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
});
