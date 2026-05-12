import type { LanguageModel } from 'ai';

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

type ProviderFactory = (modelId: string) => LanguageModel;

const customProviders = new Map<string, ProviderFactory>();

export function registerProvider(name: string, factory: ProviderFactory): void {
  customProviders.set(name, factory);
}

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

const sdkCache = new Map<string, SdkInstance>();

export async function resolveModel(modelString: string): Promise<LanguageModel> {
  const { provider, modelId } = parseModel(modelString);

  const custom = customProviders.get(provider);
  if (custom) {
    return custom(modelId);
  }

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
