/**
 * Template loader for create-agentforge CLI.
 *
 * Copies pre-built example projects when using --template mode.
 * After copying, applies user overrides (like LLM provider swap).
 */

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PromptsConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, '..', 'examples');

/**
 * Available template names for --template mode.
 */
export const AVAILABLE_TEMPLATES: string[] = ['weather-agent', 'full-pipeline'];

/**
 * Load a pre-built example project into the target directory.
 *
 * Copies all files from the example directory, then applies
 * user overrides (like project name and LLM provider).
 *
 * @param templateName - Name of the template ('weather-agent' or 'full-pipeline')
 * @param targetDir - Target directory for the project
 * @param overrides - Partial config to override defaults in the template
 * @throws Error if template name is invalid
 */
export async function loadTemplate(
  templateName: string,
  targetDir: string,
  overrides: Partial<PromptsConfig> = {}
): Promise<void> {
  if (!AVAILABLE_TEMPLATES.includes(templateName)) {
    throw new Error(
      `Unknown template "${templateName}". Available: ${AVAILABLE_TEMPLATES.join(', ')}`
    );
  }

  const templateDir = join(EXAMPLES_DIR, templateName);

  if (!existsSync(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  // Copy all template files to target
  cpSync(templateDir, targetDir, { recursive: true });

  // Apply overrides if provided
  if (overrides.projectName) {
    applyProjectNameOverride(targetDir, overrides.projectName);
  }

  if (overrides.llm) {
    applyLLMOverride(targetDir, overrides.llm);
  }
}

/**
 * Update package.json project name.
 */
function applyProjectNameOverride(targetDir: string, projectName: string): void {
  const pkgJsonPath = join(targetDir, 'package.json');
  if (existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    pkgJson.name = projectName;
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf-8');
  }
}

/**
 * Update .env.example with the correct API key variable.
 */
function applyLLMOverride(targetDir: string, llm: string): void {
  const envPath = join(targetDir, '.env.example');
  if (!existsSync(envPath)) return;

  const envKeyMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    mock: '# No API key needed for mock provider',
  };

  const keyLine = envKeyMap[llm] ?? envKeyMap['openai']!;

  let envContent = readFileSync(envPath, 'utf-8');

  // Remove existing API key lines
  envContent = envContent
    .split('\n')
    .filter((line: string) => !line.match(/^(OPENAI|ANTHROPIC|DEEPSEEK)_API_KEY/))
    .join('\n');

  // Add the correct key at the top
  const lines = envContent.split('\n');
  const insertIndex = lines.findIndex((line: string) => line.startsWith('#')) + 1 || 1;
  lines.splice(insertIndex, 0, keyLine);
  envContent = lines.join('\n');

  writeFileSync(envPath, envContent, 'utf-8');
}