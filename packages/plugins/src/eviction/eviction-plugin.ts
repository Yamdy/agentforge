import type { HarnessAPI, PluginRegistration, EvictionStorage, ToolWrapContext } from '@agentforge/sdk';

export interface EvictionPluginOptions {
  maxSize: number;
  storage: EvictionStorage;
  previewLength?: number;
}

export function evictionPlugin(options: EvictionPluginOptions): (api: HarnessAPI) => PluginRegistration {
  const { maxSize, storage, previewLength = 500 } = options;

  return (api: HarnessAPI): PluginRegistration => {
    api.registerHook({
      point: 'tool.wrap',
      handler: async (data: unknown) => {
        const ctx = data as ToolWrapContext;
        if (ctx.result === null || ctx.result === undefined) return undefined;

        const serialized = typeof ctx.result === 'string'
          ? ctx.result
          : safeStringify(ctx.result);

        if (!serialized || serialized.length <= maxSize) return undefined;

        const preview = serialized.slice(0, previewLength);
        const ref = await storage.store(ctx.sessionId, ctx.toolName, ctx.result);

        return {
          ...ctx,
          result: { preview, reference: ref, evicted: true as const },
        };
      },
    });

    return {};
  };
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
