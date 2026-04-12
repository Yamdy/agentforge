import * as p from '@clack/prompts';
import pc from 'picocolors';
import { Agent } from '../../../agent/index.js';
import { InMemoryHistory } from '../../../history.js';
import { ToolRegistry } from '../../../registry.js';
import { AIAdapter } from '../../../adapters/ai.js';
import { calculatorTool, searchTool, allTools } from '../../../tools/index.js';
import { logger } from '../../utils/logger.js';

interface RunOptions {
  agent?: string;
  workflow?: string;
  prompt?: string;
  interactive?: boolean;
}

export async function run(options: RunOptions = {}): Promise<void> {
  const apiKey = process.env.DOUBAO_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logger.error('Error: Set DOUBAO_API_KEY or OPENAI_API_KEY');
    process.exit(1);
  }

  const model = process.env.MODEL || 'doubao-seed-2.0-code';
  const baseURL = process.env.DOUBAO_BASE_URL || '';

  const adapter = new AIAdapter({
    model,
    apiKey,
    baseURL,
  });

  const registry = new ToolRegistry();
  registry.register(calculatorTool);
  registry.register(searchTool);
  for (const tool of allTools) {
    registry.register(tool);
  }
  adapter.setTools(registry.list());

  const history = new InMemoryHistory();
  const agent = new Agent(adapter, history, registry, { maxSteps: 10 });

  if (options.prompt) {
    const s = p.spinner();
    s.start('Running agent...');
    try {
      const response = await agent.run(options.prompt);
      s.stop('Complete!');
      console.log('\n' + pc.green('Response:') + '\n');
      console.log(response);
    } catch (err) {
      s.stop(pc.inverse(' Error '));
      logger.error('Failed to run agent:', err);
      process.exit(1);
    }
  } else {
    console.log(pc.bold(pc.cyan('\nInteractive mode (Ctrl+C to exit)\n')));

    while (true) {
      const inputResult = await p.text({
        message: '>',
        validate: (value) => {
          if (!value) return 'Please enter a message';
          return;
        },
      });

      if (p.isCancel(inputResult)) {
        console.log(pc.yellow('\nGoodbye!'));
        process.exit(0);
      }

      const input = inputResult as string;

      const s = p.spinner();
      s.start('Thinking...');

      try {
        const response = await agent.run(input as string);
        s.stop('Done!');
        console.log('\n' + pc.green('Response:') + '\n');
        console.log(response);
        console.log();
      } catch (err) {
        s.stop(pc.inverse(' Error '));
        logger.error('Failed to run agent:', err);
        console.log();
      }
    }
  }
}
