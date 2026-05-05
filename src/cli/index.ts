#!/usr/bin/env node

/**
 * CLI entry point for create-agentforge.
 *
 * Uses Commander to parse CLI arguments, then optionally runs
 * interactive prompts, validates config, generates the project,
 * and runs post-install steps.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import type { PromptsConfig, LLMProvider, APIMode, Preset } from './config.js';
import { DEFAULT_CONFIG, validateConfig } from './config.js';
import { collectPrompts, mergeCliArgs } from './prompts.js';
import { generateProject } from './generator.js';
import type { GenerateOptions } from './generator.js';
import { runPostInstall } from './post-install.js';
import { runDemo } from './demo.js';

/**
 * Main CLI action: parse args → collect config → generate → post-install.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async for API contract consistency
export async function main(): Promise<void> {
  const program = new Command();

  program
    .name('create-agentforge')
    .description('Scaffold a new AgentForge agent project')
    .version('0.1.0')
    .argument('[name]', 'Project name')
    .option('--default', 'Skip prompts and use all defaults')
    .option('--llm <provider>', 'LLM provider (openai|anthropic|deepseek|mock)')
    .option('--model <model>', 'LLM model override')
    .option('--api-mode <mode>', 'API mode (simple|advanced)')
    .option('--preset <preset>', 'Configuration preset (production|debug|test)')
    .option('--tools', 'Enable tool system')
    .option('--checkpoint', 'Enable checkpoint persistence')
    .option('--observability', 'Enable observability')
    .option('--hitl', 'Enable human-in-the-loop')
    .option('--plugins', 'Enable plugin system')
    .option('--compaction', 'Enable memory compaction')
    .option('--subagent', 'Enable sub-agent delegation')
    .option('--mcp', 'Enable MCP client')
    .option('--deploy', 'Include Docker deployment templates and scripts')
    .option('--dry-run', 'Preview files without creating')
    .option('--skip-install', 'Skip npm install')
    .option('--force', 'Overwrite existing directory')
    .option('--no-git', 'Skip git init')
    .action(async (name: string | undefined, opts: Record<string, unknown>) => {
      try {
        await runAction(name, opts);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ Error: ${message}\n`));
        process.exit(1);
      }
    });

  program
    .command('demo')
    .description('Run a 30-second Harness demo — no API key required')
    .action(async () => {
      try {
        await runDemo();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ Demo failed: ${message}\n`));
        process.exit(1);
      }
    });

  program.parse();
}

/**
 * Core action logic, separated for testability.
 */
export async function runAction(
  projectName: string | undefined,
  opts: Record<string, unknown>
): Promise<void> {
  // 1. Build CLI overrides from options
  const cliOverrides: Partial<PromptsConfig> = {};

  if (typeof projectName === 'string' && projectName.trim()) {
    cliOverrides.projectName = projectName.trim();
  }

  if (typeof opts.llm === 'string') {
    cliOverrides.llm = opts.llm as LLMProvider;
  }
  if (typeof opts.model === 'string') {
    cliOverrides.llmModel = opts.model;
  }
  if (typeof opts.apiMode === 'string') {
    cliOverrides.apiMode = opts.apiMode as APIMode;
  }
  if (typeof opts.preset === 'string') {
    cliOverrides.preset = opts.preset as Preset;
  }
  if (opts.tools === true) {
    cliOverrides.tools = true;
    cliOverrides.toolList = ['weather'];
  }
  if (opts.checkpoint === true) {
    cliOverrides.checkpoint = true;
    cliOverrides.checkpointStorage = 'sqlite';
  }
  if (opts.observability === true) {
    cliOverrides.observability = true;
  }
  if (opts.hitl === true) {
    cliOverrides.hitl = true;
  }
  if (opts.plugins === true) {
    cliOverrides.plugins = true;
  }
  if (opts.compaction === true) {
    cliOverrides.compaction = true;
  }
  if (opts.subagent === true) {
    cliOverrides.subagent = true;
  }
  if (opts.mcp === true) {
    cliOverrides.mcp = true;
  }
  if (opts.deploy === true) {
    cliOverrides.deployment = true;
  }
  if (typeof opts.gitInit === 'boolean') {
    cliOverrides.gitInit = opts.gitInit;
  }

  // 2. Validate CLI overrides early
  const mergedOverrides = mergeCliArgs(cliOverrides);
  const earlyValidation = validateConfig(mergedOverrides);
  if (!earlyValidation.valid && mergedOverrides.projectName) {
    // Only validate if project name was provided via CLI
    // (prompts may fix issues later)
    throw new Error(earlyValidation.errors.join('\n'));
  }

  // 3. Collect config (from prompts or defaults)
  let config: PromptsConfig;

  if (opts.default) {
    // --default mode: merge CLI overrides with defaults
    config = {
      ...DEFAULT_CONFIG,
      ...mergedOverrides,
      projectName: mergedOverrides.projectName || '',
      agentName: mergedOverrides.agentName || mergedOverrides.projectName || '',
    };
  } else {
    // Interactive mode: prompt for missing fields
    config = await collectPrompts(mergedOverrides);
  }

  // 4. Final validation
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`);
  }

  // 5. Determine target directory
  const targetDir = config.projectName;

  // 6. Generate project
  const generateOptions: GenerateOptions = {
    dryRun: opts.dryRun === true,
    skipInstall: opts.skipInstall === true,
    force: opts.force === true,
  };

  console.log(chalk.cyan(`\n🚀 Creating AgentForge project: ${config.projectName}\n`));

  const result = await generateProject(config, targetDir, generateOptions);

  if (generateOptions.dryRun) {
    console.log(chalk.yellow('\n📄 Dry run — files that would be created:\n'));
    for (const file of result.files) {
      console.log(chalk.white(`  ${file.path} — ${file.description}`));
    }
    console.log(chalk.yellow(`\n  Total: ${result.files.length} files\n`));
    return;
  }

  console.log(chalk.green(`\n✅ Project created at: ${result.targetDir}\n`));

  // 7. Run post-install steps
  if (!generateOptions.skipInstall) {
    await runPostInstall(config, targetDir);
  } else {
    console.log(chalk.yellow('  ⊘ Skipping npm install (--skip-install)'));
    console.log(chalk.yellow('  Run `cd ' + targetDir + ' && npm install` manually.\n'));
  }

  // 8. Print next steps
  console.log(chalk.cyan('📝 Next steps:\n'));
  console.log(chalk.white(`  cd ${targetDir}`));
  if (!config.apiKey) {
    console.log(chalk.white('  # Add your API key to .env'));
  }
  console.log(chalk.white('  npm run dev\n'));
}

// Auto-execute when run directly (e.g., via npx tsx or node)
const isMain = process.argv[1]?.includes('index');
if (isMain) {
  main().catch((err: unknown) => {
    console.error(chalk.red(String(err)));
    process.exit(1);
  });
}
