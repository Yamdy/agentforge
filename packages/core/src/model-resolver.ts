import type { LanguageModel } from 'ai';
import type { GatewayConfig } from '@agentforge/sdk';
import { GatewayChain } from './gateways/gateway-chain.js';
import { BuiltInGateway, registerProvider } from './gateways/builtin-gateway.js';
import { OpenAICompatibleGateway } from './gateways/openai-compatible-gateway.js';

export { registerProvider } from './gateways/builtin-gateway.js';
export { GatewayChain, BuiltInGateway, OpenAICompatibleGateway };

export interface ParsedModel {
  provider: string;
  modelId: string;
}

export function parseModel(modelString: string): ParsedModel {
  const idx = modelString.indexOf('/');
  if (idx < 1 || idx === modelString.length - 1) {
    throw new Error(
      `Invalid model string: "${modelString}". Expected format: "provider/model-name"`,
    );
  }
  return {
    provider: modelString.slice(0, idx),
    modelId: modelString.slice(idx + 1),
  };
}

// Global default chain: BuiltInGateway is always last.
const defaultChain = new GatewayChain();
defaultChain.register(new BuiltInGateway());

/** Resolve a model string to a LanguageModel using the default gateway chain. */
export async function resolveModel(modelString: string): Promise<LanguageModel> {
  return defaultChain.resolve(modelString);
}

/** Create a gateway chain with custom gateways prepended before BuiltInGateway. */
export function createChain(configs?: GatewayConfig[]): GatewayChain {
  const chain = new GatewayChain();
  if (configs) {
    for (const cfg of configs) {
      chain.register(new OpenAICompatibleGateway(cfg));
    }
  }
  chain.register(new BuiltInGateway());
  return chain;
}
