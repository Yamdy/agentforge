/**
 * AgentForge Prompt Templates
 *
 * Configurable prompt strings used by the agent loop and error recovery.
 * Provides defaults that match the previous hardcoded values.
 */

export interface PromptTemplates {
  /** Injected when token budget allows continuation (nudges LLM to keep going) */
  continuePrompt: string;
  /** Injected after escalating output tokens during error recovery */
  resumeAfterTokenLimit: string;
}

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplates = {
  continuePrompt: 'Continue from where you left off. Do not repeat or summarize.',
  resumeAfterTokenLimit: 'Output token limit hit. Resume directly — no apology, no recap.',
};
