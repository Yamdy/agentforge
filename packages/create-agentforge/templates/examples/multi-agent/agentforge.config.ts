/**
 * Multi-Agent - Orchestrator + worker pattern with subagents
 *
 * Demonstrates how to set up an orchestrator agent that
 * delegates tasks to specialized worker agents.
 *
 * Run with: npx tsx src/index.ts
 */

import { defineConfig } from 'agentforge';
import { z } from 'zod';
import { adapter } from './src/llm/adapter.js';
import { researchAgent, writerAgent, reviewerAgent } from './src/agents/index.js';

export default defineConfig({
  name: 'multi-agent',

  // LLM provider and model
  model: 'openai/gpt-4o',

  // Higher step limit for multi-agent coordination
  maxSteps: 25,

  // LLM adapter
  llm: adapter,

  // Sub-agent delegation — the orchestrator can delegate to workers
  subagents: {
    researcher: {
      agent: researchAgent,
      description: 'Research agent that gathers information on a topic',
    },
    writer: {
      agent: writerAgent,
      description: 'Writing agent that creates content based on research',
    },
    reviewer: {
      agent: reviewerAgent,
      description: 'Review agent that checks content quality and accuracy',
    },
  },

  // Orchestrator tools for managing the workflow
  tools: {
    delegateToResearcher: {
      description: 'Delegate a research task to the researcher agent',
      parameters: z.object({
        topic: z.string().describe('The topic to research'),
        depth: z.enum(['brief', 'detailed']).optional().describe('How detailed the research should be'),
      }),
      execute: async (args: { topic: string; depth?: string }) => {
        // In a real implementation, this would invoke the subagent
        return `Research task delegated: "${args.topic}" (depth: ${args.depth ?? 'brief'})`;
      },
    },

    delegateToWriter: {
      description: 'Delegate a writing task to the writer agent',
      parameters: z.object({
        topic: z.string().describe('The topic to write about'),
        style: z.enum(['technical', 'casual', 'formal']).optional().describe('Writing style'),
        research: z.string().optional().describe('Research findings to incorporate'),
      }),
      execute: async (args: { topic: string; style?: string; research?: string }) => {
        return `Writing task delegated: "${args.topic}" (style: ${args.style ?? 'technical'})`;
      },
    },

    delegateToReviewer: {
      description: 'Delegate a review task to the reviewer agent',
      parameters: z.object({
        content: z.string().describe('The content to review'),
        criteria: z.array(z.string()).optional().describe('Review criteria'),
      }),
      execute: async (args: { content: string; criteria?: string[] }) => {
        return `Review task delegated for content (${args.content.length} chars)`;
      },
    },
  },

  // System prompt for the orchestrator
  systemPrompt: `You are an orchestrator agent that coordinates specialized workers.
When given a task, break it down and delegate to the appropriate worker:
- Use the researcher for gathering information
- Use the writer for creating content
- Use the reviewer for quality checks
Always coordinate the workflow and synthesize the final output.`,
});