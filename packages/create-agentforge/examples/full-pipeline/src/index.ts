/**
 * Full Pipeline Agent - Entry Point
 *
 * An advanced L3 agent with all modules enabled using
 * AgentContextBuilder for full Observable control.
 */

import 'dotenv/config';
import { runAgent, AgentContextBuilder } from 'agentforge/api';
import { filter, tap, takeUntilTerminal } from 'rxjs/operators';
import config from '../agentforge.config.js';

// Build context from config
const ctx = new AgentContextBuilder()
  .withLLMAdapter(config.llm)
  .withTools(config.tools)
  .withCheckpointStorage(config.checkpoint as unknown as import('agentforge').CheckpointStorage)
  .build();

// Run with Observable control - L3 API
runAgent(ctx, 'Hello! How can I help you today?', {
  maxSteps: 10,
}).pipe(
  takeUntilTerminal(),
  filter((event: { type: string }) => event.type !== 'agent.step'),
  tap({
    next: (event: { type: string }) => {
      console.log(`[${event.type}]`, event);
    },
    complete: () => {
      console.log('Agent execution completed');
    },
  }),
).subscribe();