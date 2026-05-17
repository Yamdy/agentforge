import type { ProviderCapabilities } from '@primo-ai/sdk';

const DEFAULT: ProviderCapabilities = {
  supportsReasoning: false,
  supportsToolCalling: true,
  supportsParallelToolCalls: false,
  requiresAlternatingRoles: false,
  rejectsEmptyAssistantContent: false,
};

const KNOWN: Record<string, ProviderCapabilities> = {
  deepseek: {
    supportsReasoning: true,
    supportsToolCalling: true,
    supportsParallelToolCalls: true,
    requiresAlternatingRoles: false,
    rejectsEmptyAssistantContent: false,
  },
  anthropic: {
    supportsReasoning: true,
    supportsToolCalling: true,
    supportsParallelToolCalls: true,
    requiresAlternatingRoles: true,
    rejectsEmptyAssistantContent: true,
    toolCallIdPattern: /^[a-zA-Z0-9_-]+$/,
  },
  openai: {
    supportsReasoning: false,
    supportsToolCalling: true,
    supportsParallelToolCalls: true,
    requiresAlternatingRoles: false,
    rejectsEmptyAssistantContent: false,
  },
  google: {
    supportsReasoning: false,
    supportsToolCalling: true,
    supportsParallelToolCalls: true,
    requiresAlternatingRoles: false,
    rejectsEmptyAssistantContent: false,
  },
};

export function detectProvider(modelString: string): string {
  const idx = modelString.indexOf('/');
  return idx > 0 ? modelString.slice(0, idx) : '';
}

export function detectCapabilities(modelString: string): ProviderCapabilities {
  const provider = detectProvider(modelString);
  return KNOWN[provider] ?? { ...DEFAULT };
}
