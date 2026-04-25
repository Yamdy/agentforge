/**
 * AgentForge PromptBuilder
 *
 * Constructs the full prompt payload for LLM invocation:
 * - System prompt from template + variables
 * - Tool usage instructions
 * - Extra instructions
 * - Message history + user input
 * - Tool definitions (converted from Zod schemas)
 *
 * @module
 */

import { z } from 'zod';
import type { ToolDefinition } from './interfaces.js';
import type { Message } from './events.js';
import { toolsToFunctionDefs } from './zod-to-schema.js';

// Re-export interfaces from interfaces.ts for convenience
export type { PromptBuilder, PromptBuildOptions, BuiltPrompt } from './interfaces.js';

// ============================================================
// Default Templates
// ============================================================

/**
 * Default system prompt template.
 * Uses {{variable}} syntax for interpolation.
 */
export const DEFAULT_SYSTEM_TEMPLATE = `You are a helpful AI assistant.

{{customInstructions}}

{{toolInstructions}}`;

/**
 * Template for tool usage instructions appended to system prompt.
 */
export const TOOL_INSTRUCTIONS_TEMPLATE = `You have access to the following tools:
{{toolList}}

When you need to use a tool, respond with a tool call. Use tools when they are relevant to the user's request. Do not make up values for tool parameters — use the information provided or ask the user for clarification.`;

// ============================================================
// Implementation
// ============================================================

/**
 * Default implementation of the PromptBuilder interface.
 *
 * Builds the complete prompt payload for LLM invocation:
 * 1. Creates system message from template + variables
 * 2. Appends tool usage instructions if tools are present
 * 3. Appends extra instructions if provided
 * 4. Converts tools to FunctionDefinition[] using zodToFunctionDef
 * 5. Builds message array: [system, ...history, user input]
 * 6. Estimates token count (rough: chars / 4)
 */
export class DefaultPromptBuilder {
  static readonly DEFAULT_SYSTEM_TEMPLATE = DEFAULT_SYSTEM_TEMPLATE;
  static readonly TOOL_INSTRUCTIONS_TEMPLATE = TOOL_INSTRUCTIONS_TEMPLATE;

  /**
   * Build a complete prompt for LLM invocation.
   *
   * @param history - Prior conversation messages
   * @param input - Current user input string
   * @param tools - Tool definitions (with Zod schemas) available for this turn
   * @param options - Optional build configuration
   * @returns Built prompt with messages, tool definitions, and token estimate
   */
  build(
    history: Message[],
    input: string,
    tools: ToolDefinition<z.ZodTypeAny>[],
    options?: import('./interfaces.js').PromptBuildOptions
  ): import('./interfaces.js').BuiltPrompt {
    const template = options?.systemTemplate ?? DEFAULT_SYSTEM_TEMPLATE;
    const templateVars = options?.templateVars ?? {};
    const extraInstructions = options?.extraInstructions ?? [];

    // 1. Build tool list for template
    const toolList = tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n');

    // 2. Render tool instructions
    const toolInstructions =
      tools.length > 0
        ? this.renderTemplate(TOOL_INSTRUCTIONS_TEMPLATE, {
            toolList,
          })
        : '';

    // 3. Build custom instructions from extra instructions
    const customInstructions = extraInstructions.join('\n\n');

    // 4. Render the system prompt template
    const systemContent = this.renderTemplate(template, {
      ...templateVars,
      customInstructions,
      toolInstructions,
    });

    // 5. Build messages array
    const systemMessage: Message = {
      role: 'system',
      content: systemContent,
    };

    const userInput: Message = {
      role: 'user',
      content: input,
    };

    const messages: Message[] = [systemMessage, ...history, userInput];

    // 6. Convert tools to FunctionDefinition[]
    const functionDefs = tools.length > 0 ? toolsToFunctionDefs(tools) : [];

    // 7. Estimate tokens (rough: characters / 4)
    const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    const tokenEstimate = Math.ceil(totalChars / 4);

    return {
      messages,
      tools: functionDefs,
      tokenEstimate,
    };
  }

  /**
   * Simple {{var}} template interpolation.
   *
   * Replaces all `{{key}}` occurrences with the corresponding value.
   * Unknown keys are replaced with an empty string.
   *
   * @param template - Template string with {{var}} placeholders
   * @param vars - Key-value pairs for interpolation
   * @returns Rendered string
   */
  private renderTemplate(template: string, vars: Record<string, unknown>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      const placeholder = `{{${key}}}`;
      const replacement = value === null || value === undefined ? '' : String(value);
      // Replace all occurrences
      while (result.includes(placeholder)) {
        result = result.replace(placeholder, replacement);
      }
    }
    // Replace any remaining {{...}} placeholders with empty string
    result = result.replace(/\{\{[^}]*\}\}/g, '');
    return result;
  }
}
