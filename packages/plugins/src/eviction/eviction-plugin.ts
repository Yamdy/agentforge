import { z } from 'zod';
import type { HarnessAPI, PluginRegistration, EvictionStorage, Processor, ProcessorContext, PipelineContext } from '@primo-ai/sdk';

export interface EvictionPluginOptions {
  maxSize: number;
  storage: EvictionStorage;
  previewLength?: number;
}

const EvictionPluginOptionsSchema = z.object({
  maxSize: z.number().int().positive(),
  storage: z.unknown(),
  previewLength: z.number().int().positive().optional(),
});

export function evictionPlugin(options: EvictionPluginOptions): (api: HarnessAPI) => PluginRegistration {
  EvictionPluginOptionsSchema.parse(options);
  const { maxSize, storage, previewLength = 500 } = options;

  const processor: Processor = {
    stage: 'executeTools',
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      const results = ctx.iteration.toolResults;
      if (!results || results.length === 0) return;

      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        if (result.output === null || result.output === undefined) continue;
        if (result.output && typeof result.output === 'object' && 'evicted' in result.output) continue;

        const serialized = typeof result.output === 'string'
          ? result.output
          : safeStringify(result.output);

        if (!serialized || serialized.length <= maxSize) continue;

        const preview = serialized.slice(0, previewLength);
        const ref = await storage.store(ctx.request.sessionId, result.name, result.output);

        results[i] = {
          ...result,
          output: { preview, reference: ref, evicted: true as const },
        };
      }
    },
  };

  return (api: HarnessAPI): PluginRegistration => {
    api.registerProcessor('executeTools', processor);
    return { processors: [processor] };
  };
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
