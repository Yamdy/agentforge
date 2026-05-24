import { describe, it, expect, vi } from 'vitest';
import type { Constitution, FilePatch, VerificationContext, VerificationReport, GateResult } from '@primo-ai/sdk';
import { VerificationGatePipeline } from '../src/verification-gate.js';
import { ConstitutionEngine } from '../src/constitution.js';
import type { VerificationGate } from '@primo-ai/sdk';

const TEST_CONSTITUTION: Constitution = {
  version: 1,
  protectedPaths: [
    { pattern: 'packages/sdk/src/index.ts', reason: '规范层', level: 'absolute' },
    { pattern: 'packages/core/src/loop-orchestrator.ts', reason: '编排器', level: 'approval' },
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
  requiredCapabilities: ['invokeLLM', 'executeTools'],
  benchmarkFiles: ['packages/core/__tests__/full-pipeline.test.ts'],
  approvalMatrix: {
    L0: { description: '只读', mode: 'auto' },
    L1: { description: '可逆修改', mode: 'auto_with_audit', auditTarget: 'SyncEventStore', auditEvent: 'self:mutation:auto_approved', auditPayload: ['diff'] },
    L2: { description: '不可逆修改', mode: 'human_approval' },
    L3: { description: '结构性修改', mode: 'human_approval' },
    L4: { description: '宪法级修改', mode: 'always_reject' },
  },
};

function makeContext(overrides?: Partial<VerificationContext>): VerificationContext {
  return {
    constitution: TEST_CONSTITUTION,
    snapshotId: 'snap-001',
    agentId: 'agent-001',
    ...overrides,
  };
}

describe('VerificationGatePipeline', () => {
  it('runs all gates in order and passes when all pass', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const pipeline = new VerificationGatePipeline({ constitutionEngine });

    const diff: FilePatch[] = [
      { path: 'packages/core/src/some-processor.ts', type: 'modified', content: 'new code' },
    ];

    const report = await pipeline.execute(diff, makeContext());
    expect(report.overall).toBe('passed');
    expect(report.gates.length).toBeGreaterThan(0);
  });

  it('fails when constitution gate detects absolute protected path', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const pipeline = new VerificationGatePipeline({ constitutionEngine });

    const diff: FilePatch[] = [
      { path: 'packages/sdk/src/index.ts', type: 'modified', content: 'malicious' },
    ];

    const report = await pipeline.execute(diff, makeContext());
    expect(report.overall).toBe('failed');

    const constitutionGate = report.gates.find(g => !g.passed && 'gate' in g && g.gate === 'constitution');
    expect(constitutionGate).toBeDefined();
  });

  it('fails when diff exceeds file limits', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const pipeline = new VerificationGatePipeline({ constitutionEngine });

    const diff: FilePatch[] = [
      { path: 'packages/core/src/a.ts', type: 'modified' },
      { path: 'packages/core/src/b.ts', type: 'modified' },
      { path: 'packages/core/src/c.ts', type: 'modified' },
      { path: 'packages/core/src/d.ts', type: 'modified' },
    ];

    const report = await pipeline.execute(diff, makeContext());
    expect(report.overall).toBe('failed');
  });

  it('short-circuits on first gate failure', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    let secondGateRan = false;

    const pipeline = new VerificationGatePipeline({
      constitutionEngine,
      extraGates: [
        {
          name: 'always-fail',
          level: 0,
          timeoutMs: 1000,
          execute: async () => ({ passed: false as const, duration: 1, errors: ['forced failure'], gate: 'always-fail' }),
        },
        {
          name: 'never-runs',
          level: 1,
          timeoutMs: 1000,
          execute: async () => { secondGateRan = true; return { passed: true as const, duration: 1 }; },
        },
      ],
    });

    const diff: FilePatch[] = [{ path: 'packages/core/src/a.ts', type: 'modified' }];
    const report = await pipeline.execute(diff, makeContext());

    expect(report.overall).toBe('failed');
    expect(secondGateRan).toBe(false);
  });

  it('times out gates that exceed timeoutMs', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const pipeline = new VerificationGatePipeline({
      constitutionEngine,
      extraGates: [
        {
          name: 'slow-gate',
          level: 99,
          timeoutMs: 50,
          execute: async () => {
            await new Promise(r => setTimeout(r, 200));
            return { passed: true as const, duration: 200 };
          },
        },
      ],
    });

    const diff: FilePatch[] = [{ path: 'packages/core/src/a.ts', type: 'modified' }];
    const report = await pipeline.execute(diff, makeContext());

    expect(report.overall).toBe('failed');
    const timeoutGate = report.gates.find(g => 'gate' in g && g.gate === 'slow-gate');
    expect(timeoutGate).toBeDefined();
    expect(timeoutGate!.passed).toBe(false);
  });

  it('skips gates listed in skipGates', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const pipeline = new VerificationGatePipeline({ constitutionEngine });

    const diff: FilePatch[] = [{ path: 'packages/sdk/src/index.ts', type: 'modified' }];

    const report = await pipeline.execute(diff, makeContext({ skipGates: [1] }));
    expect(report.gates.some(g => 'gate' in g && g.gate === 'constitution')).toBe(false);
  });

  it('includes timestamp and diff in report', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const pipeline = new VerificationGatePipeline({ constitutionEngine });

    const diff: FilePatch[] = [{ path: 'packages/core/src/a.ts', type: 'modified' }];
    const report = await pipeline.execute(diff, makeContext());

    expect(report.timestamp).toBeDefined();
    expect(report.diff).toEqual(diff);
  });

  it('sets approvedBy to auto for L0/L1', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const pipeline = new VerificationGatePipeline({ constitutionEngine });

    const diff: FilePatch[] = [{ path: 'packages/core/src/a.ts', type: 'modified' }];
    const report = await pipeline.execute(diff, makeContext());

    expect(report.approvedBy).toBe('auto');
  });

  it('runs capability gate checking required capabilities are preserved', async () => {
    const constitutionEngine = new ConstitutionEngine(TEST_CONSTITUTION);
    const pipeline = new VerificationGatePipeline({ constitutionEngine });

    const diff: FilePatch[] = [
      { path: 'packages/core/src/processors/invoke-llm.ts', type: 'deleted' },
    ];

    const report = await pipeline.execute(diff, makeContext(), { currentCapabilities: ['executeTools'] });
    expect(report.overall).toBe('failed');
  });
});
