import type { HarnessAPI, PluginRegistration } from '@agentforge/sdk';
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

export function compressionPlugin(options: CompressionPluginOptions): (api: HarnessAPI) => PluginRegistration {
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
