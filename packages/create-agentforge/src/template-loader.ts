/**
 * Template loader for create-agentforge CLI.
 *
 * Copies pre-built example projects when using --template mode.
 * After copying, applies user overrides (like LLM provider swap).
 *
 * Templates come in two flavors:
 * 1. Legacy examples (weather-agent, full-pipeline) — in the examples/ directory
 * 2. New templates (chat-agent, tool-agent, etc.) — in the templates/examples/ directory
 */

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PromptsConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, '..', 'examples');
const TEMPLATES_DIR = join(__dirname, '..', 'templates', 'examples');

/**
 * Template metadata loaded from template.json.
 */
export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  complexity: string;
  features: string[];
}

/**
 * Available template names for --template mode.
 * Includes both legacy examples and new templates.
 */
export const AVAILABLE_TEMPLATES: string[] = [
  // Legacy examples
  'weather-agent',
  'full-pipeline',
  // New templates
  'chat-agent',
  'tool-agent',
  'rag-agent',
  'multi-agent',
  'mcp-agent',
  'production-agent',
];

/**
 * Load template metadata from template.json.
 *
 * @returns Array of template metadata objects
 */
export function loadTemplateMetadata(): TemplateMeta[] {
  const templateJsonPath = join(__dirname, '..', 'templates', 'template.json');
  if (!existsSync(templateJsonPath)) {
    return [];
  }
  const content = readFileSync(templateJsonPath, 'utf-8');
  const data = JSON.parse(content) as { templates: TemplateMeta[] };
  return data.templates;
}

/**
 * Find a template by ID.
 *
 * @param id - Template ID to find
 * @returns Template metadata or undefined if not found
 */
export function findTemplate(id: string): TemplateMeta | undefined {
  const templates = loadTemplateMetadata();
  return templates.find((t) => t.id === id);
}

/**
 * Get templates filtered by category.
 *
 * @param category - Category to filter by
 * @returns Array of templates in the given category
 */
export function getTemplatesByCategory(category: string): TemplateMeta[] {
  const templates = loadTemplateMetadata();
  return templates.filter((t) => t.category === category);
}

/**
 * Resolve the directory for a template.
 * Searches both the new templates/examples/ directory and the legacy examples/ directory.
 *
 * @param templateName - Name of the template
 * @returns Absolute path to the template directory
 * @throws Error if the template directory is not found
 */
function resolveTemplateDir(templateName: string): string {
  // Try new templates directory first
  const newTemplateDir = join(TEMPLATES_DIR, templateName);
  if (existsSync(newTemplateDir)) {
    return newTemplateDir;
  }

  // Fall back to legacy examples directory
  const legacyTemplateDir = join(EXAMPLES_DIR, templateName);
  if (existsSync(legacyTemplateDir)) {
    return legacyTemplateDir;
  }

  throw new Error(
    `Template directory not found for "${templateName}". Searched:\n` +
    `  - ${newTemplateDir}\n` +
    `  - ${legacyTemplateDir}`
  );
}

/**
 * Load a pre-built example project into the target directory.
 *
 * Copies all files from the template directory, then applies
 * user overrides (like project name and LLM provider).
 *
 * @param templateName - Name of the template (e.g., 'chat-agent', 'weather-agent')
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

  const templateDir = resolveTemplateDir(templateName);

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

  const keyLine = envKeyMap[llm] || envKeyMap['openai'];

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