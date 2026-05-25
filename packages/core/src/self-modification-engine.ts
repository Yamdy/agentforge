import type {
  SelfModificationRequest,
  SelfModificationResult,
  VerificationContext,
  VerificationReport,
  FilePatch,
  ApprovalMode,
  RiskLevel,
} from '@primo-ai/sdk';
import { ConstitutionEngine } from './constitution.js';
import { VerificationGatePipeline } from './verification-gate.js';
import { MutationBudgetEngine } from './mutation-budget.js';
import type { PermissionManager } from './pending-permission.js';

export interface SelfModificationEngineContext {
  constitutionEngine: ConstitutionEngine;
  gatePipeline: VerificationGatePipeline;
  budgetEngine: MutationBudgetEngine;
  permissionManager?: PermissionManager;
  eventBus?: { emit(event: string, data: unknown): void };
}

export async function applySelfModification(
  request: SelfModificationRequest,
  context: SelfModificationEngineContext,
): Promise<SelfModificationResult> {
  const { constitutionEngine, gatePipeline, budgetEngine, permissionManager, eventBus } = context;
  const diff = request.proposedDiff ?? [];

  // Step 1: L4 always rejected
  if (request.riskLevel === 'L4') {
    return {
      accepted: false,
      reason: 'L4 modifications are always rejected (constitution-level protected)',
    };
  }

  // Step 2: Absolute protected path check
  for (const file of diff) {
    const pathCheck = constitutionEngine.checkPath(file.path);
    if (pathCheck.level === 'absolute') {
      return {
        accepted: false,
        reason: `Path "${file.path}" is absolutely protected: ${pathCheck.reason}`,
      };
    }
  }

  // Step 3: Mutation budget
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

  // Step 4: Verification gate pipeline (if diff present)
  let report: VerificationReport | undefined;
  if (diff.length > 0) {
    const verificationContext: VerificationContext = {
      constitution: constitutionEngine.constitution,
      snapshotId: `snap-${Date.now()}`,
      agentId: 'self-mod',
    };

    report = await gatePipeline.execute(diff, verificationContext);

    if (report.overall === 'failed') {
      return {
        accepted: false,
        verificationReport: report,
        reason: `Verification gate failed: ${report.gates.filter(g => !g.passed).map(g => 'errors' in g ? g.errors.join(', ') : 'unknown').join('; ')}`,
      };
    }
  }

  // Step 5: Enforce approval matrix
  const approvalMode = constitutionEngine.getApprovalMode(request.riskLevel as RiskLevel);
  return await handleApproval(approvalMode, request.riskLevel as RiskLevel, report, diff, context);
}

async function handleApproval(
  mode: ApprovalMode,
  riskLevel: RiskLevel,
  report: VerificationReport | undefined,
  diff: FilePatch[],
  context: SelfModificationEngineContext,
): Promise<SelfModificationResult> {
  const { permissionManager, eventBus } = context;

  switch (mode) {
    case 'auto':
      return {
        accepted: true,
        verificationReport: report,
        rollbackSnapshotId: report ? undefined : `snap-${Date.now()}`,
      };

    case 'auto_with_audit':
      eventBus?.emit('self-modification:audit', {
        riskLevel,
        diff,
        timestamp: new Date().toISOString(),
      });
      return {
        accepted: true,
        verificationReport: report,
        rollbackSnapshotId: report ? undefined : `snap-${Date.now()}`,
      };

    case 'human_approval': {
      if (!permissionManager) {
        return {
          accepted: false,
          reason: `Risk level ${riskLevel} requires human approval, but no PermissionManager configured`,
        };
      }
      const approved = await permissionManager.awaitDecision({
        permissionId: `selfmod-${riskLevel}-${Date.now()}`,
        sessionId: 'self-mod',
        toolName: 'self_modification',
        args: { riskLevel, fileCount: diff.length, paths: diff.map(d => d.path) },
        reason: `Self-modification at ${riskLevel} requires human approval`,
        createdAt: new Date().toISOString(),
      });
      if (!approved) {
        return {
          accepted: false,
          reason: `Human denied self-modification at ${riskLevel}`,
        };
      }
      return {
        accepted: true,
        verificationReport: report,
        rollbackSnapshotId: report ? undefined : `snap-${Date.now()}`,
      };
    }

    case 'always_reject':
      return {
        accepted: false,
        reason: `Risk level ${riskLevel} is always rejected`,
      };
  }
}
