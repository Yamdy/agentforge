import pc from 'picocolors';
import { join } from 'node:path';
import { fileService } from '../../services/file.js';
import { envService } from '../../services/env.js';
import { logger } from '../../utils/logger.js';
import { OUTPUT_DIR, DEFAULT_PORT, DEFAULT_HOST } from '../../utils/constants.js';

interface StartOptions {
  dir?: string;
  port?: string;
  env?: string;
}

export async function start(options: StartOptions = {}): Promise<void> {
  const dir = options.dir || OUTPUT_DIR;
  const port = options.port ? parseInt(options.port) : DEFAULT_PORT;
  const host = DEFAULT_HOST;

  logger.info('Starting AgentForge application...');

  const env = envService.loadEnvFile(options.env);

  for (const [key, value] of env.entries()) {
    process.env[key] = value;
  }

  const entryFile = join(dir, 'index.js');

  if (!fileService.exists(entryFile)) {
    logger.error(`Entry file not found: ${entryFile}`);
    logger.error(`Please run 'agentforge build' first`);
    process.exit(1);
  }

  logger.success(pc.green('AgentForge application started!'));
  logger.success(pc.cyan(`  - Listening on: http://${host}:${port}`));
  logger.success(pc.cyan(`  - Serving from: ${dir}`));
  logger.info(pc.gray('  Press Ctrl+C to stop'));

  process.on('SIGINT', () => {
    logger.info('\nShutting down...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('\nShutting down...');
    process.exit(0);
  });
}
