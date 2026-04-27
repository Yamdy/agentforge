/**
 * Transform Operators for AgentForge
 *
 * Operators for transforming event data without side effects.
 * All transformations return new objects (immutable).
 *
 * @module
 */

import type { OperatorFunction } from 'rxjs';
import { map } from 'rxjs/operators';
import type { AgentEvent, Message } from '../core/index.js';

/**
 * Create a validated AgentEvent from a partial event object.
 * Validates against the schema at runtime to catch construction errors early.
 */
function createEvent<T extends AgentEvent>(event: T): AgentEvent {
  // At minimum, verify the event has the required 'type' and 'timestamp' fields
  if (!event.type || !event.timestamp) {
    throw new Error(
      `Invalid event: missing required fields. type=${event.type}, timestamp=${event.timestamp}`
    );
  }
  return event;
}

// ============================================================
// LLM Parameter Transformation
// ============================================================

/**
 * Parameters that can be transformed in an LLM request
 */
export interface LLMTransformParams {
  /** Model identifier */
  model: string;
  /** Provider name */
  provider: string;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Top-p sampling */
  topP?: number;
  /** Stop sequences */
  stopSequences?: string[];
}

/**
 * Transform LLM parameters in llm.request events.
 *
 * Use this to modify model settings like temperature, maxTokens, etc.
 * Non-llm.request events are passed through unchanged.
 *
 * @param transform - Function that receives current params and returns transformed params
 * @returns Operator that transforms llm.request events
 *
 * @example
 * // Lower temperature for more deterministic responses
 * source.pipe(transformLLMParams(params => ({
 *   ...params,
 *   temperature: 0.2
 * })))
 *
 * @example
 * // Switch to a different model
 * source.pipe(transformLLMParams(params => ({
 *   ...params,
 *   model: 'gpt-4-turbo'
 * })))
 */
export function transformLLMParams(
  transform: (params: LLMTransformParams) => Partial<LLMTransformParams>
): OperatorFunction<AgentEvent, AgentEvent> {
  return map(event => {
    if (event.type !== 'llm.request') {
      return event;
    }

    const currentParams: LLMTransformParams = {
      model: event.model.model,
      provider: event.model.provider,
    };

    const transformed = transform(currentParams);

    // Build new event with transformed model - validated as AgentEvent
    return createEvent({
      type: 'llm.request',
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      messages: event.messages,
      model: {
        provider: transformed.provider ?? event.model.provider,
        model: transformed.model ?? event.model.model,
      },
      tools: event.tools,
    });
  });
}

// ============================================================
// Tool Argument Transformation
// ============================================================

/**
 * Transform tool arguments in tool.call events.
 *
 * Use this to modify or validate arguments before tool execution.
 * Non-tool.call events are passed through unchanged.
 *
 * @param transform - Function that receives tool name and args, returns transformed args
 * @returns Operator that transforms tool.call events
 *
 * @example
 * // Add default values for missing arguments
 * source.pipe(transformToolArgs((name, args) => {
 *   if (name === 'search' && !args.limit) {
 *     return { ...args, limit: 10 };
 *   }
 *   return args;
 * }))
 *
 * @example
 * // Sanitize arguments
 * source.pipe(transformToolArgs((name, args) => {
 *   // Remove any null/undefined values
 *   return Object.fromEntries(
 *     Object.entries(args).filter(([, v]) => v != null)
 *   );
 * }))
 */
export function transformToolArgs(
  transform: (toolName: string, args: Record<string, unknown>) => Record<string, unknown>
): OperatorFunction<AgentEvent, AgentEvent> {
  return map(event => {
    if (event.type !== 'tool.call') {
      return event;
    }

    const transformedArgs = transform(event.toolName, event.args);

    return createEvent({
      type: 'tool.call',
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: transformedArgs,
    });
  });
}

// ============================================================
// Message Compression
// ============================================================

/**
 * Compress messages in llm.request events to reduce token usage.
 *
 * Use this to manage context window size by compressing or summarizing
 * older messages. Non-llm.request events are passed through unchanged.
 *
 * @param shouldCompress - Predicate to determine if compression is needed
 * @param compress - Function that compresses the messages array
 * @returns Operator that may compress messages in llm.request events
 *
 * @example
 * // Keep only last 10 messages
 * source.pipe(compressMessages(
 *   messages => messages.length > 10,
 *   messages => messages.slice(-10)
 * ))
 *
 * @example
 * // Summarize old messages
 * source.pipe(compressMessages(
 *   messages => messages.length > 20,
 *   messages => [
 *     { role: 'system', content: 'Previous conversation summarized...' },
 *     ...messages.slice(-5)
 *   ]
 * ))
 */
export function compressMessages(
  shouldCompress: (messages: Message[]) => boolean,
  compress: (messages: Message[]) => Message[]
): OperatorFunction<AgentEvent, AgentEvent> {
  return map(event => {
    if (event.type !== 'llm.request') {
      return event;
    }

    if (!shouldCompress(event.messages)) {
      return event;
    }

    const compressedMessages = compress(event.messages);

    return createEvent({
      type: 'llm.request',
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      messages: compressedMessages,
      model: event.model,
      tools: event.tools,
    });
  });
}

// ============================================================
// System Prompt Injection
// ============================================================

/**
 * Inject a system prompt at the beginning of messages in llm.request events.
 *
 * Use this to add custom instructions or context to every LLM request.
 * If a system message already exists, it will be replaced.
 * Non-llm.request events are passed through unchanged.
 *
 * @param prompt - The system prompt to inject, or a function that generates it from messages
 * @returns Operator that injects system prompt into llm.request events
 *
 * @example
 * // Static system prompt
 * source.pipe(injectSystemPrompt('You are a helpful assistant.'))
 *
 * @example
 * // Dynamic system prompt based on message count
 * source.pipe(injectSystemPrompt(messages => {
 *   return `You have ${messages.length} messages in context. Be helpful.`;
 * }))
 *
 * @example
 * // Extend existing system message
 * source.pipe(injectSystemPrompt(messages => {
 *   const existingSystem = messages.find(m => m.role === 'system');
 *   return existingSystem
 *     ? `${existingSystem.content}\n\nAdditional instructions...`
 *     : 'Default system prompt';
 * }))
 */
export function injectSystemPrompt(
  prompt: string | ((messages: Message[]) => string)
): OperatorFunction<AgentEvent, AgentEvent> {
  return map(event => {
    if (event.type !== 'llm.request') {
      return event;
    }

    // Get system content from prompt - event.messages is guaranteed to exist here
    const messages = event.messages;
    const systemContent = typeof prompt === 'string' ? prompt : prompt(messages);

    // Filter out existing system messages
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    // Create new system message
    const systemMessage: Message = {
      role: 'system',
      content: systemContent,
    };

    return createEvent({
      type: 'llm.request',
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      messages: [systemMessage, ...nonSystemMessages],
      model: event.model,
      tools: event.tools,
    });
  });
}
