/**
 * Configuration types, defaults, and validation for create-agentforge CLI.
 *
 * This module defines the PromptsConfig type that captures all user choices
 * during interactive prompts or from CLI flags, along with validation logic
 * and default values for --default mode.
 */

// ============================================================================
// Types
// ============================================================================

export type LLMProvider = 'openai' | 'anthropic' | 'deepseek' | 'mock';

export type Preset = 'production' | 'debug' | 'test';

export type APIMode = 'simple' | 'advanced';

export type CheckpointStorage = 'sqlite' | 'memory';

/**
 * Configuration captured from interactive prompts or CLI flags.
 * This is the intermediate representation before template generation.
 */
export interface PromptsConfig {
  /** Project directory name (required) */
  projectName: string;
  /** Agent name (defaults to projectName if empty) */
  agentName: string;
  /** Maximum steps before forced termination */
  maxSteps: number;
  /** LLM provider selection */
  llm: LLMProvider;
  /** Model identifier for the selected provider */
  llmModel: string;
  /** Optional API key (or add to .env later) */
  apiKey?: string;
  /** Enable tool system */
  tools: boolean;
  /** List of tool names to include */
  toolList: string[];
  /** Enable checkpoint persistence */
  checkpoint: boolean;
  /** Storage backend for checkpoints */
  checkpointStorage: CheckpointStorage;
  /** Enable observability (Logger+Tracer+Metrics) */
  observability: boolean;
  /** Configuration preset */
  preset?: Preset;
  /** Enable human-in-the-loop */
  hitl: boolean;
  /** Enable plugin system */
  plugins: boolean;
  /** Enable memory compaction */
  compaction: boolean;
  /** Enable sub-agent delegation */
  subagent: boolean;
  /** Enable MCP client */
  mcp: boolean;
  /** Include Docker deployment templates and scripts */
  deployment: boolean;
  /** API level: L2 (simple) or L3 (advanced) */
  apiMode: APIMode;
  /** Initialize git repository */
  gitInit: boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const VALID_LLM_PROVIDERS = ['openai', 'anthropic', 'deepseek', 'mock'] as const;

export const VALID_PRESETS = ['production', 'debug', 'test'] as const;

export const VALID_API_MODES = ['simple', 'advanced'] as const;

export const VALID_CHECKPOINT_STORAGE = ['sqlite', 'memory'] as const;

/**
 * Default models for each LLM provider.
 */
export const VALID_LLM_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4',
  deepseek: 'deepseek-chat',
  mock: 'mock-v1',
};

/**
 * Default values for --default mode.
 * projectName and agentName are set from CLI args or prompts.
 */
export const DEFAULT_VALUES = {
  agentName: '', // defaults to projectName
  maxSteps: 10,
  llm: 'openai' as const,
  llmModel: 'gpt-4o',
  tools: false,
  toolList: [] as string[],
  checkpoint: false,
  checkpointStorage: 'sqlite' as const,
  observability: false,
  hitl: false,
  plugins: false,
  compaction: false,
  subagent: false,
  mcp: false,
  deployment: false,
  apiMode: 'simple' as const,
  gitInit: true,
};

/**
 * Full default configuration including projectName.
 * Used as the starting point for config merging.
 */
export const DEFAULT_CONFIG: PromptsConfig = {
  projectName: '',
  ...DEFAULT_VALUES,
};

// ============================================================================
// Validation
// ============================================================================

/**
 * Result of config validation.
 */
export interface ValidationResult {
  /** Whether the config is valid */
  valid: boolean;
  /** List of validation error messages */
  errors: string[];
}

/**
 * Validates a PromptsConfig object.
 *
 * Checks:
 * - projectName is required and must be a valid identifier
 * - llm must be a valid provider
 * - preset must be valid if provided
 * - apiMode must be valid if provided
 *
 * @param config - Partial config to validate
 * @returns ValidationResult with valid flag and error list
 */
export function validateConfig(config: Partial<PromptsConfig>): ValidationResult {
  const errors: string[] = [];

  // Project name validation
  if (!config.projectName || config.projectName.trim() === '') {
    errors.push('Project name is required');
  } else if (/\s/.test(config.projectName)) {
    errors.push('Project name cannot contain spaces');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(config.projectName)) {
    errors.push('Project name can only contain letters, numbers, hyphens, and underscores');
  }

  // LLM provider validation
  if (config.llm && !VALID_LLM_PROVIDERS.includes(config.llm)) {
    errors.push(`Invalid LLM provider "${config.llm}". Valid: ${VALID_LLM_PROVIDERS.join(', ')}`);
  }

  // Preset validation
  if (config.preset && !VALID_PRESETS.includes(config.preset)) {
    errors.push(`Invalid preset "${config.preset}". Valid: ${VALID_PRESETS.join(', ')}`);
  }

  // API mode validation
  if (config.apiMode && !VALID_API_MODES.includes(config.apiMode)) {
    errors.push(`Invalid API mode "${config.apiMode}". Valid: ${VALID_API_MODES.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}