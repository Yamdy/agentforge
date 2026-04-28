/**
 * Chat Agent - Entry Point
 *
 * A simple conversational agent with memory using the L2 API.
 * Demonstrates multi-turn conversation with streaming responses.
 */

import 'dotenv/config';
import { createAgent } from 'agentforge';
import config from '../agentforge.config.js';

// Create the agent from config
const agent = createAgent(config);

// Run a single conversation turn
async function chat(message: string): Promise<void> {
  console.log(`\n👤 User: ${message}`);

  // Stream the response for real-time output
  await agent.stream(message, {
    onText: (delta: string) => process.stdout.write(delta),
    onComplete: () => console.log('\n'),
    onError: (error: unknown) => console.error('Error:', error),
  });
}

// Main conversation loop
async function main(): Promise<void> {
  console.log('🤖 Chat Agent started. Type a message or press Ctrl+C to exit.\n');

  // Example: Start with a greeting
  await chat('Hello! What can you help me with?');

  // Example: Follow-up question (history is preserved)
  await chat('Can you tell me more about that?');

  // Example: Context-aware question (agent remembers previous turns)
  await chat('What are the key benefits?');
}

main().catch(console.error);