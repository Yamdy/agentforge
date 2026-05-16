import type { LanguageModel } from 'ai';
import type { GatewayConfig } from '@agentforge/sdk';
import { GatewayChain } from './gateways/gateway-chain.js';
import { BuiltInGateway, getDefaultBuiltInGateway } from './gateways/builtin-gateway.js';
import { OpenAICompatibleGateway } from './gateways/openai-compatible-gateway.js';

export { registerProvider } from './gateways/builtin-gateway.js';
export { GatewayChain, BuiltInGateway, OpenAICompatibleGateway };
export { parseModel, type ParsedModel } from './parse-model.js';

// Global default chain: uses the singleton BuiltInGateway so registerProvider() works.
const defaultChain = new GatewayChain();
defaultChain.register(getDefaultBuiltInGateway());

/**
 * Resolve a model string to a LanguageModel using the default gateway chain.
 * @deprecated Use `ModelFactory` instead for injectable, instance-based resolution.
 */
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
  chain.register(getDefaultBuiltInGateway());
  return chain;
}
