import type {
  PipelineContext,
  AgentConfig,
  LoopDirective,
  Message,
  TokenUsage,
} from './index.js';

/**
 * Flat wrapper for PipelineContext.
 * Provides direct access to common fields without deep nesting.
 * Wraps by reference -- no data copying.
 */
export class SimpleProcessorContext {
  constructor(private ctx: PipelineContext) {}

  // Request region (immutable)
  get input(): string { return this.ctx.request.input; }
  get sessionId(): string { return this.ctx.request.sessionId; }

  // Agent region
  get model(): string { return this.ctx.agent.config.model; }
  get systemPrompt(): string | undefined { return this.ctx.agent.systemPrompt; }
  getConfig<T = AgentConfig>(): T { return this.ctx.agent.config as T; }

  // Iteration region
  get step(): number { return this.ctx.iteration.step; }
  get response(): string | undefined { return this.ctx.iteration.response; }
  get loopDirective(): LoopDirective | undefined { return this.ctx.iteration.loopDirective; }

  // Session region
  get messages(): Message[] { return this.ctx.session.messageHistory ?? []; }
  get totalTokens(): TokenUsage | undefined { return this.ctx.session.totalTokenUsage; }

  // Plugin namespace data (type-safe access)
  getState<T = unknown>(namespace: string): T | undefined {
    return this.ctx.session.custom[namespace] as T | undefined;
  }
  setState(namespace: string, value: unknown): void {
    this.ctx.session.custom[namespace] = value;
  }

  // Raw Context access (escape hatch for advanced use)
  get raw(): PipelineContext { return this.ctx; }
}
