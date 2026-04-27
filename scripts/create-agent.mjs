#!/usr/bin/env node

/**
 * create-agentforge - Quick scaffold for AgentForge agents
 *
 * Usage:
 *   node scripts/create-agent.mjs my-agent
 *   node scripts/create-agent.mjs my-agent --provider anthropic
 *   node scripts/create-agent.mjs my-agent --provider deepseek --model deepseek-chat
 */

import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// Parse args
// ============================================================

const args = process.argv.slice(2);
const projectName = args[0];
const flags = {};

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--provider' && args[i + 1]) {
    flags.provider = args[++i];
  } else if (args[i] === '--model' && args[i + 1]) {
    flags.model = args[++i];
  } else if (args[i] === '--playground' || args[i] === '-p') {
    flags.playground = true;
  } else if (args[i] === '--yes' || args[i] === '-y') {
    flags.yes = true;
  }
}

if (!projectName) {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║           create-agentforge - Quick Scaffold             ║
╚══════════════════════════════════════════════════════════╝

Usage:
  npx create-agentforge <project-name> [options]

Options:
  --provider <name>   LLM provider: openai | anthropic | deepseek (default: openai)
  --model <name>      Model name (default: gpt-4o-mini)
  --playground, -p    Include playground server + UI
  --yes, -y           Skip confirmation

Examples:
  npx create-agentforge my-agent
  npx create-agentforge my-agent --playground
  npx create-agentforge my-agent --provider deepseek --model deepseek-chat
  npx create-agentforge my-agent --provider anthropic --model claude-3-5-sonnet --playground
`);
  process.exit(0);
}

// ============================================================
// Defaults
// ============================================================

const provider = flags.provider || 'openai';
const model = flags.model || getDefaultModel(provider);

function getDefaultModel(p) {
  const defaults = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet',
    deepseek: 'deepseek-chat',
  };
  return defaults[p] || 'gpt-4o-mini';
}

const envVarName = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
}[provider] || 'LLM_API_KEY';

const baseUrl = {
  openai: '',
  anthropic: '',
  deepseek: 'https://api.deepseek.com',
}[provider] || '';

const includePlayground = flags.playground || false;

// ============================================================
// Create project
// ============================================================

const targetDir = resolve(process.cwd(), projectName);

if (existsSync(targetDir)) {
  console.error(`❌ Directory already exists: ${targetDir}`);
  process.exit(1);
}

console.log(`
╔══════════════════════════════════════════════════════════╗
║           🚀 Creating AgentForge Project                 ║
╚══════════════════════════════════════════════════════════╝

  Name:       ${projectName}
  Provider:   ${provider}
  Model:      ${model}
  Playground: ${includePlayground ? 'Yes' : 'No'}
  Dir:        ${targetDir}
`);

mkdirSync(targetDir, { recursive: true });

// ============================================================
// package.json
// ============================================================

const scripts = {
  dev: 'node --watch main.mjs',
  start: 'node main.mjs',
  build: 'echo "No build step needed for .mjs files"',
};

if (includePlayground) {
  scripts['dev'] = 'node --watch server.mjs';
  scripts['playground'] = 'node server.mjs';
  scripts['start'] = 'node server.mjs';
}

writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
  name: projectName,
  version: '1.0.0',
  type: 'module',
  scripts,
  dependencies: {
    '@primo512109/agentforge': 'latest',
    dotenv: '^16.4.0',
    zod: '^3.23.0',
  },
}, null, 2) + '\n');

// ============================================================
// .env
// ============================================================

writeFileSync(join(targetDir, '.env'), `# Get your API key from the provider's dashboard
${envVarName}=your-api-key-here
${baseUrl ? `LLM_BASE_URL=${baseUrl}\n` : ''}`);

// ============================================================
// tools.mjs
// ============================================================

writeFileSync(join(targetDir, 'tools.mjs'), `import { tool } from '@primo512109/agentforge/quickstart';
import { z } from 'zod';

/**
 * Example tool: Get current time
 */
export const getTimeTool = tool({
  description: 'Get the current date and time',
  parameters: z.object({}),
  execute: async () => {
    return { now: new Date().toISOString() };
  },
});

/**
 * Example tool: Calculator
 */
export const calculatorTool = tool({
  description: 'Evaluate a math expression',
  parameters: z.object({
    expression: z.string().describe('Math expression to evaluate, e.g. "2 + 2"'),
  }),
  execute: async (args) => {
    try {
      const result = Function(\`"use strict"; return (\${args.expression})\`)();
      return { result };
    } catch (e) {
      return { error: e.message };
    }
  },
});
`);

// ============================================================
// main.mjs
// ============================================================

writeFileSync(join(targetDir, 'main.mjs'), `import 'dotenv/config';
import { Agent } from '@primo512109/agentforge/quickstart';
import { getTimeTool, calculatorTool } from './tools.mjs';

// ============================================================
// Create Agent
// ============================================================

const agent = new Agent({
  name: '${projectName}',
  model: '${provider}/${model}',
  apiKey: process.env.${envVarName},
  ${baseUrl ? `baseUrl: process.env.LLM_BASE_URL,` : ''}
  systemPrompt: \`You are a helpful AI assistant.

You have access to the following tools:
- getTime: Get the current date and time
- calculator: Evaluate math expressions

Always be concise and helpful.\`,
  tools: {
    getTime: getTimeTool,
    calculator: calculatorTool,
  },
  maxSteps: 10,
});

// ============================================================
// Run
// ============================================================

async function main() {
  const input = process.argv[2] || 'What time is it? Calculate 42 * 17 for me.';

  console.log(\`
╔══════════════════════════════════════════════════════════╗
║  🤖 \${agent.constructor.name} Running                   ║
╚══════════════════════════════════════════════════════════╝

  Input: \${input}
  Model: ${provider}/${model}
  Tools: getTime, calculator
\`);

  console.log('⏳ Thinking...\\n');

  const result = await agent.generate(input);

  console.log('────────────────────────────────────────');
  console.log(result.text);
  console.log('────────────────────────────────────────');
  console.log('\\n✅ Done!');
}

main().catch(console.error);
`);

// ============================================================
// Playground (optional)
// ============================================================

if (includePlayground) {
  // server.mjs
  writeFileSync(join(targetDir, 'server.mjs'), `import http from 'node:http';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { createAgent } from '@primo512109/agentforge';
import { createOpenAIHttpAdapter } from '@primo512109/agentforge/adapters';
import { getTimeTool, calculatorTool } from './tools.mjs';
import { z } from 'zod';

const PORT = process.env.PORT || 3000;
const LLM_API_KEY = process.env.${envVarName};
const LLM_BASE_URL = process.env.LLM_BASE_URL || '${baseUrl || 'https://api.openai.com/v1'}';
const LLM_MODEL = process.env.LLM_MODEL || '${model}';

if (!LLM_API_KEY) {
  console.error('❌ ${envVarName} environment variable is required');
  process.exit(1);
}

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = nodePath.join(__dirname, 'sessions.json');

// Session Store
class SessionStore {
  constructor() { this.sessions = new Map(); this.load(); }
  load() {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
        for (const s of data) this.sessions.set(s.id, s);
      }
    } catch {}
  }
  save() {
    try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Array.from(this.sessions.values()), null, 2)); } catch {}
  }
  create(title) {
    const s = { id: randomUUID(), title: title || \`Session \${this.sessions.size + 1}\`, messages: [], events: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.sessions.set(s.id, s); this.save(); return s;
  }
  get(id) { return this.sessions.get(id) || null; }
  list() { return Array.from(this.sessions.values()).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); }
  addMessage(id, msg) {
    const s = this.sessions.get(id); if (!s) return null;
    s.messages.push({ id: randomUUID(), ...msg, timestamp: new Date().toISOString() });
    s.updatedAt = new Date().toISOString();
    if (msg.role === 'user' && s.messages.length === 1) s.title = msg.content.substring(0, 50);
    this.save(); return s;
  }
  addEvent(id, event) { const s = this.sessions.get(id); if (s) s.events.push({ ...event, timestamp: Date.now() }); }
  delete(id) { const r = this.sessions.delete(id); if (r) this.save(); return r; }
  clear(id) { const s = this.sessions.get(id); if (!s) return null; s.messages = []; s.events = []; s.updatedAt = new Date().toISOString(); this.save(); return s; }
}

const sessions = new SessionStore();

// Tools
const tools = [getTimeTool, calculatorTool].map(t => ({
  ...t,
  execute: async (args) => {
    try { const r = await t.execute(args); return typeof r === 'string' ? r : JSON.stringify(r); }
    catch (e) { return \`Error: \${e.message}\`; }
  }
}));

function createAgentForSession(sessionId) {
  const llmAdapter = createOpenAIHttpAdapter(LLM_MODEL, { apiKey: LLM_API_KEY, baseURL: LLM_BASE_URL });
  return createAgent({
    name: \`agent-\${sessionId}\`,
    model: { provider: 'openai', model: LLM_MODEL },
    llmAdapter,
    systemPrompt: 'You are a helpful AI assistant. Use the provided tools when appropriate.',
    maxSteps: 10,
    tools,
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, \`http://localhost:\${PORT}\`);
  const urlPath = url.pathname;

  try {
    if (urlPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (urlPath === '/' || urlPath === '/index.html') {
      const html = fs.readFileSync(nodePath.join(__dirname, 'playground.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return;
    }
    if (urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: sessions.list().length })); return;
    }
    if (urlPath === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: LLM_MODEL, baseUrl: LLM_BASE_URL, maxSteps: 10, tools: tools.map(t => ({ name: t.name, description: t.description })) })); return;
    }
    if (urlPath === '/api/sessions' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions.list())); return;
    }
    if (urlPath === '/api/sessions' && req.method === 'POST') {
      const body = await readBody(req); const { title } = JSON.parse(body || '{}');
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions.create(title))); return;
    }
    const sessionMatch = urlPath.match(/^\\/api\\/sessions\\/([^/]+)$/);
    if (sessionMatch && req.method === 'GET') {
      const s = sessions.get(sessionMatch[1]);
      if (!s) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(s)); return;
    }
    if (sessionMatch && req.method === 'DELETE') {
      sessions.delete(sessionMatch[1]); res.writeHead(204); res.end(); return;
    }
    const clearMatch = urlPath.match(/^\\/api\\/sessions\\/([^/]+)\\/clear$/);
    if (clearMatch && req.method === 'POST') {
      const s = sessions.clear(clearMatch[1]);
      if (!s) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(s)); return;
    }
    const streamMatch = urlPath.match(/^\\/api\\/sessions\\/([^/]+)\\/chat\\/stream$/);
    if (streamMatch && req.method === 'POST') {
      const sessionId = streamMatch[1]; const session = sessions.get(sessionId);
      if (!session) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
      const body = await readBody(req); const { message } = JSON.parse(body);
      if (!message) { res.writeHead(400); res.end(JSON.stringify({ error: 'message required' })); return; }
      sessions.addMessage(sessionId, { role: 'user', content: message });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const agent = createAgentForSession(sessionId);
      let fullResponse = ''; let ended = false;
      agent.stream(message, {
        onEvent: (event) => { if (ended) return; sessions.addEvent(sessionId, event); try { res.write(\`data: \${JSON.stringify(event)}\\n\\n\`); } catch {} },
        onText: (delta) => { fullResponse += delta; },
        onComplete: (result) => { if (ended) return; ended = true; fullResponse = result || fullResponse; sessions.addMessage(sessionId, { role: 'assistant', content: fullResponse }); try { res.write(\`data: \${JSON.stringify({ type: 'done', reason: 'stop' })}\\n\\n\`); res.end(); } catch {} },
        onError: (err) => { if (ended) return; ended = true; try { res.write(\`data: \${JSON.stringify({ type: 'error', error: err.message })}\\n\\n\`); res.end(); } catch {} },
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(\`
╔══════════════════════════════════════════════════════════╗
║              AgentForge Playground v1.0                   ║
╠══════════════════════════════════════════════════════════╣
║  http://localhost:\${PORT}                                  ║
╚══════════════════════════════════════════════════════════╝
Model: \${LLM_MODEL}
  \`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => resolve(body)); req.on('error', reject);
  });
}
`);

  // Copy playground.html from agentforge source
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const playgroundHtmlSource = resolve(__dirname, 'playground.html');
  if (existsSync(playgroundHtmlSource)) {
    copyFileSync(playgroundHtmlSource, join(targetDir, 'playground.html'));
  } else {
    console.warn('⚠️  playground.html not found at:', playgroundHtmlSource);
  }
}

// ============================================================
// .gitignore
// ============================================================

writeFileSync(join(targetDir, '.gitignore'), `node_modules/
.env
`);

// ============================================================
// Done
// ============================================================

const files = ['package.json', 'main.mjs', 'tools.mjs', '.env', '.gitignore'];
if (includePlayground) files.push('server.mjs', 'playground.html');

console.log(`✅ Project created!

📁 Files:
  ${files.join('\n  ')}

📝 Next steps:

  cd ${projectName}
  npm install
  # Edit .env and add your ${envVarName}
${includePlayground ? '  npm run playground  # Start playground at http://localhost:3000' : '  npm run dev'}
`);
