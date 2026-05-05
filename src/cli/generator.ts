/**
 * Core generator for create-agentforge CLI.
 *
 * Orchestrates project generation:
 * 1. Create temp directory (atomic safety)
 * 2. Render base template files into temp dir
 * 3. Render module snippet files based on PromptsConfig
 * 4. Generate agentforge.config.ts with correct imports
 * 5. Atomically move temp dir to target dir
 * 6. On failure, cleanup temp dir
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PromptsConfig } from './config.js';
import { computeDependencies, computeDevDependencies } from './deps.js';
import {
  renderTemplateFile,
  writeFile,
  createTempDir,
  atomicMove,
  cleanupTempDir,
} from './utils.js';

// Get directory of this module for resolving templates
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');
const BASE_TEMPLATES_DIR = join(TEMPLATES_DIR, 'base');
const MODULES_TEMPLATES_DIR = join(TEMPLATES_DIR, 'modules');

/**
 * Template data passed to Handlebars templates.
 */
interface TemplateData extends Record<string, unknown> {
  config: PromptsConfig;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  modelString: string;
  llmImport: string;
  llmClassName: string;
  hasCheckpointStorage: boolean;
  hasSQLiteStorage: boolean;
}

/**
 * Options for project generation.
 */
export interface GenerateOptions {
  /** If true, list files but don't write (preview mode) */
  dryRun?: boolean;
  /** If true, skip npm install step */
  skipInstall?: boolean;
  /** Force overwrite existing directory */
  force?: boolean;
}

/**
 * File entry for dry-run preview.
 */
export interface FileEntry {
  /** Relative path from project root */
  path: string;
  /** Description of the file */
  description: string;
}

/**
 * Result of project generation.
 */
export interface GenerateResult {
  /** Files that would be/were created */
  files: FileEntry[];
  /** Final target directory */
  targetDir: string;
}

/**
 * Generate a complete AgentForge project.
 *
 * @param config - User configuration from prompts or CLI flags
 * @param targetDir - Target directory for the project
 * @param options - Generation options
 * @returns GenerateResult with files created and target directory
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async for API contract consistency
export async function generateProject(
  config: PromptsConfig,
  targetDir: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const { dryRun = false } = options;
  const files: FileEntry[] = [];

  // Resolve agentName (defaults to projectName)
  const effectiveAgentName = config.agentName || config.projectName;

  // Create template data with all config values
  const templateData = {
    config: {
      ...config,
      agentName: effectiveAgentName,
    },
    dependencies: computeDependencies(config),
    devDependencies: computeDevDependencies(config),
    // Computed helpers
    modelString: getModelString(config),
    llmImport: getLLMImport(config),
    llmClassName: getLLMClassName(config),
    hasCheckpointStorage: config.checkpoint,
    hasSQLiteStorage: config.checkpoint && config.checkpointStorage === 'sqlite',
  };

  let tempDir: string | null = null;

  try {
    // Create temp directory for atomic operation
    if (!dryRun) {
      tempDir = createTempDir('agentforge-gen-');
    }

    // 1. Render base templates (always present)
    renderBaseTemplates(templateData, tempDir, files, dryRun);

    // 2. Render LLM adapter (always present based on llm selection)
    renderLLMAdapter(config, templateData, tempDir, files, dryRun);

    // 3. Render optional modules
    if (config.tools) {
      renderToolsModule(templateData, tempDir, files, dryRun);
    }

    if (config.checkpoint) {
      renderCheckpointModule(templateData, tempDir, files, dryRun);
    }

    if (config.observability) {
      renderObservabilityModule(templateData, tempDir, files, dryRun);
    }

    if (config.hitl) {
      renderHITLModule(templateData, tempDir, files, dryRun);
    }

    if (config.plugins) {
      renderPluginsModule(templateData, tempDir, files, dryRun);
    }

    if (config.compaction) {
      renderCompactionModule(templateData, tempDir, files, dryRun);
    }

    if (config.subagent) {
      renderSubagentModule(templateData, tempDir, files, dryRun);
    }

    if (config.mcp) {
      renderMCPModule(templateData, tempDir, files, dryRun);
    }

    if (config.apiMode === 'advanced') {
      renderOperatorsModule(templateData, tempDir, files, dryRun);
    }

    // 4. Generate agentforge.config.ts
    generateConfigFile(templateData, tempDir, files, dryRun);

    // 5. For dryRun, return the file list without creating
    if (dryRun) {
      return { files, targetDir: resolve(targetDir) };
    }

    // 6. Atomic move to target
    const resolvedTarget = resolve(targetDir);
    atomicMove(tempDir!, resolvedTarget);
    tempDir = null; // Mark as moved (no cleanup needed)

    return { files, targetDir: resolvedTarget };
  } finally {
    // Cleanup on failure
    if (tempDir) {
      cleanupTempDir(tempDir);
    }
  }
}

/**
 * Get model string for config (provider/model format).
 */
function getModelString(config: PromptsConfig): string {
  return `${config.llm}/${config.llmModel}`;
}

/**
 * Get LLM import based on provider.
 */
function getLLMImport(config: PromptsConfig): string {
  const imports: Record<string, string> = {
    openai: '@ai-sdk/openai',
    anthropic: '@ai-sdk/anthropic',
    deepseek: '@ai-sdk/openai-compatible',
    mock: './llm/adapter.js',
  };
  return imports[config.llm] ?? imports.mock!;
}

/**
 * Get LLM class/function name based on provider.
 */
function getLLMClassName(config: PromptsConfig): string {
  const classNames: Record<string, string> = {
    openai: 'createOpenAI',
    anthropic: 'createAnthropic',
    deepseek: 'createOpenAICompatible',
    mock: 'MockLLMAdapter',
  };
  return classNames[config.llm] ?? classNames.mock!;
}

/**
 * Render base templates (always present).
 */
function renderBaseTemplates(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  // Define base files to generate
  const baseFiles: Array<{ template: string; output: string; description: string }> = [
    // Handlebars templates
    {
      template: 'package.json.hbs',
      output: 'package.json',
      description: 'Package configuration with scripts and dependencies',
    },
    {
      template: 'tsconfig.json.hbs',
      output: 'tsconfig.json',
      description: 'TypeScript configuration',
    },
    {
      template: '.env.example.hbs',
      output: '.env.example',
      description: 'Environment variables template',
    },
    { template: 'README.md.hbs', output: 'README.md', description: 'Project documentation' },
    { template: 'src/index.ts.hbs', output: 'src/index.ts', description: 'Main entry point' },
    // Deployment templates
    { template: 'Dockerfile.hbs', output: 'Dockerfile', description: 'Multi-stage Docker build' },
    {
      template: 'docker-compose.yml.hbs',
      output: 'docker-compose.yml',
      description: 'Docker Compose configuration',
    },
    // Static files (no template)
    { template: '.gitignore', output: '.gitignore', description: 'Git ignore rules' },
    { template: '.dockerignore', output: '.dockerignore', description: 'Docker build ignores' },
    { template: 'src/types.ts', output: 'src/types.ts', description: 'Shared type definitions' },
  ];

  for (const file of baseFiles) {
    const templatePath = join(BASE_TEMPLATES_DIR, file.template);

    if (dryRun) {
      files.push({ path: file.output, description: file.description });
      continue;
    }

    let content: string;

    if (file.template.endsWith('.hbs')) {
      content = renderTemplateFile(templatePath, templateData);
    } else {
      // For non-Handlebars files, read and copy directly
      content = renderTemplateFile(templatePath, {});
    }

    writeFile(join(tempDir!, file.output), content);
    files.push({ path: file.output, description: file.description });
  }
}

/**
 * Render LLM adapter based on provider selection.
 */
function renderLLMAdapter(
  config: PromptsConfig,
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const llmDir = `llm-${config.llm}`;
  const templatePath = join(MODULES_TEMPLATES_DIR, llmDir, 'adapter.ts.hbs');

  if (dryRun) {
    files.push({ path: 'src/llm/adapter.ts', description: `${config.llm} LLM adapter` });
    return;
  }

  const content = renderTemplateFile(templatePath, templateData);
  writeFile(join(tempDir!, 'src/llm/adapter.ts'), content);
  files.push({ path: 'src/llm/adapter.ts', description: `${config.llm} LLM adapter` });
}

/**
 * Render tools module.
 */
function renderToolsModule(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const templatesDir = join(MODULES_TEMPLATES_DIR, 'tools');
  const toolFiles = [
    {
      template: 'index.ts.hbs',
      output: 'src/tools/index.ts',
      description: 'Tool registry with examples',
    },
    {
      template: 'weather.ts.hbs',
      output: 'src/tools/weather.ts',
      description: 'Weather tool with Zod schema',
    },
  ];

  for (const file of toolFiles) {
    if (dryRun) {
      files.push({ path: file.output, description: file.description });
      continue;
    }

    const content = renderTemplateFile(join(templatesDir, file.template), templateData);
    writeFile(join(tempDir!, file.output), content);
    files.push({ path: file.output, description: file.description });
  }
}

/**
 * Render checkpoint module.
 */
function renderCheckpointModule(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const templatePath = join(MODULES_TEMPLATES_DIR, 'checkpoint', 'storage.ts.hbs');

  if (dryRun) {
    files.push({
      path: 'src/checkpoint/storage.ts',
      description: 'Checkpoint storage implementation',
    });
    return;
  }

  const content = renderTemplateFile(templatePath, templateData);
  writeFile(join(tempDir!, 'src/checkpoint/storage.ts'), content);
  files.push({
    path: 'src/checkpoint/storage.ts',
    description: 'Checkpoint storage implementation',
  });
}

/**
 * Render observability module (logger, tracer, metrics).
 */
function renderObservabilityModule(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const templatesDir = join(MODULES_TEMPLATES_DIR, 'observability');
  const obsFiles = [
    {
      template: 'logger.ts.hbs',
      output: 'src/observability/logger.ts',
      description: 'Console logger',
    },
    {
      template: 'tracer.ts.hbs',
      output: 'src/observability/tracer.ts',
      description: 'Console tracer',
    },
    {
      template: 'metrics.ts.hbs',
      output: 'src/observability/metrics.ts',
      description: 'Console metrics collector',
    },
  ];

  for (const file of obsFiles) {
    if (dryRun) {
      files.push({ path: file.output, description: file.description });
      continue;
    }

    const content = renderTemplateFile(join(templatesDir, file.template), templateData);
    writeFile(join(tempDir!, file.output), content);
    files.push({ path: file.output, description: file.description });
  }
}

/**
 * Render HITL module.
 */
function renderHITLModule(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const templatePath = join(MODULES_TEMPLATES_DIR, 'hitl', 'controller.ts.hbs');

  if (dryRun) {
    files.push({ path: 'src/hitl/controller.ts', description: 'HITL controller implementation' });
    return;
  }

  const content = renderTemplateFile(templatePath, templateData);
  writeFile(join(tempDir!, 'src/hitl/controller.ts'), content);
  files.push({ path: 'src/hitl/controller.ts', description: 'HITL controller implementation' });
}

/**
 * Render plugins module.
 */
function renderPluginsModule(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const templatePath = join(MODULES_TEMPLATES_DIR, 'plugins', 'index.ts.hbs');

  if (dryRun) {
    files.push({ path: 'src/plugins/index.ts', description: 'Plugin manager setup' });
    return;
  }

  const content = renderTemplateFile(templatePath, templateData);
  writeFile(join(tempDir!, 'src/plugins/index.ts'), content);
  files.push({ path: 'src/plugins/index.ts', description: 'Plugin manager setup' });
}

/**
 * Render compaction module.
 */
function renderCompactionModule(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const templatePath = join(MODULES_TEMPLATES_DIR, 'memory', 'compaction.ts.hbs');

  if (dryRun) {
    files.push({ path: 'src/memory/compaction.ts', description: 'Memory compaction manager' });
    return;
  }

  const content = renderTemplateFile(templatePath, templateData);
  writeFile(join(tempDir!, 'src/memory/compaction.ts'), content);
  files.push({ path: 'src/memory/compaction.ts', description: 'Memory compaction manager' });
}

/**
 * Render subagent module.
 */
function renderSubagentModule(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const templatePath = join(MODULES_TEMPLATES_DIR, 'subagent', 'registry.ts.hbs');

  if (dryRun) {
    files.push({ path: 'src/subagent/registry.ts', description: 'Subagent registry' });
    return;
  }

  const content = renderTemplateFile(templatePath, templateData);
  writeFile(join(tempDir!, 'src/subagent/registry.ts'), content);
  files.push({ path: 'src/subagent/registry.ts', description: 'Subagent registry' });
}

/**
 * Render MCP module.
 */
function renderMCPModule(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const templatePath = join(MODULES_TEMPLATES_DIR, 'mcp', 'client.ts.hbs');

  if (dryRun) {
    files.push({ path: 'src/mcp/client.ts', description: 'MCP client configuration' });
    return;
  }

  const content = renderTemplateFile(templatePath, templateData);
  writeFile(join(tempDir!, 'src/mcp/client.ts'), content);
  files.push({ path: 'src/mcp/client.ts', description: 'MCP client configuration' });
}

/**
 * Render operators module (for advanced API mode).
 */
function renderOperatorsModule(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const templatePath = join(MODULES_TEMPLATES_DIR, 'operators', 'pipeline.ts.hbs');

  if (dryRun) {
    files.push({ path: 'src/operators/pipeline.ts', description: 'Operator pipeline composition' });
    return;
  }

  const content = renderTemplateFile(templatePath, templateData);
  writeFile(join(tempDir!, 'src/operators/pipeline.ts'), content);
  files.push({ path: 'src/operators/pipeline.ts', description: 'Operator pipeline composition' });
}

/**
 * Generate agentforge.config.ts with dynamic imports.
 */
function generateConfigFile(
  templateData: TemplateData,
  tempDir: string | null,
  files: FileEntry[],
  dryRun: boolean
): void {
  const config = templateData.config;

  const imports: string[] = [`import { defineConfig } from 'agentforge';`];

  // Add imports based on enabled modules
  imports.push(`import { adapter } from './src/llm/adapter.js';`);

  if (config.tools) {
    imports.push(`import { tools } from './src/tools/index.js';`);
  }

  if (config.checkpoint) {
    imports.push(`import { checkpointStorage } from './src/checkpoint/storage.js';`);
  }

  if (config.observability) {
    imports.push(`import { logger } from './src/observability/logger.js';`);
    imports.push(`import { tracer } from './src/observability/tracer.js';`);
    imports.push(`import { metrics } from './src/observability/metrics.js';`);
  }

  if (config.hitl) {
    imports.push(`import { hitlController } from './src/hitl/controller.js';`);
  }

  if (config.plugins) {
    imports.push(`import { pluginManager } from './src/plugins/index.js';`);
  }

  if (config.compaction) {
    imports.push(`import { compactionManager } from './src/memory/compaction.js';`);
  }

  if (config.subagent) {
    imports.push(`import { subagentRegistry } from './src/subagent/registry.js';`);
  }

  if (config.mcp) {
    imports.push(`import { mcpClient } from './src/mcp/client.js';`);
  }

  // Build config object
  const configLines: string[] = [
    `export default defineConfig({`,
    `  name: '${config.agentName}',`,
    `  model: '${templateData.modelString}',`,
    `  maxSteps: ${config.maxSteps},`,
    '',
    `  // LLM Configuration`,
    `  llm: adapter,`,
  ];

  if (config.tools) {
    configLines.push(``);
    configLines.push(`  // Tools`);
    configLines.push(`  tools,`);
  }

  if (config.checkpoint) {
    configLines.push(``);
    configLines.push(`  // Checkpoint persistence`);
    configLines.push(
      `  checkpoint: ${config.checkpointStorage === 'memory' ? "'memory'" : 'true'},`
    );
  }

  if (config.observability) {
    configLines.push(``);
    configLines.push(`  // Observability`);
    configLines.push(`  tracing: true,`);
    configLines.push(`  metrics: true,`);
  }

  if (config.hitl) {
    configLines.push(``);
    configLines.push(`  // Human-in-the-loop`);
    configLines.push(`  hitl: true,`);
  }

  if (config.plugins) {
    configLines.push(``);
    configLines.push(`  // Plugin system`);
    configLines.push(`  plugins: pluginManager,`);
  }

  if (config.preset) {
    configLines.push(``);
    configLines.push(`  // Preset configuration`);
    configLines.push(`  preset: '${config.preset}',`);
  }

  // Add comments for optional modules
  if (config.compaction) {
    configLines.push(``);
    configLines.push(`  // Memory compaction`);
    configLines.push(`  compaction: compactionManager,`);
  }

  if (config.subagent) {
    configLines.push(``);
    configLines.push(`  // Subagent delegation`);
    configLines.push(`  subagents: subagentRegistry,`);
  }

  if (config.mcp) {
    configLines.push(``);
    configLines.push(`  // MCP integration`);
    configLines.push(`  mcp: mcpClient,`);
  }

  configLines.push(`});`);

  const content = `${imports.join('\n')}\n\n${configLines.join('\n')}\n`;

  if (dryRun) {
    files.push({ path: 'agentforge.config.ts', description: 'AgentForge configuration' });
    return;
  }

  writeFile(join(tempDir!, 'agentforge.config.ts'), content);
  files.push({ path: 'agentforge.config.ts', description: 'AgentForge configuration' });
}

/**
 * List all files that would be generated (for --dry-run preview).
 */
export function listGeneratedFiles(config: PromptsConfig): FileEntry[] {
  const { files } = generateProjectSync(config, '.', { dryRun: true });
  return files;
}

/**
 * Synchronous version for dry-run listing (internally async but types match).
 */
function generateProjectSync(
  config: PromptsConfig,
  _targetDir: string,
  _options: GenerateOptions
): { files: FileEntry[] } {
  // For sync operation in dry-run, we simulate the file list
  const files: FileEntry[] = [];
  const effectiveAgentName = config.agentName || config.projectName;

  const templateData: TemplateData = {
    config: {
      ...config,
      agentName: effectiveAgentName,
    },
    dependencies: computeDependencies(config),
    devDependencies: computeDevDependencies(config),
    modelString: getModelString(config),
    llmImport: getLLMImport(config),
    llmClassName: getLLMClassName(config),
    hasCheckpointStorage: config.checkpoint,
    hasSQLiteStorage: config.checkpoint && config.checkpointStorage === 'sqlite',
  };

  // Call render functions with dryRun=true
  renderBaseTemplates(templateData, null, files, true);
  renderLLMAdapter(config, templateData, null, files, true);

  if (config.tools) renderToolsModule(templateData, null, files, true);
  if (config.checkpoint) renderCheckpointModule(templateData, null, files, true);
  if (config.observability) renderObservabilityModule(templateData, null, files, true);
  if (config.hitl) renderHITLModule(templateData, null, files, true);
  if (config.plugins) renderPluginsModule(templateData, null, files, true);
  if (config.compaction) renderCompactionModule(templateData, null, files, true);
  if (config.subagent) renderSubagentModule(templateData, null, files, true);
  if (config.mcp) renderMCPModule(templateData, null, files, true);
  if (config.apiMode === 'advanced') renderOperatorsModule(templateData, null, files, true);

  generateConfigFile(templateData, null, files, true);

  return { files };
}
