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

/** Gate 1: Constitution check — protected paths and diff limits */
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
          errors: [`Path "${file.path}" is protected (${pathCheck.level}): ${pathCheck.reason}`],
          gate: 'constitution',
        };
      }
    }

    const limitCheck = this.engine.checkDiffLimits({ files: diff.length, linesPerFile: this.maxLines(diff) });
    if (!limitCheck.withinLimits) {
      return {
        passed: false,
        duration: Date.now() - start,
        errors: [`Diff limits exceeded: ${limitCheck.reason}`],
        gate: 'constitution',
      };
    }

    return { passed: true, duration: Date.now() - start };
  }

  private maxLines(diff: FilePatch[]): number {
    let max = 0;
    for (const file of diff) {
      if (file.content) {
        const lines = file.content.split('\n').length;
        if (lines > max) max = lines;
      }
    }
    return max;
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

// ---------------------------------------------------------------------------
// VerificationGatePipeline
// ---------------------------------------------------------------------------

export interface VerificationGatePipelineOptions {
  constitutionEngine: ConstitutionEngine;
  extraGates?: VerificationGate[];
}

export class VerificationGatePipeline {
  private gates: VerificationGate[];
  private constitutionEngine: ConstitutionEngine;

  constructor(options: VerificationGatePipelineOptions) {
    this.constitutionEngine = options.constitutionEngine;

    this.gates = [
      new ConstitutionGate(options.constitutionEngine),
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
      if (context.skipGates?.includes(gate.level)) {
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
