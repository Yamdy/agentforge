#!/usr/bin/env tsx
/**
 * Workflow Orchestration Demo
 *
 * 演示 AgentForge 的工作流编排功能：
 * - Workflow 链式 API
 * - MsgHub 多代理协作
 * - Pipeline 函数
 */

import {
  createStep,
  createWorkflow,
  MsgHub,
  sequentialPipeline,
  parallelPipeline,
} from '../workflow/index.js';
import { Agent } from '../agent/index.js';
import { InMemoryHistory } from '../history.js';
import { ToolRegistry } from '../registry.js';
import { AIAdapter } from '../adapters/ai.js';

console.log('=== AgentForge Workflow Orchestration Demo ===\n');

// === Demo 1: Workflow 链式 API ===
console.log('Demo 1: Workflow 链式 API\n');

const stepDouble = createStep('double', async (input: number) => input * 2);
const stepAddTen = createStep('addTen', async (input: number) => input + 10);
const stepMultiplyHundred = createStep('multiplyHundred', async (input: number) => input * 100);

const workflow1 = createWorkflow({ id: 'calculator' })
  .step('double', stepDouble)
  .then('addTen', stepAddTen)
  .commit();

const result1 = await workflow1.run(5);
console.log(`Input: 5 → ${result1}`);
console.log();

const workflow2 = createWorkflow({ id: 'branch-calculator' })
  .step('double', stepDouble)
  .branch((ctx) => (ctx.getResult('double') as number) > 10, {
    true: { id: 'large', step: stepMultiplyHundred },
    false: { id: 'small', step: stepAddTen },
  })
  .commit();

const result2a = await workflow2.run(3); // 3 * 2 = 6 ≤ 10 → 6 + 10 = 16
const result2b = await workflow2.run(8); // 8 * 2 = 16 > 10 → 16 * 100 = 1600

console.log(`Input: 3 → ${result2a}`);
console.log(`Input: 8 → ${result2b}`);
console.log();

// === Demo 2: MsgHub 多代理协作 ===
console.log('Demo 2: MsgHub 多代理协作\n');

function createMockAgent(name: string, response: string) {
  const adapter = {
    chat: async () => ({ content: response, toolCalls: undefined }),
    chatStream: () => ({ subscribe: () => {} }),
  } as unknown as AIAdapter;
  const history = new InMemoryHistory();
  const registry = new ToolRegistry();
  const agent = new Agent(adapter, history, registry);
  (agent as any).name = name;
  return agent;
}

const alice = createMockAgent('Alice', 'Hello, I am Alice!');
const bob = createMockAgent('Bob', 'Hi Alice, I am Bob!');
const charlie = createMockAgent('Charlie', 'Nice to meet you both!');

await using hub = new MsgHub({
  participants: [alice, bob, charlie],
  announcement: { role: 'system', content: "Let's have a conversation!" },
  enableAutoBroadcast: true,
});

hub.messages$.subscribe((msg) => {
  console.log(`[${msg.role}] ${msg.content}`);
});

console.log('Agents initialized. Messages will be broadcasted.');
console.log();

// === Demo 3: Pipeline 函数 ===
console.log('Demo 3: Pipeline 函数\n');

const agent1 = createMockAgent('Agent 1', 'Response from Agent 1');
const agent2 = createMockAgent('Agent 2', 'Response from Agent 2');
const agent3 = createMockAgent('Agent 3', 'Response from Agent 3');

console.log('Sequential Pipeline:');
const seqResult = await sequentialPipeline([agent1, agent2, agent3]);
console.log(seqResult);
console.log();

console.log('Parallel Pipeline:');
const parResult = await parallelPipeline([agent1, agent2, agent3]);
console.log(parResult);
console.log();

console.log('=== Demo Complete ===');
