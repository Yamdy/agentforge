#!/usr/bin/env node
import 'dotenv/config';
import { Agent } from '../agent';
import { InMemoryHistory } from '../history';
import { ToolRegistry } from '../registry';
import { AIAdapter } from '../adapters/ai';
import { calculatorTool, searchTool, allTools } from '../tools';
import { BuiltinTools } from '../tools/builtin';
import { startServer, createApp } from '../server';
import { createAgentForgeClient, type StreamEvent } from '../sdk/client';
import { createLogger } from '../logger';
import { createSessionAPI } from '../session';
import { MCP, SubAgent } from '../index.js';
import { Skill } from '../skill/index.js';

const log = createLogger('demo');

const apiKey = process.env.DOUBAO_API_KEY || process.env.OPENAI_API_KEY || '';
const baseURL = process.env.DOUBAO_BASE_URL || '';
const model = process.env.MODEL || 'doubao-seed-2.0-code';
const serverPort = parseInt(process.env.PORT || '3000');
const serverApiKey = process.env.SERVER_API_KEY || '';

export async function createAgent(
  useMcp: boolean = true,
  useSkill: boolean = true,
  useSubagent: boolean = true
): Promise<Agent> {
  const adapter = new AIAdapter({
    model,
    apiKey,
    baseURL,
    useTools: true,
  });
  const history = new InMemoryHistory();
  const registry = new ToolRegistry();

  // 注册所有内置工具
  registry.register(calculatorTool);
  registry.register(searchTool);
  registry.register(BuiltinTools);

  // 如果启用子代理，注册子代理工具
  if (useSubagent) {
    console.log('Initializing SubAgent...');
    try {
      const subAgents = SubAgent.list();
      if (subAgents.length > 0) {
        console.log(`Loaded ${subAgents.length} SubAgents`);
      }
      registry.register(SubAgent.createDelegateToSubAgentTool());
      registry.register(SubAgent.createListSubAgentsTool());
    } catch (err) {
      console.warn('SubAgent initialization failed:', err);
    }
  }

  // 如果启用 SKILL，注册 SKILL 工具
  if (useSkill) {
    console.log('Initializing SKILL...');
    try {
      await Skill.discover();
      const skills = Skill.list();
      if (skills.length > 0) {
        console.log(`Loaded ${skills.length} SKILLs`);
      }
      registry.register(Skill.createLoadSkillTool());
      registry.register(Skill.createListSkillsTool());
    } catch (err) {
      console.warn('SKILL initialization failed:', err);
    }
  }

  // 如果启用 MCP，加载 MCP 工具
  if (useMcp) {
    console.log('Initializing MCP...');
    try {
      await MCP.client.init();
      await MCP.Toolkit.refreshTools();
      const mcpTools = MCP.Toolkit.getTools(['basic']);
      if (mcpTools.length > 0) {
        console.log(`Loaded ${mcpTools.length} MCP tools`);
        registry.register(mcpTools);
      }
    } catch (err) {
      console.warn('MCP initialization failed:', err);
    }
  }

  adapter.setTools(registry.list());

  return new Agent(adapter, history, registry);
}

async function runServer() {
  if (!apiKey) {
    console.error('Error: Set DOUBAO_API_KEY environment variable');
    process.exit(1);
  }

  const useMcp = process.env.USE_MCP !== 'false';
  const useSkill = process.env.USE_SKILL !== 'false';
  const useSubagent = process.env.USE_SUBAGENT !== 'false';
  const agent = await createAgent(useMcp, useSkill, useSubagent);

  console.log('=== AgentForge Server ===');
  console.log('Port:', serverPort);
  console.log('API Key:', serverApiKey ? 'configured' : 'none');
  console.log('Model:', model);
  console.log('MCP:', useMcp ? 'enabled' : 'disabled');
  console.log('Skill:', useSkill ? 'enabled' : 'disabled');
  console.log('SubAgent:', useSubagent ? 'enabled' : 'disabled');
  console.log('Tools: calculator, web_search, read, write, ls, bash');
  if (useMcp) {
    console.log('       + MCP tools (if configured)');
  }
  if (useSkill) {
    console.log('       + Skill tools');
  }
  if (useSubagent) {
    console.log('       + SubAgent tools');
  }
  console.log('');

  await startServer({
    port: serverPort,
    apiKey: serverApiKey || undefined,
    agent,
  });

  log.info('Server running', { port: serverPort });
}

async function runClient(prompt?: string) {
  const baseUrl = process.env.SERVER_URL || `http://localhost:${serverPort}`;
  const apiKey = process.env.CLIENT_API_KEY || serverApiKey;

  const client = createAgentForgeClient({ baseUrl, apiKey });

  if (prompt) {
    console.log('=== AgentForge Client ===');
    console.log('Server:', baseUrl);
    console.log('Input:', prompt);
    console.log('\nAgent: ');

    try {
      for await (const event of client.runStream(prompt)) {
        if (event.type === 'text' && event.content) {
          process.stdout.write(event.content);
        }
        if (event.type === 'tool_call_start' && event.name) {
          process.stdout.write(`\n[Calling ${event.name}...]`);
        }
        if (event.type === 'tool_call_end' && event.result) {
          process.stdout.write(` => ${event.result}`);
        }
      }
      console.log('\n\n[Completed]');
    } catch (err) {
      console.error('\nError:', err);
      process.exit(1);
    }
    return;
  }

  console.log('=== AgentForge Client ===');
  console.log('Server:', baseUrl);
  console.log('Type your question (Ctrl+C to exit)\n');

  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question('> ', async (input) => {
      if (!input.trim()) {
        ask();
        return;
      }

      process.stdout.write('\nAgent: ');

      try {
        for await (const event of client.runStream(input)) {
          if (event.type === 'text' && event.content) {
            process.stdout.write(event.content);
          }
          if (event.type === 'tool_call_start' && event.name) {
            process.stdout.write(`\n[Calling ${event.name}...]`);
          }
          if (event.type === 'tool_call_end' && event.result) {
            process.stdout.write(` => ${event.result}`);
          }
        }
        console.log('\n[Stream completed]');
      } catch (err) {
        console.error('\nError:', err);
      }

      ask();
    });
  };

  ask();
}

async function runWeb() {
  console.log('=== Primo Agent Web UI ===');
  console.log('Web Port: 8080');
  console.log('Agent API: http://localhost:3000');
  console.log('Open http://localhost:8080 in your browser\n');

  const { readFileSync, existsSync } = await import('fs');
  const { join } = await import('path');

  const htmlPath = join(process.cwd(), 'src/examples/web-ui.html');
  const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf-8') : '<h1>Web UI not found</h1>';

  const httpModule = await import('http');
  const server = httpModule.createServer((nodeReq: any, nodeRes: any) => {
    const url = nodeReq.url || '/';

    if (url === '/' || url === '/index.html') {
      nodeRes.writeHead(200, { 'Content-Type': 'text/html' });
      nodeRes.end(html);
      return;
    }

    // Proxy API requests to Agent Server
    if (url.startsWith('/api/')) {
      const proxyReq = httpModule.request(
        {
          hostname: 'localhost',
          port: 3000,
          path: url,
          method: nodeReq.method,
          headers: nodeReq.headers,
        },
        (proxyRes) => {
          nodeRes.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          proxyRes.pipe(nodeRes, { end: true });
        }
      );

      nodeReq.pipe(proxyReq, { end: true });
      return;
    }

    nodeRes.writeHead(404);
    nodeRes.end('Not Found');
  });

  return new Promise((resolve: (server: any) => void) => {
    server.listen(8080, () => {
      console.log('Web UI running at http://localhost:8080');
      resolve(server);
    });
  });
}

async function runE2eTest() {
  if (!apiKey) {
    console.error('Error: Set DOUBAO_API_KEY environment variable');
    process.exit(1);
  }

  const agent = await createAgent();

  console.log('=== Primo Agent E2E Test ===\n');

  const testCases = [
    { input: 'Calculate 123 + 456', expect: '579' },
    { input: 'What is 10 multiplied by 20?', expect: '200' },
  ];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    console.log(`Test: "${tc.input}"`);

    try {
      const result = await agent.run(tc.input);
      const containsExpected = result.includes(tc.expect);

      if (containsExpected) {
        console.log(`  ✓ Passed (contains "${tc.expect}")`);
        passed++;
      } else {
        console.log(`  ✗ Failed (expected "${tc.expect}", got: ${result})`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err}`);
      failed++;
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Passed: ${passed}/${testCases.length}`);
  console.log(`Failed: ${failed}/${testCases.length}`);

  process.exit(failed > 0 ? 1 : 0);
}

async function main() {
  const mode = process.argv[2] || 'interactive';
  const input = process.argv[3];

  switch (mode) {
    case 'server':
      await runServer();
      break;
    case 'client':
      await runClient(input);
      break;
    case 'web':
      await runWeb();
      break;
    case 'e2e':
      await runE2eTest();
      break;
    case 'interactive':
    default:
      await runInteractive(!!apiKey, input);
      break;
  }
}

async function runInteractive(hasApiKey: boolean, input?: string) {
  if (!hasApiKey) {
    await runClient(input);
    return;
  }

  const sessionApi = createSessionAPI();
  await sessionApi.init();

  let currentSession = await sessionApi.create({ title: 'New Chat' });
  console.log('Session created:', currentSession.id);

  const useMcp = process.env.USE_MCP !== 'false';
  const useSkill = process.env.USE_SKILL !== 'false';
  const useSubagent = process.env.USE_SUBAGENT !== 'false';
  const agent = await createAgent(useMcp, useSkill, useSubagent);

  console.log('=== Primo Agent Demo (@ai-sdk) ===');
  console.log('Model:', model);
  console.log('MCP:', useMcp ? 'enabled' : 'disabled');
  console.log('Skill:', useSkill ? 'enabled' : 'disabled');
  console.log('SubAgent:', useSubagent ? 'enabled' : 'disabled');
  console.log('Tools: calculator, web_search, read, write, ls, bash');
  if (useMcp) {
    console.log('       + MCP tools (if configured)');
  }
  if (useSkill) {
    console.log('       + Skill tools');
  }
  if (useSubagent) {
    console.log('       + SubAgent tools');
  }
  console.log('Session:', currentSession.id);
  console.log('Type your question (Ctrl+C to exit)\n');

  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('> ', async (inp) => {
      if (!inp.trim()) {
        prompt();
        return;
      }

      process.stdout.write('\nAgent: ');

      try {
        let responseText = '';
        agent
          .runStream(inp, {
            onText: (text) => {
              if (text) process.stdout.write(text);
              responseText += text;
            },
            onToolCallStart: (_id, name) => {
              process.stdout.write(`\n[Calling ${name}...]`);
            },
            onToolCallEnd: (_id, result) => {
              if (result) process.stdout.write(` => ${result}`);
              process.stdout.write('\n[Tool completed]');
            },
            onStep: (step, maxSteps) => {
              process.stdout.write(`\n[Step ${step}/${maxSteps}]`);
            },
          })
          .subscribe({
            complete: () => {
              console.log('\n[Stream completed]');
            },
          });

        await sessionApi.addMessage(currentSession.id, { role: 'user', content: inp });
        await sessionApi.addMessage(currentSession.id, {
          role: 'assistant',
          content: responseText,
        });
        console.log('[Message saved to session]');
      } catch (err) {
        console.error('\nError:', err);
      }

      prompt();
    });
  };

  prompt();
}

main();
