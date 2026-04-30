import type { PromptsConfig } from './config.js';

/**
 * Core dependencies required for all AgentForge projects
 */
const CORE_DEPS: Record<string, string> = {
  agentforge: '^0.1.0',
  // rxjs removed — agentforge uses imperative loop + AgentEventEmitter instead
  zod: '^3.23.8',
  dotenv: '^16.4.0',
};

/**
 * LLM provider-specific dependencies
 */
const LLM_DEPS: Record<string, Record<string, string>> = {
  openai: { '@ai-sdk/openai': '^1.0.0', ai: '^6.0.0' },
  anthropic: { '@ai-sdk/anthropic': '^1.0.0', ai: '^6.0.0' },
  deepseek: { '@ai-sdk/openai-compatible': '^2.0.0', ai: '^6.0.0' },
  mock: {},
};

/**
 * Module-specific dependencies (optional features)
 */
const MODULE_DEPS: Record<string, Record<string, string>> = {
  checkpoint: { 'better-sqlite3': '^11.0.0', '@types/better-sqlite3': '^7.6.0' },
  mcp: { '@modelcontextprotocol/sdk': '^1.29.0' },
};

/**
 * Compute runtime dependencies based on user configuration
 *
 * @param config - The prompts configuration
 * @returns A record of package names to version ranges
 */
export function computeDependencies(config: PromptsConfig): Record<string, string> {
  const deps: Record<string, string> = { ...CORE_DEPS };

  const llmDeps = LLM_DEPS[config.llm];
  if (llmDeps) Object.assign(deps, llmDeps);

  if (config.checkpoint) Object.assign(deps, MODULE_DEPS.checkpoint);
  if (config.mcp) Object.assign(deps, MODULE_DEPS.mcp);

  return deps;
}

/**
 * Compute development dependencies based on user configuration
 *
 * @param _config - The prompts configuration (currently unused, but kept for API consistency)
 * @returns A record of package names to version ranges
 */
export function computeDevDependencies(_config: PromptsConfig): Record<string, string> {
  return {
    typescript: '^5.5.0',
    '@types/node': '^22.0.0',
    tsx: '^4.19.0',
    vitest: '^2.0.0',
    chalk: '^5.3.0',
  };
}
