// ========== Tool Context Types ==========

import type { Message } from '../types';

/**
 * Metadata update input for tool progress display.
 */
export interface MetadataInput {
  title?: string;
  metadata?: Record<string, unknown>;
  progress?: number;
}

/**
 * Ask input for requesting user interaction.
 */
export interface AskInput {
  message: string;
  choices?: string[];
  defaultChoice?: string;
  allowCustom?: boolean;
}

/**
 * Ask result from user response.
 */
export interface AskResult {
  choice: string;
  isCustom?: boolean;
  /** For permission requests: user chose "always allow" */
  always?: boolean;
}

/**
 * Tool execution context passed to tool execute function.
 *
 * Provides:
 * - Session/message identifiers
 * - Abort signal for cancellation
 * - Access to conversation history
 * - Runtime capabilities (metadata updates, user questions)
 *
 * @example
 * ```typescript
 * async execute(args, ctx: ToolContext) {
 *   if (ctx.abort.aborted) throw new Error('Cancelled')
 *
 *   ctx.metadata({ title: 'Processing...', progress: 50 })
 *
 *   const history = ctx.messages
 *   const lastUserMsg = history.filter(m => m.role === 'user').pop()
 *
 *   const answer = await ctx.ask({
 *     message: 'Should I proceed?',
 *     choices: ['Yes', 'No']
 *   })
 *
 *   return { title: 'Done', output: `User chose: ${answer.choice}` }
 * }
 * ```
 */
export interface ToolContext {
  // ========== Identifiers ==========
  /** Current session ID */
  sessionId: string;
  /** Current message ID being processed */
  messageId: string;
  /** LLM tool call ID (from tool_call_start event) */
  callId: string;
  /** Agent name executing this tool */
  agent: string;

  // ========== Control ==========
  /** Abort signal for cancellation support */
  abort: AbortSignal;

  // ========== Data Access ==========
  /** Read-only access to conversation history */
  messages: readonly Message[];

  // ========== Runtime Capabilities ==========

  /**
   * Update tool metadata for progress display.
   *
   * @param input - Metadata update (title, custom metadata, progress percentage)
   */
  metadata(input: MetadataInput): void;

  /**
   * Ask user for input or permission.
   *
   * @param input - Question to ask, optional choices
   * @returns User's response
   */
  ask(input: AskInput): Promise<AskResult>;
}

/**
 * Create a minimal ToolContext for testing purposes.
 */
export function createMockToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionId: 'test-session',
    messageId: 'test-message',
    callId: 'test-call',
    agent: 'test-agent',
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async () => ({ choice: 'yes' }),
    ...overrides,
  };
}