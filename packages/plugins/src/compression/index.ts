import type { HarnessAPI, PluginRegistration } from '@agentforge/sdk';
import { z } from 'zod';
import {
  createCompressionStrategy,
  type CompressionConfig,
  type CompressionPhase,
  type SummarizeFn,
  type Message,
} from './compression-processor.js';

export type { CompressionConfig, CompressionPhase, SummarizeFn, Message };
export { createCompressionStrategy } from './compression-processor.js';

export interface CompressionPluginOptions {
  maxContextTokens: number;
  phases: CompressionPhase[];
  summarizeFn?: SummarizeFn;
}

const CompressionPluginOptionsSchema = z.object({
  maxContextTokens: z.number().int().positive(),
  phases: z.array(z.union([
    z.object({ type: z.literal('truncate'), maxTokens: z.number().int().positive() }),
    z.object({ type: z.literal('summarize'), model: z.string().min(1), maxTokens: z.number().int().positive(), summarizeFn: z.unknown().optional() }),
    z.object({ type: z.literal('prune'), keepRecent: z.number().int().positive() }),
  ])).min(1),
  summarizeFn: z.unknown().optional(),
});

export function compressionPlugin(options: CompressionPluginOptions): (api: HarnessAPI) => PluginRegistration {
  CompressionPluginOptionsSchema.parse(options);
  const config: CompressionConfig = {
    maxContextTokens: options.maxContextTokens,
    phases: options.phases,
  };

  return (api: HarnessAPI): PluginRegistration => {
    const strategy = createCompressionStrategy(config);
    api.registerCompressionStrategy(strategy);

    return { compressionStrategy: strategy };
  };
}
