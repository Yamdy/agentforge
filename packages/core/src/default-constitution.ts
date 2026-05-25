import type { Constitution } from '@primo-ai/sdk';

export const DEFAULT_CONSTITUTION: Constitution = {
  version: 1,
  protectedPaths: [
    { pattern: 'packages/sdk/src/**', reason: 'SDK types are the contract layer', level: 'absolute' },
    { pattern: 'packages/core/src/constitution.ts', reason: 'Constitution must not modify itself', level: 'absolute' },
    { pattern: 'packages/core/src/verification-gate.ts', reason: 'Verification gates must not be modified by agent', level: 'absolute' },
    { pattern: 'packages/core/src/mutation-budget.ts', reason: 'Mutation budget engine must not be modified by agent', level: 'absolute' },
    { pattern: 'packages/core/src/self-modification-engine.ts', reason: 'Self-modification engine must not modify itself', level: 'absolute' },
    { pattern: 'packages/core/src/degeneration-watchdog.ts', reason: 'Watchdog must remain independent of the agent it monitors', level: 'absolute' },
    { pattern: 'packages/core/src/circuit-breaker.ts', reason: 'Circuit breaker must remain independent', level: 'absolute' },
    { pattern: 'packages/core/src/state-machine.ts', reason: 'Lifecycle state machine is infrastructure', level: 'absolute' },
    { pattern: 'packages/core/src/self-representation.ts', reason: 'Self-representation must not be tampered with', level: 'absolute' },
  ],
  diffLimits: { maxFilesPerMutation: 3, maxLinesPerFile: 100, maxMutationsPerHour: 10, maxMutationsPerDay: 50, cooldownMs: 5000 },
  immutableInterfaces: [],
  requiredCapabilities: [],
  benchmarkFiles: [],
  approvalMatrix: {
    L0: { description: 'No-op extension point', mode: 'auto' },
    L1: { description: 'Processor replacement', mode: 'auto_with_audit', auditTarget: 'eventBus', auditEvent: 'gap:optimization_complete', auditPayload: ['type', 'target'] },
    L2: { description: 'Plugin registration', mode: 'human_approval' },
    L3: { description: 'Source modification', mode: 'human_approval' },
    L4: { description: 'Constitution-level', mode: 'always_reject' },
  },
};
