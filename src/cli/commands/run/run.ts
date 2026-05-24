import * as p from '@clack/prompts';
import pc from 'picocolors';
import { loadConfig } from '../../../config/loader.js';
import { createAgent } from '../../../agent/factory.js';
import { logger } from '../../utils/logger.js';

interface RunOptions {
  agent?: string;
  workflow?: string;
  prompt?: string;
  interactive?: boolean;
}

export async function run(options: RunOptions = {}): Promise<void> {
  // Load configuration from file
  const config = await loadConfig().catch(() => null);

  if (!config) {
    logger.error('Error: No agentforge.config.json found in current directory');
    process.exit(1);
  }

  // Create agent from config
  const s = p.spinner();
  s.start('Creating agent from configuration...');
  const agent = await createAgent(config);
  s.stop('Agent created');

  if (config.agent.systemPrompt) {
    logger.info(`System prompt loaded: ${config.agent.systemPrompt.slice(0, 50)}...`);
  }

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
