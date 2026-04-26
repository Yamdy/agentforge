/**
 * Interactive prompts module for create-agentforge CLI.
 *
 * Uses inquirer to collect user configuration through a 10-step
 * interactive flow. CLI args can pre-fill or skip prompts.
 */

import inquirer from 'inquirer';
import type { PromptsConfig, LLMProvider, APIMode, CheckpointStorage, Preset } from './config.js';
import { DEFAULT_VALUES, DEFAULT_CONFIG, VALID_LLM_PROVIDERS, VALID_LLM_MODELS, VALID_PRESETS, VALID_CHECKPOINT_STORAGE, validateConfig } from './config.js';

/**
 * Module names for the checkbox prompt.
 * Maps display labels to PromptsConfig boolean keys.
 */
const MODULE_OPTIONS = [
  { name: 'Tools (function calling)', value: 'tools' },
  { name: 'Checkpoint (state persistence)', value: 'checkpoint' },
  { name: 'Observability (logging, tracing, metrics)', value: 'observability' },
  { name: 'Human-in-the-loop (HITL)', value: 'hitl' },
  { name: 'Plugins', value: 'plugins' },
  { name: 'Memory compaction', value: 'compaction' },
  { name: 'Sub-agent delegation', value: 'subagent' },
  { name: 'MCP client', value: 'mcp' },
] as const;

type ModuleValue = (typeof MODULE_OPTIONS)[number]['value'];

/**
 * Remove undefined entries from a partial config, leaving only
 * explicitly-set values. Used to merge CLI overrides with defaults.
 */
export function mergeCliArgs(cliArgs: Partial<PromptsConfig>): Partial<PromptsConfig> {
  const result: Partial<PromptsConfig> = {};
  for (const [key, value] of Object.entries(cliArgs)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/**
 * Check if a config field has already been provided by CLI overrides.
 */
function isProvided(overrides: Partial<PromptsConfig>, key: keyof PromptsConfig): boolean {
  return overrides[key] !== undefined;
}

/**
 * Collect user configuration through interactive prompts.
 *
 * Prompts are skipped when the corresponding CLI override is provided.
 * After all prompts, validates the final config and throws if invalid.
 *
 * @param cliOverrides - Partial config from CLI flags (pre-fill or skip prompts)
 * @returns Complete PromptsConfig ready for project generation
 * @throws Error if the final config fails validation
 */
export async function collectPrompts(cliOverrides: Partial<PromptsConfig> = {}): Promise<PromptsConfig> {
  const answers: Partial<PromptsConfig> = { ...mergeCliArgs(cliOverrides) };

  // Step 1: Project name (required)
  if (!isProvided(answers, 'projectName')) {
    const { projectName } = await inquirer.prompt<{ projectName: string }>([
      {
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        validate: (input: string) => {
          if (!input.trim()) return 'Project name is required';
          if (/\s/.test(input)) return 'Project name cannot contain spaces';
          if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
            return 'Project name can only contain letters, numbers, hyphens, and underscores';
          }
          return true;
        },
      },
    ]);
    answers.projectName = projectName;
  }

  // Step 2: Agent name (defaults to project name)
  if (!isProvided(answers, 'agentName')) {
    const { agentName } = await inquirer.prompt<{ agentName: string }>([
      {
        type: 'input',
        name: 'agentName',
        message: 'Agent name:',
        default: answers.projectName || DEFAULT_VALUES.agentName || '',
      },
    ]);
    answers.agentName = agentName || answers.projectName || '';
  }

  // Step 3: Max steps
  if (!isProvided(answers, 'maxSteps')) {
    const { maxSteps } = await inquirer.prompt<{ maxSteps: number }>([
      {
        type: 'number',
        name: 'maxSteps',
        message: 'Maximum steps:',
        default: DEFAULT_VALUES.maxSteps,
      },
    ]);
    answers.maxSteps = maxSteps;
  }

  // Step 4: LLM provider
  if (!isProvided(answers, 'llm')) {
    const { llm } = await inquirer.prompt<{ llm: LLMProvider }>([
      {
        type: 'list',
        name: 'llm',
        message: 'LLM provider:',
        choices: VALID_LLM_PROVIDERS.map((p) => ({ name: p, value: p })),
        default: DEFAULT_VALUES.llm,
      },
    ]);
    answers.llm = llm;
  }

  // Step 5: LLM model (dynamic default based on provider)
  if (!isProvided(answers, 'llmModel')) {
    const currentProvider = answers.llm || DEFAULT_VALUES.llm;
    const defaultModel = VALID_LLM_MODELS[currentProvider] || DEFAULT_VALUES.llmModel;

    const { llmModel } = await inquirer.prompt<{ llmModel: string }>([
      {
        type: 'input',
        name: 'llmModel',
        message: 'LLM model:',
        default: defaultModel,
      },
    ]);
    answers.llmModel = llmModel;
  }

  // Step 6: API key (optional — only prompt in interactive mode)
  // Skip if the apiKey key is in the original overrides (even if undefined = explicit skip)
  // or if running in default mode (--default passes apiKey implicitly)
  if (!('apiKey' in cliOverrides) && !('apiKey' in answers)) {
    const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
      {
        type: 'password',
        name: 'apiKey',
        message: 'API key (leave empty to set via .env later):',
        mask: '*',
      },
    ]);
    // Only set apiKey if user actually typed something
    if (apiKey && apiKey.trim()) {
      answers.apiKey = apiKey.trim();
    }
  }

  // Step 7: Module selection (multi-select)
  const selectedModules = new Set<ModuleValue>();
  // Pre-populate from CLI overrides
  if (answers.tools) selectedModules.add('tools');
  if (answers.checkpoint) selectedModules.add('checkpoint');
  if (answers.observability) selectedModules.add('observability');
  if (answers.hitl) selectedModules.add('hitl');
  if (answers.plugins) selectedModules.add('plugins');
  if (answers.compaction) selectedModules.add('compaction');
  if (answers.subagent) selectedModules.add('subagent');
  if (answers.mcp) selectedModules.add('mcp');

  // Only prompt if module selections were NOT explicitly provided via CLI
  // Check if ALL module keys are present in cliOverrides (even if false)
  const moduleKeys: (keyof PromptsConfig)[] = ['tools', 'checkpoint', 'observability', 'hitl', 'plugins', 'compaction', 'subagent', 'mcp'];
  const allModulesProvided = moduleKeys.every(key => key in cliOverrides);

  if (!allModulesProvided) {
    const { modules } = await inquirer.prompt<{ modules: ModuleValue[] }>([
      {
        type: 'checkbox',
        name: 'modules',
        message: 'Select modules to include:',
        choices: MODULE_OPTIONS,
      },
    ]);
    for (const mod of modules) {
      selectedModules.add(mod);
    }
  }

  // Map module selections to boolean fields
  answers.tools = selectedModules.has('tools');
  answers.checkpoint = selectedModules.has('checkpoint');
  answers.observability = selectedModules.has('observability');
  answers.hitl = selectedModules.has('hitl');
  answers.plugins = selectedModules.has('plugins');
  answers.compaction = selectedModules.has('compaction');
  answers.subagent = selectedModules.has('subagent');
  answers.mcp = selectedModules.has('mcp');

  // Step 7b: Checkpoint storage (only if checkpoint selected)
  if (answers.checkpoint && !isProvided(answers, 'checkpointStorage')) {
    const { checkpointStorage } = await inquirer.prompt<{ checkpointStorage: CheckpointStorage }>([
      {
        type: 'list',
        name: 'checkpointStorage',
        message: 'Checkpoint storage:',
        choices: VALID_CHECKPOINT_STORAGE.map((s) => ({ name: s, value: s })),
        default: DEFAULT_VALUES.checkpointStorage,
      },
    ]);
    answers.checkpointStorage = checkpointStorage;
  }

  // Step 8: API mode
  if (!isProvided(answers, 'apiMode')) {
    const { apiMode } = await inquirer.prompt<{ apiMode: APIMode }>([
      {
        type: 'list',
        name: 'apiMode',
        message: 'API mode:',
        choices: [
          { name: 'Simple (L2 — createAgent)', value: 'simple' },
          { name: 'Advanced (L3 — AgentContextBuilder)', value: 'advanced' },
        ],
        default: DEFAULT_VALUES.apiMode,
      },
    ]);
    answers.apiMode = apiMode;
  }

  // Step 9: Preset (optional — only prompt in interactive mode)
  if (!('preset' in cliOverrides) && answers.preset === undefined) {
    const { preset } = await inquirer.prompt<{ preset: Preset | '' }>([
      {
        type: 'list',
        name: 'preset',
        message: 'Configuration preset (optional):',
        choices: [
          { name: 'None', value: '' },
          ...VALID_PRESETS.map((p) => ({ name: p, value: p })),
        ],
        default: '',
      },
    ]);
    answers.preset = preset || undefined;
  }

  // Step 10: Git init
  if (!isProvided(answers, 'gitInit')) {
    const { gitInit } = await inquirer.prompt<{ gitInit: boolean }>([
      {
        type: 'confirm',
        name: 'gitInit',
        message: 'Initialize git repository?',
        default: DEFAULT_VALUES.gitInit,
      },
    ]);
    answers.gitInit = gitInit;
  }

  // Build final config with defaults for any missing fields
  const config: PromptsConfig = {
    ...DEFAULT_CONFIG,
    ...answers,
    agentName: answers.agentName || answers.projectName || '',
    toolList: answers.toolList ?? DEFAULT_VALUES.toolList,
  };

  // Validate the final config
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration:\n${validation.errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  return config;
}