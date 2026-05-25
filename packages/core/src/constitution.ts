import type {
  Constitution,
  ProtectedPath,
  DiffLimits,
  ApprovalMatrix,
  FilePatch,
} from '@primo-ai/sdk';

// ---------------------------------------------------------------------------
// ConstitutionEngine — in-memory authority for self-modification boundaries
// ---------------------------------------------------------------------------

type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
type ApprovalMode = 'auto' | 'auto_with_audit' | 'human_approval' | 'always_reject';

interface PathCheckResult {
  protected: boolean;
  level?: 'absolute' | 'approval';
  reason?: string;
}

interface DiffLimitCheckResult {
  withinLimits: boolean;
  reason?: string;
}

interface InterfaceCheckResult {
  immutable: boolean;
  reason?: string;
}

interface CapabilityCheckResult {
  satisfied: boolean;
  missing?: string[];
}

export class ConstitutionEngine {
  private _constitution: Constitution;

  constructor(constitution: Constitution) {
    this._constitution = structuredClone(constitution);
  }

  get constitution(): Constitution {
    return this._constitution;
  }

  get benchmarkFiles(): string[] {
    return this._constitution.benchmarkFiles;
  }

  checkPath(filePath: string): PathCheckResult {
    for (const pp of this._constitution.protectedPaths) {
      if (this.matchPattern(pp.pattern, filePath)) {
        return { protected: true, level: pp.level, reason: pp.reason };
      }
    }
    return { protected: false };
  }

  checkDiffLimits(diff: { files: number; linesPerFile: number }): DiffLimitCheckResult {
    const limits = this._constitution.diffLimits;
    if (diff.files > limits.maxFilesPerMutation) {
      return { withinLimits: false, reason: 'maxFilesPerMutation' };
    }
    if (diff.linesPerFile > limits.maxLinesPerFile) {
      return { withinLimits: false, reason: 'maxLinesPerFile' };
    }
    return { withinLimits: true };
  }

  checkImmutableInterface(modulePath: string, exportName: string, memberName: string): InterfaceCheckResult {
    for (const iface of this._constitution.immutableInterfaces) {
      if (iface.module === modulePath && iface.export === exportName && iface.members.includes(memberName)) {
        return { immutable: true, reason: iface.reason };
      }
    }
    return { immutable: false };
  }

  checkRequiredCapabilities(currentCapabilities: string[]): CapabilityCheckResult {
    const required = this._constitution.requiredCapabilities;
    const missing = required.filter(c => !currentCapabilities.includes(c));
    if (missing.length === 0) return { satisfied: true };
    return { satisfied: false, missing };
  }

  getApprovalMode(level: RiskLevel): ApprovalMode {
    const entry = this._constitution.approvalMatrix[level];
    return entry?.mode ?? 'always_reject';
  }

  classifyRisk(diff: Array<{ path: string; type: string }>): RiskLevel {
    for (const file of diff) {
      const pathCheck = this.checkPath(file.path);
      if (pathCheck.level === 'absolute') return 'L4';
      if (pathCheck.level === 'approval') return 'L3';
    }
    return 'L1';
  }

  private matchPattern(pattern: string, filePath: string): boolean {
    if (pattern === filePath) return true;

    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*');
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(filePath);
  }
}
