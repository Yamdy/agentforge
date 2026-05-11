import type { FallbackEntry, TokenUsage } from '@agentforge/sdk';
import type { EventBus } from './event-bus.js';

export interface FallbackInvoker {
  invoke(input: {
    prompt: string;
    tools?: unknown;
  }): Promise<{ response: string; tokenUsage: TokenUsage }>;
}

export interface FallbackRunnerOptions {
  entries: FallbackEntry[];
  invokerFactory: (model: string) => FallbackInvoker;
  eventBus?: EventBus;
}

export class FallbackRunner {
  private sorted: FallbackEntry[];
  private invokerFactory: (model: string) => FallbackInvoker;
  private eventBus?: EventBus;

  constructor(options: FallbackRunnerOptions) {
    // Sort by priority ascending (0 = highest priority)
    this.sorted = [...options.entries].sort((a, b) => a.priority - b.priority);
    this.invokerFactory = options.invokerFactory;
    this.eventBus = options.eventBus;
  }

  async run(input: {
    prompt: string;
    tools?: unknown;
  }): Promise<{ response: string; tokenUsage: TokenUsage }> {
    if (this.sorted.length === 0) {
      throw new Error('No fallback entries configured');
    }

    let lastError: Error | undefined;

    for (let i = 0; i < this.sorted.length; i++) {
      const entry = this.sorted[i];
      try {
        const invoker = this.invokerFactory(entry.model);
        return await invoker.invoke(input);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Emit fallback event if there's a next entry
        if (i < this.sorted.length - 1) {
          this.eventBus?.emit('task:fallback', {
            from: entry.model,
            to: this.sorted[i + 1].model,
            error: lastError,
          });
        }
      }
    }

    throw lastError!;
  }
}
