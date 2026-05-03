/**
 * Permission Classifier Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  NoopPermissionClassifier,
  safeClassify,
  type PermissionClassifier,
  type PermissionClassifierContext,
} from '../../src/security/permission/classifier.js';

// ============================================================
// NoopPermissionClassifier
// ============================================================

describe('NoopPermissionClassifier', () => {
  const ctx: PermissionClassifierContext = {
    toolName: 'bash',
    toolArgs: { command: 'ls' },
    riskLevel: 'high',
    sessionId: 'sess-1',
    step: 3,
    policyDecision: 'ask',
  };

  it('should have name "noop-permission-classifier"', () => {
    const c = new NoopPermissionClassifier();
    expect(c.name).toBe('noop-permission-classifier');
  });

  it('should always return unsure', async () => {
    const c = new NoopPermissionClassifier();
    const result = await c.classify(ctx);
    expect(result.action).toBe('unsure');
  });

  it('should return low confidence', async () => {
    const c = new NoopPermissionClassifier();
    const result = await c.classify(ctx);
    expect(result.confidence).toBe('low');
  });

  it('should include tool name in reason', async () => {
    const c = new NoopPermissionClassifier();
    const result = await c.classify(ctx);
    expect(result.reason).toContain('bash');
  });
});

// ============================================================
// safeClassify
// ============================================================

describe('safeClassify', () => {
  const ctx: PermissionClassifierContext = {
    toolName: 'write_file',
    toolArgs: { path: '/tmp/test.txt' },
    riskLevel: 'medium',
    sessionId: 'sess-2',
    step: 5,
    policyDecision: 'allow',
  };

  it('should return unsure when classifier is undefined', async () => {
    const result = await safeClassify(undefined, ctx);
    expect(result.action).toBe('unsure');
    expect(result.reason).toContain('No classifier configured');
  });

  it('should return classifier result when classifier returns allow', async () => {
    const allowClassifier: PermissionClassifier = {
      name: 'test-allow',
      classify: async () => ({
        action: 'allow',
        confidence: 'high',
        reason: 'Safe operation',
      }),
    };
    const result = await safeClassify(allowClassifier, ctx);
    expect(result.action).toBe('allow');
    expect(result.confidence).toBe('high');
  });

  it('should return classifier result when classifier returns deny', async () => {
    const denyClassifier: PermissionClassifier = {
      name: 'test-deny',
      classify: async () => ({
        action: 'deny',
        confidence: 'high',
        reason: 'Dangerous operation',
      }),
    };
    const result = await safeClassify(denyClassifier, ctx);
    expect(result.action).toBe('deny');
  });

  it('should catch classifier errors and return unsure', async () => {
    const crashingClassifier: PermissionClassifier = {
      name: 'crash-test',
      classify: async () => {
        throw new Error('Classifier internal error');
      },
    };
    const result = await safeClassify(crashingClassifier, ctx);
    expect(result.action).toBe('unsure');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('Classifier internal error');
  });

  it('should include classifier name in error reason', async () => {
    const crashingClassifier: PermissionClassifier = {
      name: 'my-custom-classifier',
      classify: async () => {
        throw new Error('boom');
      },
    };
    const result = await safeClassify(crashingClassifier, ctx);
    expect(result.reason).toContain('my-custom-classifier');
  });

  it('should support synchronous classifiers', async () => {
    const syncClassifier: PermissionClassifier = {
      name: 'sync-test',
      classify: (c) => ({
        action: c.riskLevel === 'critical' ? 'deny' : 'allow',
        confidence: 'medium',
        reason: `Risk: ${c.riskLevel}`,
      }),
    };
    const highRisk = { ...ctx, riskLevel: 'critical' };
    const lowRisk = { ...ctx, riskLevel: 'low' };

    expect((await safeClassify(syncClassifier, highRisk)).action).toBe('deny');
    expect((await safeClassify(syncClassifier, lowRisk)).action).toBe('allow');
  });
});

// ============================================================
// Custom Classifier Integration
// ============================================================

describe('Custom Classifier', () => {
  it('should be implementable with session-based allowlisting', async () => {
    const allowed = new Set<string>(['read_file', 'glob', 'grep']);

    const sessionClassifier: PermissionClassifier = {
      name: 'session-allowlist',
      classify: async (c) => {
        if (allowed.has(c.toolName)) {
          return { action: 'allow', confidence: 'high', reason: 'In session allowlist' };
        }
        if (c.riskLevel === 'critical') {
          return { action: 'deny', confidence: 'high', reason: 'Critical risk denied' };
        }
        return { action: 'unsure', confidence: 'medium', reason: 'Needs human review' };
      },
    };

    const readCtx: PermissionClassifierContext = {
      toolName: 'read_file', toolArgs: {}, riskLevel: 'low', sessionId: 's', step: 1, policyDecision: 'allow',
    };
    const bashCtx: PermissionClassifierContext = {
      toolName: 'bash', toolArgs: {}, riskLevel: 'high', sessionId: 's', step: 2, policyDecision: 'ask',
    };
    const rmCtx: PermissionClassifierContext = {
      toolName: 'rm', toolArgs: {}, riskLevel: 'critical', sessionId: 's', step: 3, policyDecision: 'deny',
    };

    expect((await safeClassify(sessionClassifier, readCtx)).action).toBe('allow');
    expect((await safeClassify(sessionClassifier, bashCtx)).action).toBe('unsure');
    expect((await safeClassify(sessionClassifier, rmCtx)).action).toBe('deny');
  });
});
