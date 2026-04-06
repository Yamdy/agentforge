#!/usr/bin/env node
import { Command } from 'commander';
import { Agent } from './agent';
import { InMemoryHistory } from './history';
import { ToolRegistry } from './registry';
import { AIAdapter } from './adapters/ai';
import { calculatorTool } from './tools';

const program = new Command();

program
  .name('primo-agent')
  .description('Generic Agent Development Framework')
  .version('0.1.0');

program
  .command('run')
  .option('-p, --prompt <text>', 'Single prompt mode')
  .option('-s, --steps <number>', 'Max steps', '10')
  .action(async (options) => {
    const apiKey = process.env.DOUBAO_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Error: Set DOUBAO_API_KEY or OPENAI_API_KEY');
      process.exit(1);
    }

    const adapter = new AIAdapter({
      model: process.env.MODEL || 'doubao-seed-2.0-code',
      apiKey,
      baseURL: process.env.DOUBAO_BASE_URL || '',
    });
    
    const registry = new ToolRegistry();
    registry.register(calculatorTool);
    adapter.setTools(registry.list());

    const history = new InMemoryHistory();
    const agent = new Agent(adapter, history, registry, { maxSteps: parseInt(options.steps) });

    if (options.prompt) {
      const response = await agent.run(options.prompt);
      console.log(response);
    } else {
      console.log('Interactive mode (Ctrl+C to exit)\n');
      const inquirer = await import('inquirer');
      while (true) {
        const { input } = await inquirer.default.prompt([
          { type: 'input', name: 'input', message: '>' },
        ]);
        const response = await agent.run(input);
        console.log(response);
        console.log();
      }
    }
  });

program.parse();
