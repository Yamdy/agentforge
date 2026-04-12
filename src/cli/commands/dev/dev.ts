import pc from 'picocolors';
import chokidar from 'chokidar';
import { join } from 'node:path';
import { fileService } from '../../services/file.js';
import { envService } from '../../services/env.js';
import { logger } from '../../utils/logger.js';
import { DEFAULT_DIR, DEFAULT_PORT, DEFAULT_HOST, TEMP_DIR } from '../../utils/constants.js';

interface DevOptions {
  dir?: string;
  port?: string;
  env?: string;
  inspect?: boolean | string;
}

export async function dev(options: DevOptions = {}): Promise<void> {
  const dir = options.dir || DEFAULT_DIR;
  const port = options.port ? parseInt(options.port) : DEFAULT_PORT;
  const host = DEFAULT_HOST;

  logger.info('Starting development server...');

  const env = envService.loadEnvFile(options.env);

  for (const [key, value] of env.entries()) {
    process.env[key] = value;
  }

  const tempDir = TEMP_DIR;
  fileService.ensureDir(tempDir);

  const entryFile = join(dir, 'index.ts');

  if (!fileService.exists(entryFile)) {
    logger.error(`Entry file not found: ${entryFile}`);
    logger.error(`Please run 'agentforge init' first or create ${entryFile}`);
    process.exit(1);
  }

  logger.success(`Watching for changes in ${dir}...`);
  logger.success(`Development server starting on http://${host}:${port}`);

  const watcher = chokidar.watch(dir, {
    ignored: /node_modules|\.git/,
    persistent: true,
  });

  let isRestarting = false;

  const restartServer = async () => {
    if (isRestarting) return;
    isRestarting = true;

    logger.info('File change detected, reloading...');

    try {
      logger.success('Server reloaded successfully!');
    } catch (err) {
      logger.error('Failed to reload server:', err);
    } finally {
      isRestarting = false;
    }
  };

  watcher
    .on('add', (path) => {
      logger.debug(`File added: ${path}`);
      restartServer();
    })
    .on('change', (path) => {
      logger.debug(`File changed: ${path}`);
      restartServer();
    })
    .on('unlink', (path) => {
      logger.debug(`File removed: ${path}`);
      restartServer();
    });

  process.on('SIGINT', () => {
    logger.info('\nShutting down...');
    watcher.close().then(() => {
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    logger.info('\nShutting down...');
    watcher.close().then(() => {
      process.exit(0);
    });
  });

  logger.info(pc.green('Development server ready!'));
  logger.info(pc.cyan(`  - Listening on: http://${host}:${port}`));
  logger.info(pc.cyan(`  - Watching: ${dir}`));
  logger.info(pc.gray('  Press Ctrl+C to stop'));
}
