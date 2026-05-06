/**
 * Unit tests for correlation-context.ts — AsyncLocalStorage-based context propagation.
 *
 * Tests: runWithCorrelation, runWithCorrelationSync, getCorrelationContext, setCorrelationField.
 * Uses the real AsyncLocalStorage (native in Node.js test environment).
 */

import { describe, it, expect } from 'vitest';
import {
  runWithCorrelation,
  runWithCorrelationSync,
  getCorrelationContext,
  setCorrelationField,
} from '../../src/observability/correlation/correlation-context.js';
import type { CorrelationContext } from '../../src/observability/correlation/correlation-context.js';

// ============================================================
// Helper
// ============================================================

function makeCtx(overrides?: Partial<CorrelationContext>): CorrelationContext {
  return {
    sessionId: 'test-session',
    ...overrides,
  };
}

// ============================================================
// getCorrelationContext — outside any scope
// ============================================================

describe('getCorrelationContext', () => {
  it('returns undefined when called outside any correlation scope', () => {
    expect(getCorrelationContext()).toBeUndefined();
  });
});

// ============================================================
// runWithCorrelation
// ============================================================

describe('runWithCorrelation', () => {
  it('makes context available inside the async callback', async () => {
    const ctx = makeCtx({ userId: 'user-1' });

    await runWithCorrelation(ctx, async () => {
      const current = getCorrelationContext();
      expect(current).toBeDefined();
      expect(current!.sessionId).toBe('test-session');
      expect(current!.userId).toBe('user-1');
    });
  });

  it('context survives await inside the callback', async () => {
    const ctx = makeCtx();

    await runWithCorrelation(ctx, async () => {
      await Promise.resolve(); // yield the microtask queue
      const current = getCorrelationContext();
      expect(current).toBeDefined();
      expect(current!.sessionId).toBe('test-session');
    });
  });

  it('context is NOT available after callback completes', async () => {
    const ctx = makeCtx();

    await runWithCorrelation(ctx, async () => {
      // context is available here
    });

    expect(getCorrelationContext()).toBeUndefined();
  });

  it('returns the callback return value', async () => {
    const result = await runWithCorrelation(makeCtx(), async () => 42);
    expect(result).toBe(42);
  });

  it('error thrown inside callback does not leak context', async () => {
    const ctx = makeCtx();

    await runWithCorrelation(ctx, async () => {
      throw new Error('test error');
    }).catch(() => {
      // expected
    });

    expect(getCorrelationContext()).toBeUndefined();
  });

  it('nested runWithCorrelation — innermost context takes precedence', async () => {
    const outer = makeCtx({ userId: 'outer-user' });
    const inner = makeCtx({ userId: 'inner-user' });

    await runWithCorrelation(outer, async () => {
      expect(getCorrelationContext()!.userId).toBe('outer-user');

      await runWithCorrelation(inner, async () => {
        expect(getCorrelationContext()!.userId).toBe('inner-user');
      });

      expect(getCorrelationContext()!.userId).toBe('outer-user');
    });
  });
});

// ============================================================
// runWithCorrelationSync
// ============================================================

describe('runWithCorrelationSync', () => {
  it('makes context available inside the sync callback', () => {
    const ctx = makeCtx({ environment: 'production' });

    const result = runWithCorrelationSync(ctx, () => {
      const current = getCorrelationContext();
      expect(current!.environment).toBe('production');
      return 'done';
    });

    expect(result).toBe('done');
  });

  it('context is NOT available after sync callback returns', () => {
    runWithCorrelationSync(makeCtx(), () => {
      // context available
    });

    expect(getCorrelationContext()).toBeUndefined();
  });
});

// ============================================================
// setCorrelationField
// ============================================================

describe('setCorrelationField', () => {
  it('modifies a field on current correlation context', async () => {
    const ctx = makeCtx();

    await runWithCorrelation(ctx, async () => {
      expect(getCorrelationContext()!.userId).toBeUndefined();
      setCorrelationField('userId', 'new-user');
      expect(getCorrelationContext()!.userId).toBe('new-user');
    });
  });

  it('no-ops (does not throw) when called outside any context', () => {
    expect(() => setCorrelationField('userId', 'value')).not.toThrow();
  });
});
