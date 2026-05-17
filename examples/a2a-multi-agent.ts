/**
 * AgentForge A2A Multi-Agent — Two agents communicating via A2A protocol
 *
 * Demonstrates:
 *   1. Creating two AgentForge servers with different agents
 *   2. Using A2AClient to send messages between agents
 *   3. Building agent cards for A2A discovery
 *
 * Prerequisites:
 *   - .env file with DEEPSEEK_API_KEY
 *
 * Run: npx tsx --env-file=.env a2a-multi-agent.ts
 */

import { Agent, registerProvider } from '@agentforge/core';
import {
  AgentForgeServer,
  A2AClient,
  buildAgentCard,
  a2aRoutes,
} from '@agentforge/server';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// ─── Provider setup ─────────────────────────────────────────────────────────

registerProvider('deepseek', (modelId: string) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set.');
  const sdk = createOpenAICompatible({ baseURL: 'https://api.deepseek.com', apiKey } as any);
  return sdk.languageModel(modelId);
});

// ─── Agent definitions ──────────────────────────────────────────────────────

// Agent A: A researcher that generates research summaries
const researcher = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a research assistant. Provide brief, accurate summaries on any topic.',
  maxIterations: 2,
});

// Agent B: A reviewer that critiques and improves summaries
const reviewer = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a writing reviewer. Given a summary, suggest improvements in 2-3 bullet points.',
  maxIterations: 2,
});

// ─── Start servers ──────────────────────────────────────────────────────────

async function main() {
  // Server A: Researcher on port 3001
  // Register the researcher agent, then mount A2A routes
  const serverA = new AgentForgeServer({ port: 3001 });
  serverA.registry.register('researcher', {
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: 'You are a research assistant. Provide brief, accurate summaries on any topic.',
    maxIterations: 2,
  });
  const a2aA = a2aRoutes({
    registry: serverA.registry,
    agentId: 'researcher',
    cardOptions: {
      name: 'researcher',
      description: 'Research assistant that generates summaries',
      version: '1.0.0',
      url: 'http://localhost:3001/a2a',
      skills: [{ id: 'summarize', name: 'Summarize', description: 'Summarize a topic', tags: ['research'] }],
    },
  });
  serverA.hono.route('/a2a', a2aA.app);

  // Server B: Reviewer on port 3002
  const serverB = new AgentForgeServer({ port: 3002 });
  serverB.registry.register('reviewer', {
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: 'You are a writing reviewer. Given a summary, suggest improvements in 2-3 bullet points.',
    maxIterations: 2,
  });
  const a2aB = a2aRoutes({
    registry: serverB.registry,
    agentId: 'reviewer',
    cardOptions: {
      name: 'reviewer',
      description: 'Writing reviewer that improves summaries',
      version: '1.0.0',
      url: 'http://localhost:3002/a2a',
      skills: [{ id: 'review', name: 'Review', description: 'Review and improve text', tags: ['editing'] }],
    },
  });
  serverB.hono.route('/a2a', a2aB.app);

  const handleA = await serverA.start();
  const handleB = await serverB.start();
  console.log(`Researcher agent on port ${handleA.port}`);
  console.log(`Reviewer agent on port ${handleB.port}`);

  // ─── A2A Communication ─────────────────────────────────────────────────

  // Build client cards pointing to the respective A2A endpoints
  const researcherCard = buildAgentCard({
    name: 'researcher',
    description: 'Research assistant that generates summaries',
    version: '1.0.0',
    url: 'http://localhost:3001/a2a',
    skills: [{ id: 'summarize', name: 'Summarize', description: 'Summarize a topic', tags: ['research'] }],
  });

  const reviewerCard = buildAgentCard({
    name: 'reviewer',
    description: 'Writing reviewer that improves summaries',
    version: '1.0.0',
    url: 'http://localhost:3002/a2a',
    skills: [{ id: 'review', name: 'Review', description: 'Review and improve text', tags: ['editing'] }],
  });

  // Client for talking to the researcher
  const researcherClient = new A2AClient({ card: researcherCard });

  // Client for talking to the reviewer
  const reviewerClient = new A2AClient({ card: reviewerCard });

  // Step 1: Ask the researcher to summarize a topic
  console.log('\n--- Step 1: Researcher summarizes ---');
  const summarizeResult = await researcherClient.sendMessage(
    'Summarize the concept of neural networks in 2 sentences.',
  );
  console.log('Researcher response:', JSON.stringify(summarizeResult, null, 2));

  // Step 2: Send the summary to the reviewer for improvement
  console.log('\n--- Step 2: Reviewer critiques ---');
  const reviewResult = await reviewerClient.sendMessage(
    'Please review and improve this summary: Neural networks are computing systems inspired by biological neural networks. They consist of layers of interconnected nodes that process information.',
  );
  console.log('Reviewer response:', JSON.stringify(reviewResult, null, 2));

  // ─── Cleanup ───────────────────────────────────────────────────────────

  console.log('\n--- Done ---');
  await handleA.close();
  await handleB.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
