/**
 * Full Pipeline Agent - Entry Point
 *
 * An advanced L3 agent with all modules enabled using
 * AgentContextBuilder for full control.
 */

import 'dotenv/config';
import { runAgent, AgentContextBuilder } from 'agentforge/api';
import config from '../agentforge.config.js';

// Build context from config
const ctx = new AgentContextBuilder()
  .withLLMAdapter(config.llm)
  .withTools(config.tools)
  .withCheckpointStorage(config.checkpoint as unknown as import('agentforge').CheckpointStorage)
  .build();

// Run with L3 API
const agent = runAgent(ctx, 'Hello! How can I help you today?', {
  maxSteps: 10,
});

// Subscribe to key lifecycle events
const eventTypes = [
  'agent.start',
  'llm.request',
  'llm.response',
  'tool.call',
  'tool.result',
  'agent.complete',
  'agent.error',
];
for (const type of eventTypes) {
  agent.on(type, (event: { type: string }) => {
    console.log(`[${event.type}]`, event);
  });
}

// Run the agent
const result = await agent.run$('Hello! How can I help you today?');
console.log('Agent execution completed:', result);
