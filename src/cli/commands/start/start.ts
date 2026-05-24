import pc from 'picocolors';
import type { ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { join } from 'node:path';
import { execa } from 'execa';
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

  const absoluteEntryPath = path.resolve(process.cwd(), entryFile);

  logger.success(pc.green('AgentForge application started!'));
  logger.success(pc.cyan(`  - Listening on: http://${host}:${port}`));
  logger.success(pc.cyan(`  - Serving from: ${dir}`));
  logger.info(pc.gray('  Press Ctrl+C to stop'));

  const serverProcess: ChildProcess = execa(process.execPath, [absoluteEntryPath], {
    cwd: process.cwd(),
    env: {
      ...Object.fromEntries(env.entries()),
      NODE_ENV: 'production',
      PORT: port.toString(),
    },
    stdio: 'inherit',
    reject: false,
  }) as any as ChildProcess;

  const handleShutdown = () => {
    logger.info('\nShutting down...');
    if (serverProcess) {
      serverProcess.kill();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    handleShutdown();
  });

  process.on('SIGTERM', () => {
    handleShutdown();
  });
}
