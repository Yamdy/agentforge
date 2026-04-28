/**
 * Worker agent definitions for the multi-agent orchestrator.
 *
 * Each worker agent is a specialized agent that handles
 * a specific type of task delegated by the orchestrator.
 */

import type { AgentConfig } from 'agentforge';

/**
 * Research agent — gathers information on a given topic.
 */
export const researchAgent: AgentConfig = {
  name: 'researcher',
  model: 'openai/gpt-4o',
  maxSteps: 10,
  systemPrompt: `You are a research agent. Your job is to gather information on topics.
Be thorough and factual. Provide structured findings with sources when possible.
Focus on accuracy and completeness.`,
};

/**
 * Writer agent — creates content based on research.
 */
export const writerAgent: AgentConfig = {
  name: 'writer',
  model: 'openai/gpt-4o',
  maxSteps: 10,
  systemPrompt: `You are a writing agent. Your job is to create clear, well-structured content.
Use the research provided to write informative and engaging text.
Organize your output with headings and bullet points when appropriate.`,
};

/**
 * Reviewer agent — checks content quality and accuracy.
 */
export const reviewerAgent: AgentConfig = {
  name: 'reviewer',
  model: 'openai/gpt-4o',
  maxSteps: 10,
  systemPrompt: `You are a review agent. Your job is to check content for:
1. Factual accuracy
2. Logical consistency
3. Clarity and readability
4. Completeness
Provide specific feedback and suggestions for improvement.`,
};