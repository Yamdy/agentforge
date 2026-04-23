#!/usr/bin/env npx tsx
/**
 * Code Reviewer - Interactive Chat Mode
 * 
 * Usage:
 *   npx tsx examples/code-reviewer/chat.ts [project-path]
 * 
 * Features:
 *   - Set working directory first
 *   - Then freely ask questions about the codebase
 *   - Multi-turn conversation with context preserved
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from '../../src/agent/index.js';
import { AIAdapter } from '../../src/adapters/ai.js';
import { InMemoryHistory } from '../../src/history.js';
import { ToolRegistry } from '../../src/registry.js';
import { BuiltinTools } from '../../src/tools/builtin/index.js';
import { createLogger } from '../../src/logger/index.js';
import { codeReviewerTools } from './tools/index.js';
import type { StreamEvent } from '../../src/types.js';

const log = createLogger('code-chat');

async function createChatAgent(workDir: string): Promise<Agent> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.DOUBAO_API_KEY || '';
  const baseURL = process.env.DOUBAO_BASE_URL || '';
  const model = process.env.MODEL || 'gpt-4o';

  if (!apiKey) {
    log.warn('No API key. Set OPENAI_API_KEY or DOUBAO_API_KEY.');
  }

  const adapter = new AIAdapter({
    model,
    apiKey,
    baseURL,
    useTools: true,
  });

  const history = new InMemoryHistory();
  const registry = new ToolRegistry();
  registry.register(BuiltinTools);
  registry.register(codeReviewerTools);
  adapter.setTools(registry.list());

  const agent = new Agent(adapter, history, registry, {
    maxSteps: 20,
    systemPrompt: `You are an expert code assistant working in the directory: "${workDir}"

You can:
- Read files (read tool)
- List directories (ls tool)
- Search for patterns (grep tool)
- Find files (find, glob tools)
- Analyze code structure (analyze_structure tool)
- Check code quality (analyze_quality tool)
- Scan for security issues (analyze_security tool)

Help the user understand their codebase. Be concise and helpful.
When answering questions about code, read the relevant files first.`,
  });

  log.info('Chat agent created', { model, workDir });
  return agent;
}

async function chatLoop(agent: Agent, workDir: string): Promise<void> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n💬 Code Chat - Interactive Mode\n');
  console.log(`📁 Working directory: ${workDir}`);
  console.log('📝 Ask any question about your codebase. Type "quit" to exit.\n');
  console.log('─'.repeat(60));

  const ask = () => {
    rl.question('\n🧑 You: ', async (input) => {
      const trimmed = input.trim();
      
      if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
        console.log('\n👋 Goodbye!\n');
        rl.close();
        return;
      }

      if (!trimmed) {
        ask();
        return;
      }

      process.stdout.write('\n🤖 AI: ');
      let response = '';

      try {
        await new Promise<void>((resolve, reject) => {
          agent.runStream(trimmed).subscribe({
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
            complete: () => {
              console.log('\n');
              resolve();
            },
            error: (err) => {
              console.log('\n');
              reject(err);
            },
          });
        });
      } catch (err) {
        console.error('\n❌ Error:', err instanceof Error ? err.message : String(err));
      }

      ask();
    });
  };

  ask();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showHelp = args.includes('--help') || args.includes('-h');

  if (showHelp) {
    console.log(`
💬 Code Chat - Interactive Mode

Usage:
  npx tsx examples/code-reviewer/chat.ts [project-path]

Arguments:
  project-path    Working directory for code exploration (required)

Options:
  --help, -h      Show this help message

Environment Variables:
  DOUBAO_API_KEY    API key
  DOUBAO_BASE_URL   API base URL
  MODEL             Model name (default: gpt-4o)

Examples:
  npx tsx examples/code-reviewer/chat.ts ./src
  npx tsx examples/code-reviewer/chat.ts ../my-project

Once started, you can ask any question:
  - "What is the main entry point?"
  - "Search for Observable usage"
  - "Explain how Agent works"
  - "Run a security scan"
`);
    process.exit(0);
  }

  // Get working directory
  let workDir = args.find((arg) => !arg.startsWith('--'));
  
  if (!workDir) {
    // Default to current directory
    workDir = process.cwd();
  }

  // Resolve to absolute path
  workDir = path.resolve(workDir);

  if (!fs.existsSync(workDir)) {
    console.error(`❌ Directory does not exist: ${workDir}`);
    process.exit(1);
  }

  if (!fs.statSync(workDir).isDirectory()) {
    console.error(`❌ Path is not a directory: ${workDir}`);
    process.exit(1);
  }

  const agent = await createChatAgent(workDir);
  await chatLoop(agent, workDir);
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});