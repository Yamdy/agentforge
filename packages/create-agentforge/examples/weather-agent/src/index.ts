/**
 * Weather Agent - Entry Point
 *
 * A simple L2 agent that uses OpenAI with a weather tool.
 */

import 'dotenv/config';
import { createAgent } from 'agentforge';
import config from '../agentforge.config.js';

const agent = createAgent(config);

// Run the agent with a prompt
const result = await agent.run('What is the weather in Tokyo?');
console.log('Agent output:', result);

// Streaming mode (optional)
agent.stream('Tell me about the weather in Paris', {
  onText: (delta: string) => process.stdout.write(delta),
  onComplete: (finalResult: unknown) => console.log('\nCompleted:', finalResult),
});