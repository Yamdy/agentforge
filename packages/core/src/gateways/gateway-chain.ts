import type { LanguageModel } from 'ai';
import type { ModelGateway } from '@primo-ai/sdk';

export class GatewayChain {
  private gateways: ModelGateway[] = [];

  register(gateway: ModelGateway): void {
    this.gateways.push(gateway);
  }

  async resolve(modelString: string): Promise<LanguageModel> {
    for (const gw of this.gateways) {
      if (gw.canResolve(modelString)) {
        return gw.resolve(modelString) as Promise<LanguageModel>;
      }
    }
    throw new Error(
      `Unknown provider for model: "${modelString}". No gateway can resolve it. Use registerProvider() or add a custom gateway.`,
    );
  }

  get size(): number {
    return this.gateways.length;
  }

  listGateways(): Array<{ name: string; canResolve: (model: string) => boolean }> {
    return this.gateways.map(gw => ({
      name: gw.name,
      canResolve: (model: string) => gw.canResolve(model),
    }));
  }
}
