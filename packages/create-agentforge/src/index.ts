import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitCommand {
  command: 'init';
  projectName: string;
  profile: string;
  studio: boolean;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function validateProjectName(name: string): void {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`Invalid project name: ${name}. Project name must not contain path separators.`);
  }
}

export function parseArgs(argv: string[]): InitCommand | null {
  if (argv.length === 0) return null;

  const first = argv[0];
  if (first !== 'init') return null;

  const projectName = argv[1];
  if (!projectName || projectName.startsWith('--')) return null;
  validateProjectName(projectName);

  let profile = 'default';
  let studio = true;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--profile' && argv[i + 1]) {
      profile = argv[++i];
    } else if (argv[i] === '--no-studio') {
      studio = false;
    }
  }

  return { command: 'init', projectName, profile, studio };
}

// ---------------------------------------------------------------------------
// Template file definitions
// ---------------------------------------------------------------------------

interface TemplateFile {
  template: string;
  output: string;
}

const TEMPLATES: TemplateFile[] = [
  { template: 'package.json', output: 'package.json' },
  { template: 'tsconfig.json', output: 'tsconfig.json' },
  { template: 'agent.ts', output: 'agent.ts' },
  { template: 'env.example', output: '.env.example' },
  { template: 'config.jsonc', output: '.agentforge/config.jsonc' },
];

// ---------------------------------------------------------------------------
// Scaffold
// ---------------------------------------------------------------------------

function getTemplatesDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const devPath = resolve(__dirname, 'templates');
  if (existsSync(devPath)) return devPath;
  return resolve(__dirname, '..', 'templates');
}

export async function scaffold(options: {
  projectName: string;
  profile: string;
  studio: boolean;
  cwd: string;
}): Promise<void> {
  const projectDir = resolve(options.cwd, options.projectName);
  const templatesDir = getTemplatesDir();

  for (const entry of TEMPLATES) {
    const templatePath = resolve(templatesDir, entry.template);
    const outputPath = resolve(projectDir, entry.output);

    mkdirSync(dirname(outputPath), { recursive: true });

    let content = readFileSync(templatePath, 'utf-8');
    content = content.replace(/\{\{projectName\}\}/g, options.projectName);

    writeFileSync(outputPath, content, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Interactive prompt
// ---------------------------------------------------------------------------

async function askQuestion(query: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(query, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function interactiveInit(): Promise<InitCommand> {
  const projectName = await askQuestion('Project name: ');
  const profileRaw = await askQuestion('Profile (default/coding/business/personal) [default]: ');
  const studioRaw = await askQuestion('Include Studio UI? (Y/n): ');

  return {
    command: 'init',
    projectName: projectName || 'my-agent',
    profile: profileRaw || 'default',
    studio: studioRaw.toLowerCase() !== 'n',
  };
}

// ---------------------------------------------------------------------------
// Main entry point (called from bin.ts)
// ---------------------------------------------------------------------------

export async function run(argv: string[]): Promise<void> {
  let cmd = parseArgs(argv);

  if (cmd === null) {
    if (argv.length === 0) {
      cmd = await interactiveInit();
    } else {
      console.error('Usage: create-agentforge init <project-name> [--profile <name>] [--no-studio]');
      process.exit(1);
    }
  }

  const cwd = process.cwd();

  validateProjectName(cmd.projectName);

  await scaffold({
    projectName: cmd.projectName,
    profile: cmd.profile,
    studio: cmd.studio,
    cwd,
  });

  const projectDir = resolve(cwd, cmd.projectName);

  console.log(`\n  Created AgentForge project at ${projectDir}\n`);
  console.log('  Next steps:');
  console.log(`    cd ${cmd.projectName}`);
  console.log('    npm install');
  console.log('    cp .env.example .env');
  console.log('    # Edit .env with your API keys');
  console.log('    npx tsx agent.ts\n');
}
