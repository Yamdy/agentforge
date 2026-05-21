import { Agent } from '@primo-ai/core';

const agent = new Agent({
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are a helpful assistant powered by AgentForge.',
  maxSteps: 10,
});

const input = process.argv[2] ?? 'Say hello!';
const result = await agent.run(input);
console.log(result.response);
