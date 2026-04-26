/**
 * Post-install steps for create-agentforge CLI.
 *
 * Handles git init, npm install, and prettier formatting
 * after project generation is complete.
 */

import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import type { PromptsConfig } from './config.js';

/**
 * Initialize a git repository in the target directory.
 *
 * Runs `git init`, stages all files, and creates an initial commit.
 * Throws a descriptive error if git is not installed.
 */
export function initGit(targetDir: string): void {
  console.log(chalk.blue('  → Initializing git repository...'));

  try {
    execFileSync('git', ['init'], { cwd: targetDir, stdio: 'pipe' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run 'git init': ${msg}. Is git installed?`);
  }

  try {
    execFileSync('git', ['add', '.'], { cwd: targetDir, stdio: 'pipe' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run 'git add': ${msg}`);
  }

  try {
    execFileSync(
      'git',
      ['commit', '-m', 'Initial commit from create-agentforge', '--no-gpg-sign'],
      {
        cwd: targetDir,
        stdio: 'pipe',
      }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create initial commit: ${msg}`);
  }

  console.log(chalk.green('  ✓ Git repository initialized'));
}

/**
 * Install npm dependencies in the target directory.
 *
 * Runs `npm install` and throws on failure.
 */
export function installDeps(targetDir: string): void {
  console.log(chalk.blue('  → Installing dependencies...'));

  try {
    execFileSync('npm', ['install'], { cwd: targetDir, stdio: 'pipe' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run 'npm install': ${msg}`);
  }

  console.log(chalk.green('  ✓ Dependencies installed'));
}

/**
 * Format generated TypeScript files with Prettier.
 *
 * Best-effort: logs a warning on failure but does not throw.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async for API contract consistency
export async function formatWithPrettier(targetDir: string): Promise<void> {
  console.log(chalk.blue('  → Formatting code with Prettier...'));

  try {
    execFileSync('npx', ['prettier', '--write', 'src/**/*.ts'], {
      cwd: targetDir,
      stdio: 'pipe',
    });
    console.log(chalk.green('  ✓ Code formatted'));
  } catch {
    // Best-effort: warn but don't abort
    console.log(
      chalk.yellow('  ⚠ Prettier formatting failed (non-critical). You can run it manually later.')
    );
  }
}

/**
 * Run all post-install steps in order.
 *
 * 1. Git init (if enabled)
 * 2. npm install (always)
 * 3. Prettier formatting (best-effort)
 */
export async function runPostInstall(config: PromptsConfig, targetDir: string): Promise<void> {
  console.log(chalk.cyan('\n📦 Running post-install steps...\n'));

  // Step 1: Git init
  if (config.gitInit) {
    initGit(targetDir);
  } else {
    console.log(chalk.yellow('  ⊘ Skipping git init (--no-git)'));
  }

  // Step 2: npm install
  installDeps(targetDir);

  // Step 3: Prettier (best-effort)
  await formatWithPrettier(targetDir);

  console.log(chalk.green('\n✅ Post-install steps complete!\n'));
}
