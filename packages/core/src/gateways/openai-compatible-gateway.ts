import type { ModelGateway, GatewayConfig } from '@agentforge/sdk';
import { parseModel } from '../parse-model.js';

export class OpenAICompatibleGateway implements ModelGateway {
  readonly name: string;
  private readonly url: string;
  private readonly apiKey?: string;

  constructor(config: GatewayConfig) {
    this.name = config.name;
    this.url = config.url;
    this.apiKey = config.apiKey;
  }

  canResolve(modelString: string): boolean {
    const { provider } = parseModel(modelString);
    return provider === this.name;
  }

  async resolve(modelString: string): Promise<unknown> {
    const { modelId } = parseModel(modelString);
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    const sdk = createOpenAICompatible({
      name: this.name,
      baseURL: this.url,
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
    });
    return sdk.chatModel(modelId);
  }
}
