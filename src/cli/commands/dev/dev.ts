import pc from 'picocolors';
import chokidar from 'chokidar';
import type { ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { join } from 'node:path';
import { execa } from 'execa';
import { fileService } from '../../services/file.js';
import { envService } from '../../services/env.js';
import { logger } from '../../utils/logger.js';
import { DEFAULT_DIR, DEFAULT_PORT, DEFAULT_HOST, TEMP_DIR } from '../../utils/constants.js';

let currentServerProcess: ChildProcess | undefined;
let isRestarting = false;
const ON_ERROR_MAX_RESTARTS = 3;

interface DevOptions {
  dir?: string;
  port?: string;
  env?: string;
  inspect?: boolean | string;
}

const startServer = async (
  outputDir: string,
  entryFile: string,
  { port, host }: { port: number; host: string },
  env: Map<string, string>,
  errorRestartCount = 0
) => {
  let serverIsReady = false;
  try {
    isRestarting = false;
    const commands = [];

    const absoluteEntryPath = path.resolve(process.cwd(), entryFile);
    commands.push(absoluteEntryPath);

    currentServerProcess = execa(process.execPath, commands, {
      cwd: process.cwd(),
      env: {
        ...Object.fromEntries(env),
        NODE_ENV: 'development',
        PORT: port.toString(),
      },
      stdio: ['inherit', 'pipe', 'pipe'],
      reject: false,
    }) as any as ChildProcess;

    if (currentServerProcess?.exitCode && currentServerProcess?.exitCode !== 0) {
      if (!currentServerProcess) {
        throw new Error('Server failed to start');
      }
      throw new Error(
        `Server failed to start with error: ${currentServerProcess.stderr || currentServerProcess.stdout}`
      );
    }

    if (currentServerProcess.stdout) {
      currentServerProcess.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        process.stdout.write(output);
      });
    }

    if (currentServerProcess.stderr) {
      currentServerProcess.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        process.stderr.write(output);
      });
    }

    currentServerProcess.on('error', (err: Error) => {
      if ((err as any).code !== 'EPIPE') {
        throw err;
      }
    });

    currentServerProcess.on('exit', (code: number | null) => {
      if (code !== null && code !== 0) {
        logger.warn(`Server exited with code ${code}`);
      }
    });

    serverIsReady = true;
    logger.info(pc.green('Development server ready!'));
    logger.info(pc.cyan(`  - Listening on: http://${host}:${port}`));
    logger.info(pc.cyan(`  - Watching: ${DEFAULT_DIR}`));
    logger.info(pc.gray('  Press Ctrl+C to stop'));
  } catch (err) {
    const execaError = err as { stderr?: string; stdout?: string };
    if (execaError.stderr) {
      logger.error(`Server error output: ${execaError.stderr}`);
    }

    if (!serverIsReady) {
      throw err;
    }

    setTimeout(() => {
      if (!isRestarting) {
        errorRestartCount++;
        if (errorRestartCount > ON_ERROR_MAX_RESTARTS) {
          logger.error(
            `Server failed to start after ${ON_ERROR_MAX_RESTARTS} error attempts. Giving up.`
          );
          process.exit(1);
        }
        logger.warn(
          `Attempting to restart server after error... (Attempt ${errorRestartCount}/${ON_ERROR_MAX_RESTARTS})`
        );
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        startServer(outputDir, entryFile, { port, host }, env, errorRestartCount);
      }
    }, 1000);
  }
};

const restartServer = async (
  outputDir: string,
  entryFile: string,
  { port, host }: { port: number; host: string },
  env: Map<string, string>
) => {
  if (isRestarting) return;

  try {
    logger.info('File change detected, restarting...');

    if (currentServerProcess) {
      currentServerProcess.kill('SIGINT');
    }

    await startServer(outputDir, entryFile, { port, host }, env);
  } finally {
    isRestarting = false;
  }
};

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

  const outputDir = tempDir;
  fileService.ensureDir(outputDir);

  // Copy the entry file to output directory for execution
  const sourceContent = fileService.readFile(entryFile);
  fileService.writeFile(join(outputDir, 'index.js'), sourceContent);

  logger.success(`Watching for changes in ${dir}...`);

  const watcher = chokidar.watch(dir, {
    ignored: /node_modules|\.git/,
    persistent: true,
  });

  const restart = async () => {
    // Rebuild before restart
    const sourceContent = fileService.readFile(entryFile);
    fileService.writeFile(join(outputDir, 'index.js'), sourceContent);
    await restartServer(outputDir, join(outputDir, 'index.js'), { port, host }, env);
  };

  watcher
    .on('add', (path) => {
      logger.debug(`File added: ${path}`);
      restart();
    })
    .on('change', (path) => {
      logger.debug(`File changed: ${path}`);
      restart();
    })
    .on('unlink', (path) => {
      logger.debug(`File removed: ${path}`);
      restart();
    });

  const handleShutdown = async () => {
    logger.info('\nShutting down...');
    if (currentServerProcess) {
      currentServerProcess.kill();
    }
    watcher.close().then(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    handleShutdown().catch(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    handleShutdown().catch(() => process.exit(0));
  });

  await startServer(outputDir, join(outputDir, 'index.js'), { port, host }, env);
}
