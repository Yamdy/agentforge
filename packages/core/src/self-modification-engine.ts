import type {
  SelfModificationRequest,
  SelfModificationResult,
  VerificationContext,
  FilePatch,
} from '@primo-ai/sdk';
import { ConstitutionEngine } from './constitution.js';
import { VerificationGatePipeline } from './verification-gate.js';
import { MutationBudgetEngine } from './mutation-budget.js';

export interface SelfModificationEngineContext {
  constitutionEngine: ConstitutionEngine;
  gatePipeline: VerificationGatePipeline;
  budgetEngine: MutationBudgetEngine;
}

export async function applySelfModification(
  request: SelfModificationRequest,
  context: SelfModificationEngineContext,
): Promise<SelfModificationResult> {
  const { constitutionEngine, gatePipeline, budgetEngine } = context;
  const diff = request.proposedDiff ?? [];

  // Step 1: Check risk level against constitution
  if (request.riskLevel === 'L4') {
    return {
      accepted: false,
      reason: 'L4 modifications are always rejected (constitution-level protected)',
    };
  }

  // Step 2: Quick constitutional path check before full gate pipeline
  for (const file of diff) {
    const pathCheck = constitutionEngine.checkPath(file.path);
    if (pathCheck.level === 'absolute') {
      return {
        accepted: false,
        reason: `Path "${file.path}" is absolutely protected: ${pathCheck.reason}`,
      };
    }
  }

  // Step 3: Check mutation budget
  const budgetResult = budgetEngine.tryConsume({
    files: diff.length || 1,
    linesPerFile: diff.reduce((max, f) => {
      const lines = f.content?.split('\n').length ?? 1;
      return Math.max(max, lines);
    }, 0) || 1,
  });

  if (!budgetResult.allowed) {
    return {
      accepted: false,
      reason: `Mutation budget exhausted: ${budgetResult.reason}`,
    };
  }

  // Step 4: Run verification gate pipeline (if diff present)
  if (diff.length > 0) {
    const verificationContext: VerificationContext = {
      constitution: constitutionEngine.constitution,
      snapshotId: `snap-${Date.now()}`,
      agentId: 'self-mod',
    };

    const report = await gatePipeline.execute(diff, verificationContext);

    if (report.overall === 'failed') {
      return {
        accepted: false,
        verificationReport: report,
        reason: `Verification gate failed: ${report.gates.filter(g => !g.passed).map(g => 'errors' in g ? g.errors.join(', ') : 'unknown').join('; ')}`,
      };
    }

    return {
      accepted: true,
      verificationReport: report,
      rollbackSnapshotId: verificationContext.snapshotId,
    };
  }

  // No diff — budget check only
  return {
    accepted: true,
    rollbackSnapshotId: `snap-${Date.now()}`,
  };
}
