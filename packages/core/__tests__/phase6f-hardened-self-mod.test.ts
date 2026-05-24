import { describe, it, expect, vi } from 'vitest';
import type { Constitution, SelfModificationRequest, FilePatch, VerificationReport } from '@primo-ai/sdk';
import { ConstitutionEngine } from '../src/constitution.js';
import { VerificationGatePipeline } from '../src/verification-gate.js';
import { MutationBudgetEngine } from '../src/mutation-budget.js';
import { applySelfModification } from '../src/self-modification-engine.js';

const TEST_CONSTITUTION: Constitution = {
  version: 1,
  protectedPaths: [
    { pattern: 'packages/sdk/src/index.ts', reason: '规范层', level: 'absolute' },
  ],
  diffLimits: {
    maxFilesPerMutation: 3,
    maxLinesPerFile: 50,
    maxMutationsPerHour: 10,
    maxMutationsPerDay: 30,
    cooldownMs: 0,
  },
  immutableInterfaces: [],
  requiredCapabilities: ['invokeLLM', 'executeTools'],
  benchmarkFiles: [],
  approvalMatrix: {
    L0: { description: '只读', mode: 'auto' },
    L1: { description: '可逆修改', mode: 'auto_with_audit', auditTarget: 'SyncEventStore', auditEvent: 'self:mutation:auto_approved', auditPayload: ['diff'] },
    L2: { description: '不可逆修改', mode: 'human_approval' },
    L3: { description: '结构性修改', mode: 'human_approval' },
    L4: { description: '宪法级修改', mode: 'always_reject' },
  },
};

describe('SelfModificationEngine', () => {
  it('accepts L1 modification that passes all checks', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const budgetEngine = new MutationBudgetEngine({
      maxMutationsPerHour: 10,
      maxMutationsPerDay: 30,
      maxDiffLinesPerMutation: 50,
      maxFilesPerMutation: 3,
      cooldownMs: 0,
    });
    const gatePipeline = new VerificationGatePipeline({ constitutionEngine });

    const request: SelfModificationRequest = {
      type: 'replaceProcessor',
      target: 'evaluateIteration',
      payload: 'new code',
      riskLevel: 'L1',
      proposedDiff: [
        { path: 'packages/core/src/processors/evaluate-iteration.ts', type: 'modified', content: 'new code' },
      ],
    };

    const result = await applySelfModification(request, {
      constitutionEngine,
      gatePipeline,
      budgetEngine,
    });

    expect(result.accepted).toBe(true);
    expect(result.verificationReport).toBeDefined();
  });

  it('rejects L4 modification (absolute protected path)', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const budgetEngine = new MutationBudgetEngine({
      maxMutationsPerHour: 10,
      maxMutationsPerDay: 30,
      maxDiffLinesPerMutation: 50,
      maxFilesPerMutation: 3,
      cooldownMs: 0,
    });
    const gatePipeline = new VerificationGatePipeline({ constitutionEngine });

    const request: SelfModificationRequest = {
      type: 'modifySource',
      target: 'sdk',
      payload: 'malicious',
      riskLevel: 'L4',
      proposedDiff: [
        { path: 'packages/sdk/src/index.ts', type: 'modified', content: 'malicious' },
      ],
    };

    const result = await applySelfModification(request, {
      constitutionEngine,
      gatePipeline,
      budgetEngine,
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('protected');
  });

  it('rejects when mutation budget is exhausted', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const budgetEngine = new MutationBudgetEngine({
      maxMutationsPerHour: 0,
      maxMutationsPerDay: 30,
      maxDiffLinesPerMutation: 50,
      maxFilesPerMutation: 3,
      cooldownMs: 0,
    });
    const gatePipeline = new VerificationGatePipeline({ constitutionEngine });

    const request: SelfModificationRequest = {
      type: 'replaceProcessor',
      target: 'evaluateIteration',
      payload: 'new code',
      riskLevel: 'L1',
      proposedDiff: [],
    };

    const result = await applySelfModification(request, {
      constitutionEngine,
      gatePipeline,
      budgetEngine,
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('budget');
  });

  it('rejects when verification gate fails', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const budgetEngine = new MutationBudgetEngine({
      maxMutationsPerHour: 10,
      maxMutationsPerDay: 30,
      maxDiffLinesPerMutation: 50,
      maxFilesPerMutation: 3,
      cooldownMs: 0,
    });
    const gatePipeline = new VerificationGatePipeline({ constitutionEngine });

    const request: SelfModificationRequest = {
      type: 'replaceProcessor',
      target: 'evaluateIteration',
      payload: 'new code',
      riskLevel: 'L1',
      proposedDiff: [
        { path: 'packages/sdk/src/index.ts', type: 'modified', content: 'bad' },
      ],
    };

    const result = await applySelfModification(request, {
      constitutionEngine,
      gatePipeline,
      budgetEngine,
    });

    expect(result.accepted).toBe(false);
  });

  it('includes verification report in result', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const budgetEngine = new MutationBudgetEngine({
      maxMutationsPerHour: 10,
      maxMutationsPerDay: 30,
      maxDiffLinesPerMutation: 50,
      maxFilesPerMutation: 3,
      cooldownMs: 0,
    });
    const gatePipeline = new VerificationGatePipeline({ constitutionEngine });

    const request: SelfModificationRequest = {
      type: 'replaceProcessor',
      target: 'evaluateIteration',
      payload: 'new code',
      riskLevel: 'L1',
      proposedDiff: [
        { path: 'packages/core/src/processors/evaluate-iteration.ts', type: 'modified', content: 'new code' },
      ],
    };

    const result = await applySelfModification(request, {
      constitutionEngine,
      gatePipeline,
      budgetEngine,
    });

    expect(result.verificationReport).toBeDefined();
    expect((result.verificationReport as VerificationReport).overall).toBe('passed');
  });

  it('handles requests without proposedDiff', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const budgetEngine = new MutationBudgetEngine({
      maxMutationsPerHour: 10,
      maxMutationsPerDay: 30,
      maxDiffLinesPerMutation: 50,
      maxFilesPerMutation: 3,
      cooldownMs: 0,
    });
    const gatePipeline = new VerificationGatePipeline({ constitutionEngine });

    const request: SelfModificationRequest = {
      type: 'registerPlugin',
      target: 'memory',
      payload: {},
      riskLevel: 'L1',
    };

    const result = await applySelfModification(request, {
      constitutionEngine,
      gatePipeline,
      budgetEngine,
    });

    expect(result.accepted).toBe(true);
  });
});
