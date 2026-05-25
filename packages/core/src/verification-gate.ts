import type {
  Constitution,
  FilePatch,
  VerificationContext,
  VerificationReport,
  VerificationGate,
  GateResult,
} from '@primo-ai/sdk';
import { ConstitutionEngine } from './constitution.js';

// ---------------------------------------------------------------------------
// Built-in Gates
// ---------------------------------------------------------------------------

/** Gate 1: Constitution — protected paths only */
class ConstitutionGate implements VerificationGate {
  name = 'constitution';
  level = 1;
  timeoutMs = 1000;

  constructor(private engine: ConstitutionEngine) {}

  async execute(diff: FilePatch[], _context: VerificationContext): Promise<GateResult> {
    const start = Date.now();

    for (const file of diff) {
      const pathCheck = this.engine.checkPath(file.path);
      if (pathCheck.protected) {
        return {
          passed: false,
          duration: Date.now() - start,
          errors: [
            pathCheck.level === 'absolute'
              ? `Path "${file.path}" is absolutely protected: ${pathCheck.reason}`
              : `Path "${file.path}" requires approval: ${pathCheck.reason}`,
          ],
          gate: 'constitution',
          protectionLevel: pathCheck.level,
        };
      }
    }

    return { passed: true, duration: Date.now() - start };
  }
}

/** Gate 2: Diff Limit — file count and lines-per-file constraints */
class DiffLimitGate implements VerificationGate {
  name = 'diffLimit';
  level = 2;
  timeoutMs = 1000;

  async execute(diff: FilePatch[], context: VerificationContext): Promise<GateResult> {
    const start = Date.now();
    const engine = new ConstitutionEngine(context.constitution);

    const limitCheck = engine.checkDiffLimits({ files: diff.length, linesPerFile: maxLines(diff) });
    if (!limitCheck.withinLimits) {
      return {
        passed: false,
        duration: Date.now() - start,
        errors: [`Diff limits exceeded: ${limitCheck.reason}`],
        gate: 'diffLimit',
      };
    }

    return { passed: true, duration: Date.now() - start };
  }
}

/** Gate 3: Interface Preservation — immutable interface members must not be modified */
class InterfacePreservationGate implements VerificationGate {
  name = 'interfacePreservation';
  level = 3;
  timeoutMs = 2000;

  async execute(diff: FilePatch[], context: VerificationContext): Promise<GateResult> {
    const start = Date.now();
    const engine = new ConstitutionEngine(context.constitution);

    for (const file of diff) {
      for (const iface of context.constitution.immutableInterfaces) {
        if (file.path === iface.module) {
          for (const member of iface.members) {
            if (file.content?.includes(member)) {
              const check = engine.checkImmutableInterface(iface.module, iface.export, member);
              if (check.immutable) {
                return {
                  passed: false,
                  duration: Date.now() - start,
                  errors: [`Immutable interface violated: ${iface.export}.${member} in ${iface.module}: ${check.reason}`],
                  gate: 'interfacePreservation',
                };
              }
            }
          }
        }
      }
    }

    return { passed: true, duration: Date.now() - start };
  }
}

/** Gate 4: Syntax Check — basic structural validation of proposed changes */
class SyntaxCheckGate implements VerificationGate {
  name = 'syntaxCheck';
  level = 4;
  timeoutMs = 3000;

  async execute(diff: FilePatch[], _context: VerificationContext): Promise<GateResult> {
    const start = Date.now();

    for (const file of diff) {
      if (!file.content) continue;
      const opens = (file.content.match(/[{(\[]/g) ?? []).length;
      const closes = (file.content.match(/[})\]]/g) ?? []).length;
      if (Math.abs(opens - closes) > 2) {
        return {
          passed: false,
          duration: Date.now() - start,
          errors: [`Syntax check failed: unbalanced brackets in ${file.path} (opens=${opens}, closes=${closes})`],
          gate: 'syntaxCheck',
        };
      }
    }

    return { passed: true, duration: Date.now() - start };
  }
}

/** Gate 5: Capability check — required capabilities preserved */
class CapabilityGate implements VerificationGate {
  name = 'capability';
  level = 5;
  timeoutMs = 5000;

  private currentCapabilities?: string[];

  constructor(currentCapabilities?: string[]) {
    this.currentCapabilities = currentCapabilities;
  }

  async execute(diff: FilePatch[], context: VerificationContext): Promise<GateResult> {
    const start = Date.now();
    const engine = new ConstitutionEngine(context.constitution);

    if (this.currentCapabilities !== undefined) {
      const check = engine.checkRequiredCapabilities(this.currentCapabilities);
      if (!check.satisfied) {
        return {
          passed: false,
          duration: Date.now() - start,
          errors: [`Missing required capabilities: ${check.missing!.join(', ')}`],
          gate: 'capability',
        };
      }
    }

    return { passed: true, duration: Date.now() - start };
  }
}

function maxLines(diff: FilePatch[]): number {
  let max = 0;
  for (const file of diff) {
    if (file.content) {
      const lines = file.content.split('\n').length;
      if (lines > max) max = lines;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// VerificationGatePipeline
// ---------------------------------------------------------------------------

export interface VerificationGatePipelineOptions {
  constitutionEngine: ConstitutionEngine;
  extraGates?: VerificationGate[];
  /** Gate levels to skip (deployment-time decision, not runtime bypass). */
  skipLevels?: number[];
}

export class VerificationGatePipeline {
  private gates: VerificationGate[];
  private constitutionEngine: ConstitutionEngine;
  private skipLevels: Set<number>;

  constructor(options: VerificationGatePipelineOptions) {
    this.constitutionEngine = options.constitutionEngine;
    this.skipLevels = new Set(options.skipLevels ?? []);

    this.gates = [
      new ConstitutionGate(options.constitutionEngine),
      new DiffLimitGate(),
      new InterfacePreservationGate(),
      new SyntaxCheckGate(),
      new CapabilityGate(),
      ...(options.extraGates ?? []),
    ];

    this.gates.sort((a, b) => a.level - b.level);
  }

  async execute(
    diff: FilePatch[],
    context: VerificationContext,
    options?: { currentCapabilities?: string[] },
  ): Promise<VerificationReport> {
    const results: GateResult[] = [];

    for (const gate of this.gates) {
      if (this.skipLevels.has(gate.level)) {
        continue;
      }

      const result = await this.runGateWithTimeout(gate, diff, context, options);
      results.push(result);

      if (!result.passed) {
        return {
          timestamp: new Date().toISOString(),
          diff,
          gates: results,
          overall: 'failed',
          approvedBy: 'auto',
        };
      }
    }

    return {
      timestamp: new Date().toISOString(),
      diff,
      gates: results,
      overall: 'passed',
      approvedBy: 'auto',
    };
  }

  private async runGateWithTimeout(
    gate: VerificationGate,
    diff: FilePatch[],
    context: VerificationContext,
    options?: { currentCapabilities?: string[] },
  ): Promise<GateResult> {
    const start = Date.now();

    let gateInstance: VerificationGate = gate;
    if (gate.name === 'capability' && options?.currentCapabilities !== undefined) {
      gateInstance = new CapabilityGate(options.currentCapabilities);
    }

    try {
      const result = await Promise.race([
        gateInstance.execute(diff, context),
        new Promise<GateResult>((resolve) =>
          setTimeout(() => resolve({
            passed: false,
            duration: Date.now() - start,
            errors: [`Gate "${gate.name}" timed out after ${gate.timeoutMs}ms`],
            gate: gate.name,
          }), gate.timeoutMs),
        ),
      ]);
      return result;
    } catch (error) {
      return {
        passed: false,
        duration: Date.now() - start,
        errors: [`Gate "${gate.name}" threw: ${error instanceof Error ? error.message : String(error)}`],
        gate: gate.name,
      };
    }
  }
}
