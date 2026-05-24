#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import pc from 'picocolors';
import pkg from '../../package.json';
import { create } from './commands/create/index.js';
import { init } from './commands/init/index.js';
import { dev } from './commands/dev/index.js';
import { build } from './commands/build/index.js';
import { start } from './commands/start/index.js';
import { run } from './commands/run/run.js';
import { lint } from './commands/lint/index.js';
import { studio } from './commands/studio/index.js';

const program = new Command();

program
  .name('agentforge')
  .version(pkg.version, '-v, --version')
  .addHelpText(
    'before',
    `
${pc.bold(pc.cyan('AgentForge'))} is a TypeScript framework for building AI applications, agents, and workflows.
`
  )
  .action(() => {
    program.help();
  });

program
  .command('create [project-name]')
  .description('Create a new AgentForge project')
  .option('--default', 'Quick start with defaults')
  .option('-d, --dir <directory>', 'Target directory')
  .option('-t, --template <template>', 'Project template (basic/workflow/full)')
  .option('--no-example', 'Do not include example code')
  .option('--no-git', 'Do not initialize git repository')
  .action((projectName, options) => create(projectName, options));

program
  .command('init')
  .description('Initialize AgentForge in your project')
  .option('--default', 'Quick start with defaults')
  .option('-d, --dir <directory>', 'Directory for AgentForge files (default: src/agentforge)')
  .option('--example', 'Include example code')
  .action((options) => init(options));

program
  .command('dev')
  .description('Start development server')
  .option('-d, --dir <dir>', 'Path to your agentforge folder')
  .option('-p, --port <port>', 'Port to run on (default: 4111)')
  .option('-e, --env <env>', 'Custom env file')
  .option('--inspect', 'Enable inspect mode')
  .action((options) => dev(options));

program
  .command('build')
  .description('Build your AgentForge project')
  .option('-d, --dir <dir>', 'Path to your source folder')
  .option('-o, --output <dir>', 'Output directory (default: .agentforge/output)')
  .option('--minify', 'Minify output')
  .action((options) => build(options));

program
  .command('start')
  .description('Start your built AgentForge application')
  .option('-d, --dir <dir>', 'Path to your built output directory')
  .option('-p, --port <port>', 'Port to run on')
  .option('-e, --env <env>', 'Custom env file')
  .action((options) => start(options));

program
  .command('run')
  .description('Run an agent or workflow')
  .option('-a, --agent <name>', 'Run specified agent')
  .option('-w, --workflow <name>', 'Run specified workflow')
  .option('-p, --prompt <text>', 'Input prompt')
  .option('-i, --interactive', 'Interactive mode')
  .action((options) => run(options));

program
  .command('lint')
  .description('Lint your AgentForge project')
  .option('-d, --dir <dir>', 'Path to your project')
  .option('--fix', 'Auto-fix issues')
  .action((options) => lint(options));

program
  .command('studio')
  .description('Start the AgentForge studio')
  .option('-p, --port <port>', 'Port to run the studio on')
  .action((options) => studio(options));

program.parse(process.argv);
