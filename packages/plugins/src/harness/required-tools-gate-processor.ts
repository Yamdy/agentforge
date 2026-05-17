import type { Processor, PipelineContext, ProcessorResult } from '@primo-ai/sdk';

/**
 * Creates a processor that gates the pipeline on the presence of required tools.
 *
 * Registered on the `processInput` stage, this processor checks that every
 * tool name in the `tools` list appears in `context.agent.toolDeclarations`.
 * If any are missing, the pipeline is aborted with a descriptive error
 * listing all absent tool names.
 *
 * @param tools - Array of tool names that must be present.
 * @returns A Processor that performs the check.
 */
export function createRequiredToolsGate(tools: string[]): Processor {
  return {
    stage: 'processInput',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      // Empty required-tools list always passes
      if (tools.length === 0) return ctx;

      const available = new Set(ctx.agent.toolDeclarations.map((t) => t.name));
      const missing = tools.filter((name) => !available.has(name));

      if (missing.length === 0) return ctx;

      return {
        type: 'abort',
        reason: `Required tools missing: ${missing.join(', ')}`,
      };
    },
  };
}
