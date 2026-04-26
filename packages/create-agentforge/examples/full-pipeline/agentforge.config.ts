/**
 * Full Pipeline Agent - Advanced L3 AgentForge Configuration
 *
 * An advanced agent with all modules enabled using the L3 API.
 * Run with: npx tsx src/index.ts
 */

import { defineConfig } from 'agentforge';
import { adapter } from './src/llm/adapter.js';
import { tools } from './src/tools/index.js';
import { checkpointStorage } from './src/checkpoint/storage.js';
import { logger } from './src/observability/logger.js';

export default defineConfig({
  name: 'full-pipeline',
  model: 'openai/gpt-4o',

  // LLM Configuration
  llm: adapter,

  // Tools
  tools,

  // Checkpoint persistence (SQLite for production)
  checkpoint: true,

  // Observability
  tracing: true,
  metrics: true,
});