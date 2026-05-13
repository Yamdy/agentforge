import type { LanguageModel } from 'ai';
import type { ModelGateway } from '@agentforge/sdk';
import { GatewayChain } from './gateways/gateway-chain.js';

type ProviderFactory = (modelId: string) => LanguageModel;

class ProviderGateway implements ModelGateway {
  name = 'custom-providers';
  private providers: Map<string, ProviderFactory> = new Map();

  addProvider(name: string, factory: ProviderFactory): void {
    this.providers.set(name, factory);
  }

  canResolve(modelString: string): boolean {
    const idx = modelString.indexOf('/');
    if (idx < 1) return false;
    return this.providers.has(modelString.slice(0, idx));
  }

  async resolve(modelString: string): Promise<LanguageModel> {
    const idx = modelString.indexOf('/');
    const provider = modelString.slice(0, idx);
    const modelId = modelString.slice(idx + 1);
    const factory = this.providers.get(provider);
    if (!factory) throw new Error(`Unknown provider: "${provider}"`);
    return factory(modelId);
  }
}

export class ModelFactory {
  private chain = new GatewayChain();
  private providerGateway = new ProviderGateway();

  constructor() {
    this.chain.register(this.providerGateway);
  }

  async resolve(modelString: string): Promise<LanguageModel> {
    return this.chain.resolve(modelString);
  }

  registerGateway(gateway: ModelGateway): void {
    this.chain.register(gateway);
  }

  registerProvider(name: string, factory: ProviderFactory): void {
    this.providerGateway.addProvider(name, factory);
  }
}
