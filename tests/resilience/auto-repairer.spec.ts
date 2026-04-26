/**
 * Unit tests for src/resilience/auto-repairer.ts
 *
 * Tests auto-repair functionality:
 * - Register repair strategies
 * - Attempt repair on matching errors
 * - Handle no matching strategy
 */

import { describe, it, expect } from 'vitest';
import { DefaultAutoRepairer } from '../../src/resilience/auto-repairer.js';
import type { SerializedError } from '../../src/core/events.js';

function makeError(name: string, message: string): SerializedError {
  return { name, message };
}

describe('DefaultAutoRepairer', () => {
  // ============================================================
  // Strategy registration
  // ============================================================

  describe('strategy registration', () => {
    it('should register a repair strategy', () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/timeout/i, async () => true);
      // No throw means registration succeeded
    });

    it('should register multiple strategies', () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/timeout/i, async () => true);
      repairer.registerStrategy(/rate.limit/i, async () => true);
      repairer.registerStrategy(/validation/i, async () => false);
      // No throw means registration succeeded
    });
  });

  // ============================================================
  // Repair attempts
  // ============================================================

  describe('repair attempts', () => {
    it('should attempt repair with matching strategy', async () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/timeout/i, async () => true);

      const result = await repairer.attemptRepair(makeError('TimeoutError', 'Request timed out'));
      expect(result.success).toBe(true);
      expect(result.retryCount).toBe(1);
    });

    it('should return failure when handler returns false', async () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/timeout/i, async () => false);

      const result = await repairer.attemptRepair(makeError('TimeoutError', 'Request timed out'));
      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(1);
    });

    it('should return failure when no strategy matches', async () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/timeout/i, async () => true);

      const result = await repairer.attemptRepair(makeError('UnknownError', 'Something else'));
      expect(result.success).toBe(false);
      expect(result.description).toContain('No matching');
    });

    it('should use first matching strategy', async () => {
      const repairer = new DefaultAutoRepairer();
      let firstCalled = false;
      let secondCalled = false;

      repairer.registerStrategy(/error/i, async () => {
        firstCalled = true;
        return true;
      });
      repairer.registerStrategy(/error/i, async () => {
        secondCalled = true;
        return true;
      });

      await repairer.attemptRepair(makeError('Error', 'test error'));
      expect(firstCalled).toBe(true);
      expect(secondCalled).toBe(false);
    });

    it('should handle handler throwing an error', async () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/timeout/i, async () => {
        throw new Error('Repair failed');
      });

      const result = await repairer.attemptRepair(makeError('TimeoutError', 'Request timed out'));
      expect(result.success).toBe(false);
      expect(result.description).toContain('failed');
    });
  });

  // ============================================================
  // Description
  // ============================================================

  describe('description', () => {
    it('should include pattern in success description', async () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/timeout/i, async () => true);

      const result = await repairer.attemptRepair(makeError('TimeoutError', 'Request timed out'));
      expect(result.description).toBeTruthy();
      expect(result.description.length).toBeGreaterThan(0);
    });

    it('should include error info in failure description', async () => {
      const repairer = new DefaultAutoRepairer();

      const result = await repairer.attemptRepair(makeError('TestError', 'test message'));
      expect(result.description).toContain('No matching');
    });
  });

  // ============================================================
  // Multiple strategies with different patterns
  // ============================================================

  describe('pattern matching', () => {
    it('should match on error name', async () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/^TimeoutError$/, async () => true);

      const result = await repairer.attemptRepair(makeError('TimeoutError', 'timed out'));
      expect(result.success).toBe(true);
    });

    it('should match on error message', async () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/rate.limit/i, async () => true);

      const result = await repairer.attemptRepair(makeError('APIError', 'Rate limit exceeded'));
      expect(result.success).toBe(true);
    });

    it('should not match partial name without proper pattern', async () => {
      const repairer = new DefaultAutoRepairer();
      repairer.registerStrategy(/^Timeout$/, async () => true);

      const result = await repairer.attemptRepair(makeError('TimeoutError', 'timed out'));
      expect(result.success).toBe(false);
    });
  });
});
