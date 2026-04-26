/**
 * Weather Agent - Simple L2 AgentForge Configuration
 *
 * A simple agent with OpenAI and a weather tool.
 * Run with: npx tsx src/index.ts
 */

import { defineConfig } from 'agentforge';
import { adapter } from './src/llm/adapter.js';
import { tools } from './src/tools/index.js';

export default defineConfig({
  name: 'weather-agent',
  model: 'openai/gpt-4o',

  // LLM Configuration
  llm: adapter,

  // Tools
  tools,
});