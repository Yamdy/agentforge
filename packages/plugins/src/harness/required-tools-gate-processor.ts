import type { Processor, ProcessorContext, PipelineContext } from '@primo-ai/sdk';

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
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      if (tools.length === 0) return;

      const available = new Set(ctx.agent.toolDeclarations.map((t) => t.name));
      const missing = tools.filter((name) => !available.has(name));

      if (missing.length === 0) return;

      pCtx.control.abort(`Required tools missing: ${missing.join(', ')}`);
    },
  };
}
