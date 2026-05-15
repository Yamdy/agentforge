#!/usr/bin/env node
import { parseCommand, handleServe, handleRun, handleDev } from './cli.js';

const cmd = parseCommand(process.argv.slice(2));

if (cmd.command === null) {
  console.error('Usage:\n  agentforge serve [--port 3000] [--config .agentforge/config.jsonc] [--api-key xxx]\n  agentforge run --agent <id> --input "text" [--config .agentforge/config.jsonc]\n  agentforge dev [--config .agentforge/config.jsonc] [--port 3000]');
  process.exit(1);
}

switch (cmd.command) {
  case 'serve': handleServe(cmd).catch(e => { console.error('Failed to start:', e); process.exit(1); }); break;
  case 'run': handleRun(cmd).catch(e => { console.error('Failed to run:', e); process.exit(1); }); break;
  case 'dev': handleDev(cmd).catch(e => { console.error('Failed to start dev:', e); process.exit(1); }); break;
}
