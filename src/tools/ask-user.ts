/**
 * AskUserQuestionTool — prompts the user for input with optional choices.
 *
 * This tool enables agents to interactively ask the user questions.
 * When used within a session with a HITL (human-in-the-loop) context,
 * it formats questions with options in a structured way.
 * Without HITL context, it returns a placeholder message.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../core/interfaces.js';

// ============================================================
// Zod Schema
// ============================================================

const AskUserQuestionSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  options: z.array(z.string()).optional().describe('Optional list of choices for the user'),
  multiSelect: z.boolean().optional().describe('Whether the user can select multiple options'),
});

// ============================================================
// Helpers
// ============================================================

/**
 * Check if we have an interactive HITL context.
 * A valid context has a non-empty parentSessionId.
 */
function hasHITLContext(ctx?: ToolContext): boolean {
  return !!(ctx?.parentSessionId && ctx.parentSessionId.length > 0);
}

/**
 * Format question with options into a readable string.
 */
function formatQuestion(question: string, options?: string[], multiSelect?: boolean): string {
  let output = `Question: ${question}`;

  if (options && options.length > 0) {
    output += '\n\nOptions:';
    for (let i = 0; i < options.length; i++) {
      output += `\n  ${i + 1}) ${options[i]}`;
    }

    if (multiSelect) {
      output += "\n\n(Select one or more — e.g. '1, 3')";
    } else {
      output += '\n\n(Select one option)';
    }
  }

  return output;
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create the ask_user_question tool.
 *
 * This tool does NOT require approval — it IS the approval/input mechanism.
 *
 * @returns ToolDefinition for ask_user_question
 */
export function createAskUserQuestionTool(): ToolDefinition {
  return {
    name: 'ask_user_question',
    description:
      'Ask the user a question, optionally with multiple-choice options. ' +
      'This tool is used to request input or approval from the human user. ' +
      'When used in an interactive session, the question will be displayed to the user.',
    parameters: AskUserQuestionSchema,
    requiresApproval: false,
    // eslint-disable-next-line @typescript-eslint/require-await
    execute: async (args: unknown, ctx?: ToolContext): Promise<string> => {
      // Validate arguments
      const parsed = AskUserQuestionSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { question, options, multiSelect } = parsed.data;

      const formatted = formatQuestion(question, options, multiSelect);

      // Check if we're in an interactive HITL session
      if (hasHITLContext(ctx)) {
        return formatted;
      }

      // No HITL context — prepend note
      return `[Interactive question sent to user]\n\n${formatted}`;
    },
  };
}
