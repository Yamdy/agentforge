import type {
  CompressionStrategy,
  ContextBudget,
  Message,
  ModelProfile,
  PipelineContext,
  Processor,
  TokenCounter,
} from '@agentforge/sdk';
import type { ToolRegistry } from './tool-registry.js';
import { TiktokenCounter } from './token-counter.js';

export interface ContextBuilderOptions {
  registry: ToolRegistry;
  tokenCounter?: TokenCounter;
  compressionStrategy?: CompressionStrategy;
  profiles?: ModelProfile[];
  budget?: ContextBudget;
}

const DEFAULT_BUDGET: ContextBudget = { maxTokens: 128_000 };

function slidingWindow(messages: Message[], _tc: TokenCounter, _budget: number): Message[] {
  return messages.length > 50 ? messages.slice(-50) : messages;
}

export class ContextBuilder {
  private readonly registry: ToolRegistry;
  private readonly tokenCounter: TokenCounter;
  private compressionStrategy: CompressionStrategy;
  private profiles: ModelProfile[];
  private budget: ContextBudget;

  constructor(options: ContextBuilderOptions) {
    this.registry = options.registry;
    this.tokenCounter = options.tokenCounter ?? new TiktokenCounter();
    this.compressionStrategy = options.compressionStrategy ?? slidingWindow;
    this.profiles = options.profiles ?? [];
    this.budget = options.budget ?? DEFAULT_BUDGET;
  }

  setCompressionStrategy(strategy: CompressionStrategy): void {
    this.compressionStrategy = strategy;
  }

  setProfiles(profiles: ModelProfile[]): void {
    this.profiles = profiles;
  }

  setBudget(budget: ContextBudget): void {
    this.budget = budget;
  }

  async assemble(ctx: PipelineContext): Promise<PipelineContext> {
    const model = ctx.agent.config.model;
    const profile = this.matchProfile(model);

    ctx = this.resolveSystemPrompt(ctx, profile);
    ctx = this.resolveToolDeclarations(ctx, profile);
    ctx = await this.trimHistory(ctx, model);

    return ctx;
  }

  createProcessor(): Processor {
    return {
      stage: 'buildContext',
      execute: (ctx) => this.assemble(ctx),
    };
  }

  private resolveSystemPrompt(ctx: PipelineContext, profile?: ModelProfile): PipelineContext {
    const parts: string[] = [];

    if (ctx.agent.config.systemPrompt) {
      parts.push(ctx.agent.config.systemPrompt as string);
    }

    const extraFragments = profile?.extraPromptFragments?.map((f) => f.content) ?? [];
    const promptFragments = [...ctx.agent.promptFragments, ...extraFragments];

    if (promptFragments.length > 0) {
      parts.push(...promptFragments);
    }

    if (profile?.systemPromptSuffix) {
      parts.push(profile.systemPromptSuffix);
    }

    const systemPrompt = parts.length > 0 ? parts.join('\n\n') : undefined;

    return {
      ...ctx,
      agent: {
        ...ctx.agent,
        systemPrompt,
        promptFragments,
      },
    };
  }

  private resolveToolDeclarations(ctx: PipelineContext, profile?: ModelProfile): PipelineContext {
    const overrides = profile?.toolOverrides ?? {};
    const toolDeclarations = this.registry.getAll().map((t) => ({
      name: t.name,
      description: t.description,
    })).filter((tool) => {
      const override = overrides[tool.name];
      return !override?.exclude;
    }).map((tool) => {
      const override = overrides[tool.name];
      if (override?.description) {
        return { ...tool, description: override.description };
      }
      return tool;
    });

    return {
      ...ctx,
      agent: {
        ...ctx.agent,
        toolDeclarations,
        providerOptions: ctx.agent.config.providerOptions,
      },
    };
  }

  private async trimHistory(ctx: PipelineContext, model?: string): Promise<PipelineContext> {
    const history = ctx.session.messageHistory;
    if (!history || history.length === 0) return ctx;

    const systemTokens = ctx.agent.systemPrompt
      ? this.tokenCounter.count(ctx.agent.systemPrompt, model)
      : 0;

    const toolTokens = this.countToolDeclarations(ctx.agent.toolDeclarations, model);

    const reservedSystem = this.budget.reservedForSystem ?? 0;
    const reservedTools = this.budget.reservedForTools ?? 0;
    const overhead = Math.max(systemTokens, reservedSystem) + Math.max(toolTokens, reservedTools);

    const historyBudget = this.budget.maxTokens - overhead;

    const historyTokens = this.tokenCounter.countMessages(history, model);

    if (historyTokens <= historyBudget) return ctx;

    const compressed = await this.compressionStrategy(history, this.tokenCounter, historyBudget);

    return {
      ...ctx,
      session: { ...ctx.session, messageHistory: compressed },
    };
  }

  private countToolDeclarations(declarations: Array<{ name: string; description: string }>, model?: string): number {
    if (declarations.length === 0) return 0;
    const text = declarations.map((d) => `${d.name}: ${d.description}`).join('\n');
    return this.tokenCounter.count(text, model);
  }

  private matchProfile(model: string): ModelProfile | undefined {
    for (const profile of this.profiles) {
      if (profile.modelPattern instanceof RegExp) {
        if (profile.modelPattern.test(model)) return profile;
      } else {
        if (model.includes(profile.modelPattern)) return profile;
      }
    }
    return undefined;
  }
}
