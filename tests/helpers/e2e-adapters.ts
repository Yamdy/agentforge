/**
 * Shared E2E Test Adapters and Helpers
 *
 * Provides reusable LLM adapter, tool registry, context/config factories,
 * and event-collection helpers for e2e tests against real LLM endpoints.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText, tool } from 'ai';
import { z } from 'zod';
import {
  type AgentContext,
  type AgentEvent,
  type LLMAdapter,
  type LLMResponse,
  type LLMChunk,
  type LLMOptions,
  type ToolDefinition,
  type ToolRegistry,
  type FunctionDefinition,
  type Message,
  ContextBuilder,
  generateSessionId,
} from '../../src/core/index.js';
import { InMemoryStore, DefaultPauseController, SimpleSchemaRegistry } from '../../src/core/context.js';
import {
  createAgentLoop,
  type AgentLoopConfig,
} from '../../src/loop/agent-loop.js';

// ============================================================
// API Configuration
// ============================================================

export interface E2EApiConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export function resolveApiConfig(): E2EApiConfig {
  return {
    apiKey: process.env.LLM_API_KEY ?? '',
    baseURL: process.env.LLM_BASE_URL ?? 'https://token-plan-cn.xiaomimimo.com/v1',
    model: process.env.LLM_MODEL ?? 'mimo-v2.5',
  };
}

export function shouldRunE2E(): boolean {
  return (process.env.LLM_API_KEY?.length ?? 0) > 0;
}

// ============================================================
// RealLLMAdapter — OpenAI-compatible adapter for testing
// ============================================================

export class RealLLMAdapter implements LLMAdapter {
  readonly name = 'real-llm-adapter';
  readonly provider = 'openai-compatible';

  private model: ReturnType<ReturnType<typeof createOpenAICompatible>>;

  constructor(config: E2EApiConfig) {
    const provider = createOpenAICompatible({
      name: 'openai-compatible',
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });
    this.model = provider(config.model);
  }

  private convertMessages(messages: Message[]): Array<
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | Array<{ type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }> }
    | { role: 'tool'; content: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }> }
  > {
    const result: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string | unknown[];
    }> = [];

    for (const msg of messages) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);

      if (msg.role === 'tool') {
        const toolMsg = msg as unknown as Record<string, unknown>;
        const toolCallId = (toolMsg['toolCallId'] as string) ?? '';
        const toolName = (toolMsg['name'] as string) ?? '';

        const prevMsg = result[result.length - 1];
        const needsAssistant = !prevMsg ||
          prevMsg.role !== 'assistant' ||
          !Array.isArray(prevMsg.content) ||
          !(prevMsg.content as Array<unknown>).some(
            (c: unknown) => (c as { type?: string })?.type === 'tool-call'
          );

        if (needsAssistant) {
          result.push({
            role: 'assistant' as const,
            content: [{
              type: 'tool-call',
              toolCallId,
              toolName,
              args: {},
            }],
          });
        }

        result.push({
          role: 'tool' as const,
          content: [{
            type: 'tool-result',
            toolCallId,
            toolName,
            output: { type: 'text' as const, value: content },
          }],
        });
      } else {
        result.push({
          role: msg.role as 'system' | 'user' | 'assistant',
          content,
        });
      }
    }

    return result as Array<
      | { role: 'system'; content: string }
      | { role: 'user'; content: string }
      | { role: 'assistant'; content: string | Array<{ type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }> }
      | { role: 'tool'; content: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }> }
    >;
  }

  private convertTools(tools: FunctionDefinition[] | undefined): Record<string, ReturnType<typeof tool>> | undefined {
    if (!tools || tools.length === 0) return undefined;

    const result: Record<string, ReturnType<typeof tool>> = {};
    for (const t of tools) {
      result[t.name] = tool({
        description: t.description,
        parameters: z.object({}).passthrough(),
        execute: async (args: unknown) => JSON.stringify(args),
      });
    }
    return result;
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
    const result = await generateText({
      model: this.model,
      messages: this.convertMessages(messages),
      temperature: options?.temperature ?? 0.7,
      ...(tools ? { tools } : {}),
    });

    const toolCalls = result.toolCalls?.map(tc => ({
      id: tc.toolCallId,
      name: tc.toolName,
      args: (tc as { input?: Record<string, unknown> }).input ?? {},
    }));

    return {
      content: result.text,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: result.finishReason as 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled',
      usage: result.usage ? {
        promptTokens: (result.usage as { promptTokens?: number }).promptTokens ?? 0,
        completionTokens: (result.usage as { completionTokens?: number }).completionTokens ?? 0,
      } : undefined,
    };
  }

  async *stream(messages: Message[], options?: LLMOptions): AsyncGenerator<LLMChunk> {
    const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
    const { fullStream } = streamText({
      model: this.model,
      messages: this.convertMessages(messages),
      temperature: options?.temperature ?? 0.7,
      ...(tools ? { tools } : {}),
    });

    for await (const chunk of fullStream) {
      if (chunk.type === 'text-delta') {
        const textDelta = (chunk as { text?: string }).text;
        if (textDelta) yield { text: textDelta };
      } else if (chunk.type === 'tool-call') {
        const tcc = chunk as { toolCallId: string; toolName: string; input?: unknown };
        yield { toolCallId: tcc.toolCallId, toolName: tcc.toolName, argsDelta: JSON.stringify(tcc.input ?? {}) };
      }
    }
  }
}

// ============================================================
// SimpleToolRegistry — in-memory tool registry for tests
// ============================================================

export class SimpleToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const t of tools) this.register(t);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getFunctionDef(name: string): FunctionDefinition | undefined {
    const tool = this.tools.get(name);
    if (!tool) return undefined;
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
    };
  }

  getFunctionDefs(): FunctionDefinition[] {
    return this.list().map(n => this.getFunctionDef(n)!);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool.execute(args);
  }
}

// ============================================================
// Test Helpers
// ============================================================

export function createTestConfig(overrides: Partial<AgentLoopConfig> = {}, apiConfig: E2EApiConfig): AgentLoopConfig {
  return {
    model: { provider: 'openai-compatible', model: apiConfig.model },
    maxSteps: 5,
    maxLLMRepairAttempts: 2,
    parallelToolCalls: false,
    streaming: false,
    ...overrides,
  };
}

export function createTestContext(
  llm: LLMAdapter,
  tools: ToolDefinition[] = [],
): AgentContext {
  const sessionId = `e2e-session-${generateSessionId()}`;
  const builder = ContextBuilder.create()
    .with({ sessionId, agentName: 'e2e-test-agent', llm })
    .withTools(tools);
  return builder.build();
}

export interface AgentWithEvent {
  run(input: string): Promise<string>;
  run$(input: string): { subscribe: (obs: { next(v: AgentEvent): void; error?(e: unknown): void; complete?(): void }) => { unsubscribe(): void } };
  onAny(listener: (event: AgentEvent) => void): () => void;
}

export async function runAndCollect(agent: AgentWithEvent, input: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const unsub = agent.onAny((e) => events.push(e));
  try { await agent.run(input); } catch { /* errors collected as events */ }
  unsub();
  return events;
}

// Re-export createAgentLoop for convenience
export { createAgentLoop };
