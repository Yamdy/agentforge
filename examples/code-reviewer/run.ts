#!/usr/bin/env npx tsx
/**
 * Code Reviewer CLI - Unified Entry Point
 * 
 * Two modes:
 *   review (default)  Full code review → structured report
 *   chat              Interactive Q&A about your codebase
 * 
 * Usage:
 *   npx tsx examples/code-reviewer/run.ts ./src          # Review mode
 *   npx tsx examples/code-reviewer/run.ts chat ./src     # Chat mode
 *   npx tsx examples/code-reviewer/run.ts chat           # Chat in current dir
 */

import 'dotenv/config';

const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
🔍 Code Reviewer - AI-Powered Code Analysis

Usage:
  npx tsx examples/code-reviewer/run.ts [mode] [project-path]

Modes:
  review  (default)  Full code review → structured Markdown report
  chat              Interactive Q&A, ask anything about the code

Arguments:
  project-path    Path to the project directory

Options:
  --help, -h      Show this help message

Environment Variables:
  DOUBAO_API_KEY    API key
  DOUBAO_BASE_URL   API base URL
  MODEL             Model name (default: glm-5)

Examples:
  # Review mode - full code review
  npx tsx examples/code-reviewer/run.ts ./src
  npx tsx examples/code-reviewer/run.ts ../my-project

  # Chat mode - interactive Q&A
  npx tsx examples/code-reviewer/run.ts chat
  npx tsx examples/code-reviewer/run.ts chat ./src
`);
  process.exit(0);
}

const mode = args[0];

if (mode === 'chat') {
  const projectPath = args.slice(1).find((arg) => !arg.startsWith('--')) || '.';
  import('./chat.js').catch(console.error);
} else {
  const projectPath = args.find((arg) => !arg.startsWith('--'));
  import('./index.js').then(async ({ runInteractive }) => {
    await runInteractive(projectPath, {
      model: process.env.MODEL,
    });
  }).catch(console.error);
}
