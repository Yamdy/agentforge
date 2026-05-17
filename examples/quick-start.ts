/**
 * AgentForge Quick Start — Minimal runnable example
 *
 * Demonstrates creating an agent and making a single call.
 *
 * Prerequisites:
 *   - .env file with at least one provider API key (e.g. DEEPSEEK_API_KEY)
 *
 * Run: npx tsx --env-file=.env quick-start.ts
 */

import { Agent, registerProvider } from '@primo-ai/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Step 1: Register a model provider
// The provider name must match the prefix in the model string (e.g. "deepseek/deepseek-v4-flash")
registerProvider('deepseek', (modelId: string) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set. Create a .env file.');
  const sdk = createOpenAICompatible({ baseURL: 'https://api.deepseek.com', apiKey } as any);
  return sdk.languageModel(modelId);
});

// Step 2: Create an agent with a model and system prompt
const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant. Answer concisely.',
  maxIterations: 3,
});

// Step 3: Run the agent and print the response
async function main() {
  const result = await agent.run('What is the capital of France?');
  console.log('Response:', result.response);
  console.log('Tokens:', result.tokenUsage);
  console.log('Session:', result.sessionId);
}

main().catch(console.error);
