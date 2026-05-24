import { describe, it, expect, vi } from 'vitest';
import type { Constitution, ProtectedPath, DiffLimits, ApprovalMatrix } from '@primo-ai/sdk';
import { ConstitutionEngine } from '../src/constitution.js';

const TEST_CONSTITUTION: Constitution = {
  version: 1,
  protectedPaths: [
    { pattern: 'packages/sdk/src/index.ts', reason: '规范层', level: 'absolute' },
    { pattern: 'packages/core/src/constitution.ts', reason: '宪法自身', level: 'absolute' },
    { pattern: 'packages/core/src/loop-orchestrator.ts', reason: '循环编排器', level: 'approval' },
  ],
  diffLimits: {
    maxFilesPerMutation: 3,
    maxLinesPerFile: 50,
    maxMutationsPerHour: 10,
    maxMutationsPerDay: 30,
    cooldownMs: 300000,
  },
  immutableInterfaces: [
    { module: 'packages/sdk/src/index.ts', export: 'Processor', members: ['execute'], reason: '核心接口' },
  ],
  requiredCapabilities: ['invokeLLM', 'executeTools', 'evaluateIteration'],
  benchmarkFiles: ['packages/core/__tests__/full-pipeline.test.ts'],
  approvalMatrix: {
    L0: { description: '只读', mode: 'auto' },
    L1: { description: '可逆修改', mode: 'auto_with_audit', auditTarget: 'SyncEventStore', auditEvent: 'self:mutation:auto_approved', auditPayload: ['diff', 'verificationReport'] },
    L2: { description: '不可逆修改', mode: 'human_approval' },
    L3: { description: '结构性修改', mode: 'human_approval' },
    L4: { description: '宪法级修改', mode: 'always_reject' },
  },
};

describe('ConstitutionEngine', () => {
  it('loads constitution from config object', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    expect(engine.constitution.version).toBe(1);
    expect(engine.constitution.protectedPaths.length).toBe(3);
  });

  it('rejects absolute protected path modifications', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    const result = engine.checkPath('packages/sdk/src/index.ts');
    expect(result.protected).toBe(true);
    expect(result.level).toBe('absolute');
  });

  it('allows approval-level protected path with flag', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    const result = engine.checkPath('packages/core/src/loop-orchestrator.ts');
    expect(result.protected).toBe(true);
    expect(result.level).toBe('approval');
  });

  it('allows non-protected paths', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    const result = engine.checkPath('packages/core/src/some-processor.ts');
    expect(result.protected).toBe(false);
  });

  it('checks diff limits', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    expect(engine.checkDiffLimits({ files: 2, linesPerFile: 30 })).toEqual({ withinLimits: true });
    expect(engine.checkDiffLimits({ files: 5, linesPerFile: 30 })).toEqual({ withinLimits: false, reason: 'maxFilesPerMutation' });
    expect(engine.checkDiffLimits({ files: 2, linesPerFile: 100 })).toEqual({ withinLimits: false, reason: 'maxLinesPerFile' });
  });

  it('checks immutable interfaces', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    const result = engine.checkImmutableInterface('packages/sdk/src/index.ts', 'Processor', 'execute');
    expect(result.immutable).toBe(true);
  });

  it('allows non-protected interfaces', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    const result = engine.checkImmutableInterface('packages/core/src/agent.ts', 'Agent', 'run');
    expect(result.immutable).toBe(false);
  });

  it('checks required capabilities', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    expect(engine.checkRequiredCapabilities(['invokeLLM', 'executeTools', 'evaluateIteration'])).toEqual({ satisfied: true });
    expect(engine.checkRequiredCapabilities(['invokeLLM'])).toEqual({ satisfied: false, missing: ['executeTools', 'evaluateIteration'] });
  });

  it('resolves approval mode by risk level', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    expect(engine.getApprovalMode('L0')).toBe('auto');
    expect(engine.getApprovalMode('L1')).toBe('auto_with_audit');
    expect(engine.getApprovalMode('L2')).toBe('human_approval');
    expect(engine.getApprovalMode('L3')).toBe('human_approval');
    expect(engine.getApprovalMode('L4')).toBe('always_reject');
  });

  it('uses in-memory authority — does not re-read from disk', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    const before = engine.constitution.protectedPaths.length;
    expect(engine.constitution.protectedPaths.length).toBe(before);
  });

  it('supports glob patterns in protected paths', () => {
    const constitution: Constitution = {
      ...TEST_CONSTITUTION,
      protectedPaths: [
        { pattern: 'packages/sdk/**/*.ts', reason: 'SDK层', level: 'absolute' },
      ],
    };
    const engine = new ConstitutionEngine(constitution);
    expect(engine.checkPath('packages/sdk/src/index.ts').protected).toBe(true);
    expect(engine.checkPath('packages/sdk/src/types.ts').protected).toBe(true);
    expect(engine.checkPath('packages/core/src/agent.ts').protected).toBe(false);
  });

  it('classifies risk level for a diff', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    expect(engine.classifyRisk([{ path: 'packages/sdk/src/index.ts', type: 'modified' }])).toBe('L4');
    expect(engine.classifyRisk([{ path: 'packages/core/src/loop-orchestrator.ts', type: 'modified' }])).toBe('L3');
    expect(engine.classifyRisk([{ path: 'packages/core/src/some-processor.ts', type: 'modified' }])).toBe('L1');
  });

  it('returns benchmark files list', () => {
    const engine = new ConstitutionEngine(TEST_CONSTITUTION);
    expect(engine.benchmarkFiles).toEqual(['packages/core/__tests__/full-pipeline.test.ts']);
  });
});
