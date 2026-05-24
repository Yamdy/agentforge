#!/usr/bin/env npx tsx
/**
 * AgentForge - General Chat Agent
 * 
 * A universal chat agent with tool access. No project required.
 * 
 * Usage:
 *   npx tsx examples/chat.ts              # Start chatting
 *   npx tsx examples/chat.ts "你好"       # One-shot question
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from '../src/agent/index.js';
import { AIAdapter } from '../src/adapters/ai.js';
import { InMemoryHistory } from '../src/history.js';
import { ToolRegistry } from '../src/registry.js';
import { BuiltinTools } from '../src/tools/builtin/index.js';
import { createLogger } from '../src/logger/index.js';
import type { StreamEvent } from '../src/types.js';

const log = createLogger('chat');

function createChatAgent(): Agent {
  const apiKey = process.env.OPENAI_API_KEY || process.env.DOUBAO_API_KEY || '';
  const baseURL = process.env.DOUBAO_BASE_URL || '';
  const model = process.env.MODEL || 'gpt-4o';

  if (!apiKey) {
    console.error('❌ 请设置 API Key:');
    console.error('   $env:DOUBAO_API_KEY="your-key"');
    console.error('   $env:OPENAI_API_KEY="your-key"');
    process.exit(1);
  }

  const adapter = new AIAdapter({ model, apiKey, baseURL, useTools: true });
  const history = new InMemoryHistory();
  const registry = new ToolRegistry();
  registry.register(BuiltinTools);
  adapter.setTools(registry.list());

  const agent = new Agent(adapter, history, registry, {
    maxSteps: 15,
    systemPrompt: `You are a helpful AI assistant. You can:
- Answer general knowledge questions
- Help with programming and coding tasks
- Read and analyze files if the user provides paths (use read/ls/grep/find/glob tools)
- Do calculations

Answer in the same language the user uses. Be concise and helpful.`,
  });

  log.info('Chat agent ready', { model, toolCount: registry.list().length });
  return agent;
}

async function askAgent(agent: Agent, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = '';
    agent.runStream(question).subscribe({
      next: (event: StreamEvent) => {
        if (event.type === 'text') {
          process.stdout.write(event.content);
          response += event.content;
        } else if (event.type === 'tool_call_start') {
          process.stdout.write(`\n   ⚙️ ${event.name}...`);
        } else if (event.type === 'tool_call_end') {
          process.stdout.write(' ✓');
        }
      },
      complete: () => resolve(response),
      error: (err) => reject(err),
    });
  });
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  const agent = createChatAgent();
  const model = process.env.MODEL || 'gpt-4o';

  console.log(`\n💬 AgentForge Chat (model: ${model})`);
  console.log('📝 输入任何问题，输入 quit 退出\n');

  // One-shot mode
  if (args.length > 0) {
    const question = args.join(' ');
    process.stdout.write('🤖 ');
    await askAgent(agent, question);
    console.log('\n');
    return;
  }

  // Interactive mode
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question('🧑 ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
        if (trimmed) console.log('\n👋 再见！\n');
        rl.close();
        return;
      }
      process.stdout.write('🤖 ');
      try {
        await askAgent(agent, trimmed);
        console.log('\n');
      } catch (err) {
        console.error('\n❌', err instanceof Error ? err.message : String(err));
      }
      ask();
    });
  };

  ask();
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});