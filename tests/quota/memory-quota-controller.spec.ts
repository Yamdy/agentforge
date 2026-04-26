/**
 * MemoryQuotaController Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryQuotaController } from '../../src/quota/memory-quota-controller.js';
import type { QuotaLimits } from '../../src/quota/quota-controller.js';

describe('MemoryQuotaController', () => {
  const limits: QuotaLimits = {
    maxPromptTokens: 10000,
    maxCompletionTokens: 5000,
    maxTotalCost: 10.0,
  };

  let controller: MemoryQuotaController;

  beforeEach(() => {
    controller = new MemoryQuotaController(limits);
  });

  describe('check()', () => {
    it('should allow when under limits', async () => {
      const result = await controller.check('session-1', {
        promptTokens: 1000,
        completionTokens: 0,
      });
      expect(result).toBe(true);
    });

    it('should deny when prompt tokens exceed limit', async () => {
      const result = await controller.check('session-1', {
        promptTokens: 10001,
        completionTokens: 0,
      });
      expect(result).toBe(false);
    });

    it('should deny when completion tokens exceed limit', async () => {
      const result = await controller.check('session-1', {
        promptTokens: 0,
        completionTokens: 5001,
      });
      expect(result).toBe(false);
    });

    it('should deny when cost exceeds limit', async () => {
      const result = await controller.check('session-1', {
        promptTokens: 0,
        completionTokens: 0,
        totalCost: 10.01,
      });
      expect(result).toBe(false);
    });

    it('should accumulate usage across checks', async () => {
      await controller.check('session-1', { promptTokens: 5000, completionTokens: 0 });
      controller.consume('session-1', { promptTokens: 5000, completionTokens: 0 });

      const result = await controller.check('session-1', { promptTokens: 5001, completionTokens: 0 });
      expect(result).toBe(false);
    });

    it('should track sessions independently', async () => {
      controller.consume('session-1', { promptTokens: 9000, completionTokens: 0 });

      const result = await controller.check('session-2', { promptTokens: 5000, completionTokens: 0 });
      expect(result).toBe(true);
    });
  });

  describe('consume()', () => {
    it('should accumulate prompt tokens', () => {
      controller.consume('session-1', { promptTokens: 1000, completionTokens: 0 });
      controller.consume('session-1', { promptTokens: 500, completionTokens: 0 });

      const usage = controller.getUsage('session-1');
      expect(usage.promptTokens).toBe(1500);
    });

    it('should accumulate completion tokens', () => {
      controller.consume('session-1', { promptTokens: 0, completionTokens: 300 });
      controller.consume('session-1', { promptTokens: 0, completionTokens: 200 });

      const usage = controller.getUsage('session-1');
      expect(usage.completionTokens).toBe(500);
    });

    it('should accumulate cost', () => {
      controller.consume('session-1', { promptTokens: 0, completionTokens: 0, totalCost: 1.5 });
      controller.consume('session-1', { promptTokens: 0, completionTokens: 0, totalCost: 2.5 });

      const usage = controller.getUsage('session-1');
      expect(usage.totalCost).toBe(4.0);
    });
  });

  describe('getUsage()', () => {
    it('should return zeros for unknown session', () => {
      const usage = controller.getUsage('unknown');
      expect(usage.promptTokens).toBe(0);
      expect(usage.completionTokens).toBe(0);
      expect(usage.totalCost).toBeUndefined();
    });
  });

  describe('getLimits()', () => {
    it('should return copy of limits', () => {
      const result = controller.getLimits();
      expect(result).toEqual(limits);
      expect(result).not.toBe(limits); // should be a copy
    });
  });

  describe('reset()', () => {
    it('should clear session usage', () => {
      controller.consume('session-1', { promptTokens: 1000, completionTokens: 500 });
      controller.reset('session-1');

      const usage = controller.getUsage('session-1');
      expect(usage.promptTokens).toBe(0);
      expect(usage.completionTokens).toBe(0);
    });
  });

  describe('clearAll()', () => {
    it('should clear all sessions', () => {
      controller.consume('session-1', { promptTokens: 1000, completionTokens: 0 });
      controller.consume('session-2', { promptTokens: 2000, completionTokens: 0 });
      controller.clearAll();

      expect(controller.sessionCount).toBe(0);
    });
  });

  describe('sessionCount', () => {
    it('should return 0 initially', () => {
      expect(controller.sessionCount).toBe(0);
    });

    it('should track unique sessions', () => {
      controller.consume('session-1', { promptTokens: 0, completionTokens: 0 });
      controller.consume('session-2', { promptTokens: 0, completionTokens: 0 });
      expect(controller.sessionCount).toBe(2);
    });
  });
});
