import type { LanguageModel } from 'ai';
import type { ModelGateway } from '@agentforge/sdk';
import { parseModel } from '../parse-model.js';

type ProviderFactory = (modelId: string) => LanguageModel;
type SdkInstance = { languageModel: (id: string) => LanguageModel };

const PROVIDER_MAP: Record<string, () => Promise<SdkInstance>> = {
  openai: () => import('@ai-sdk/openai').then((m) => {
    const sdk = m.createOpenAI();
    return { languageModel: (id: string) => sdk(id) };
  }),
  anthropic: () => import('@ai-sdk/anthropic').then((m) => {
    const sdk = m.createAnthropic();
    return { languageModel: (id: string) => sdk(id) };
  }),
  google: () => import('@ai-sdk/google').then((m) => {
    const sdk = m.createGoogleGenerativeAI();
    return { languageModel: (id: string) => sdk(id) };
  }),
  deepseek: () => import('@ai-sdk/deepseek').then((m) => {
    const sdk = m.createDeepSeek();
    return { languageModel: (id: string) => sdk(id) };
  }),
};

const customProviders = new Map<string, ProviderFactory>();
const sdkCache = new Map<string, SdkInstance>();

/** Register a custom provider factory. Backward-compatible with old registerProvider(). */
export function registerProvider(name: string, factory: ProviderFactory): void {
  customProviders.set(name, factory);
}

export class BuiltInGateway implements ModelGateway {
  name = 'builtin';

  canResolve(modelString: string): boolean {
    const { provider } = parseModel(modelString);
    return provider in PROVIDER_MAP || customProviders.has(provider);
  }

  async resolve(modelString: string): Promise<unknown> {
    const { provider, modelId } = parseModel(modelString);

    const custom = customProviders.get(provider);
    if (custom) return custom(modelId);

    const loader = PROVIDER_MAP[provider];
    if (!loader) {
      throw new Error(
        `Unknown provider: "${provider}". Use registerProvider() or install an @ai-sdk/* package.`,
      );
    }

    let instance = sdkCache.get(provider);
    if (!instance) {
      instance = await loader();
      sdkCache.set(provider, instance);
    }

    return instance.languageModel(modelId);
  }
}
