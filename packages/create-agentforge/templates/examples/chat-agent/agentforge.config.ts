/**
 * Chat Agent - Simple conversational agent with memory
 *
 * A minimal agent that demonstrates multi-turn conversation
 * with automatic message history management.
 *
 * Run with: npx tsx src/index.ts
 */

/** @type {import('agentforge').AgentConfig} */
export default {
  name: 'chat-agent',

  // LLM provider and model
  model: 'openai/gpt-4o',

  // Maximum conversation steps before forced termination
  maxSteps: 10,

  // Enable conversation memory (history is preserved across turns)
  history: [],

  // System prompt defines the agent's personality and behavior
  systemPrompt: 'You are a helpful conversational assistant. Be concise and friendly.',
};