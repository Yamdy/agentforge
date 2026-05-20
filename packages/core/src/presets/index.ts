/**
 * Agent Presets Module
 *
 * Provides pre-configured agent templates for common use cases.
 */

import type { AgentConfig } from '@primo-ai/sdk';
import { executorPreset } from './executor.js';
import { plannerPreset } from './planner.js';
import { researcherPreset } from './researcher.js';
import type { AgentPreset, PermissionConfig } from './types.js';

// Re-export types
export * from './types.js';

// Re-export individual presets
export { executorPreset, plannerPreset, researcherPreset };

/**
 * Array of all built-in presets.
 */
export const builtInPresets: AgentPreset[] = [
  executorPreset,
  plannerPreset,
  researcherPreset,
];

/**
 * Internal registry for presets.
 * Initialized with built-in presets, extensible via registerPreset.
 */
const presetRegistry = new Map<string, AgentPreset>(
  builtInPresets.map((p) => [p.id, p])
);

/**
 * Register a custom preset.
 * Overwrites existing preset with the same id.
 */
export function registerPreset(preset: AgentPreset): void {
  presetRegistry.set(preset.id, preset);
}

/**
 * Get a preset by its id.
 * Returns undefined if not found.
 */
export function getPreset(id: string): AgentPreset | undefined {
  return presetRegistry.get(id);
}

/**
 * List all registered presets.
 */
export function listPresets(): AgentPreset[] {
  return [...presetRegistry.values()];
}

/**
 * Create an AgentConfig from a preset.
 *
 * @param presetId - The id of the preset to use
 * @param overrides - Optional overrides for the config
 * @throws Error if preset is not found
 */
export function createConfigFromPreset(
  presetId: string,
  overrides?: Partial<AgentConfig>
): AgentConfig {
  const preset = getPreset(presetId);
  if (!preset) {
    throw new Error(`Unknown preset: ${presetId}`);
  }

  const model = overrides?.model ?? preset.defaultModel;
  if (!model) {
    throw new Error(
      `No model specified. Provide model in overrides or set defaultModel on preset '${presetId}'.`
    );
  }

  return {
    model,
    systemPrompt: overrides?.systemPrompt ?? preset.systemPromptFragment,
    tools: overrides?.tools ?? [],
    maxIterations: overrides?.maxIterations ?? 10,
  };
}

/**
 * Convert a preset to a permission configuration.
 *
 * @param preset - The preset to convert
 * @returns Permission configuration object
 */
export function presetToPermissionConfig(preset: AgentPreset): PermissionConfig {
  return {
    mode: preset.permissionMode,
    rules: preset.permissions,
  };
}
