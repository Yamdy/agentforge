/**
 * AgentForge L1 API - Zero-Code Configuration Layer
 *
 * Create agents from JSON/JSONC configuration files without writing code.
 * This is the L1 (zero-code) API that reads configuration and delegates to L2.
 *
 * Usage:
 * ```bash
 * # Run agent from config file
 * npx agentforge run agent.json
 *
 * # Or programmatically
 * import { loadAgent } from 'agentforge/l1';
 * const agent = await loadAgent('agent.json');
 * const result = await agent.run('Hello!');
 * ```
 *
 * @see design/16-CONFIG-MODULE.md
 * @module
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import { z } from 'zod';
import { createAgent, type Agent, type AgentConfig, type CheckpointConfig } from '../api/index.js';

// ============================================================
// L1 Configuration Schema
// ============================================================

/**
 * Model provider configuration
 */
const ModelConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'custom']),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});

/**
 * Tool configuration
 */
const ToolConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  timeout: z.number().positive().optional(),
});

/**
 * L1 Agent configuration schema
 */
export const L1AgentConfigSchema = z.object({
  // Agent identity
  name: z.string().min(1),

  // Model configuration
  model: ModelConfigSchema,

  // Behavior
  maxSteps: z.number().int().positive().default(10),
  timeout: z.number().positive().optional(),
  systemPrompt: z.string().optional(),

  // Tools (list of tool names or detailed configs)
  tools: z.union([z.array(z.string()), z.array(ToolConfigSchema)]).default([]),

  // Preset (production, debug, development, test)
  preset: z.enum(['production', 'debug', 'development', 'test']).optional(),

  // Streaming
  streaming: z.boolean().default(false),

  // Parallel tool calls
  parallelToolCalls: z.boolean().default(true),

  // Retry configuration
  retry: z
    .object({
      maxAttempts: z.number().int().min(0).max(5).default(0),
      delayMs: z.number().positive().default(1000),
    })
    .optional(),

  // Checkpoint configuration
  checkpoint: z
    .object({
      enabled: z.boolean().default(false),
      storage: z.enum(['memory', 'sqlite']).default('memory'),
      path: z.string().optional(),
    })
    .optional(),

  // Observability
  tracing: z
    .union([
      z.boolean(),
      z.object({
        exporter: z.enum(['console', 'otel', 'custom']),
        endpoint: z.string().optional(),
      }),
    ])
    .optional(),

  metrics: z
    .union([
      z.boolean(),
      z.object({
        prefix: z.string().optional(),
      }),
    ])
    .optional(),

  // Extensions
  extensions: z.record(z.unknown()).optional(),
});

export type L1AgentConfig = z.infer<typeof L1AgentConfigSchema>;

// ============================================================
// Configuration Loader
// ============================================================

/**
 * Parse JSONC (JSON with Comments)
 *
 * Simple parser that strips single-line and multi-line comments,
 * then parses as JSON.
 */
function parseJsonc(text: string): unknown {
  // Remove single-line comments
  let cleaned = text.replace(/\/\/.*$/gm, '');
  // Remove multi-line comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove trailing commas
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

  return JSON.parse(cleaned);
}

/**
 * Load and validate a configuration file.
 *
 * @param filePath - Path to the configuration file (JSON or JSONC)
 * @returns Validated L1AgentConfig
 * @throws {Error} If file not found or validation fails
 */
export function loadConfig(filePath: string): L1AgentConfig {
  const resolvedPath = resolve(filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: ${resolvedPath}`);
  }

  const content = readFileSync(resolvedPath, 'utf-8');
  const ext = extname(resolvedPath).toLowerCase();

  let parsed: unknown;
  if (ext === '.jsonc') {
    parsed = parseJsonc(content);
  } else {
    parsed = JSON.parse(content);
  }

  // Validate with Zod (Tier 1 validation)
  const result = L1AgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.errors.map(e => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}

/**
 * Convert L1 config to L2 AgentConfig.
 *
 * @param l1Config - L1 configuration
 * @returns L2 AgentConfig
 */
function toL2Config(l1Config: L1AgentConfig): AgentConfig {
  // Build model config - handle exactOptionalPropertyTypes
  const modelConfig: Record<string, unknown> = {
    provider: l1Config.model.provider,
    model: l1Config.model.model,
  };
  if (l1Config.model.apiKey !== undefined) {
    modelConfig.apiKey = l1Config.model.apiKey;
  }
  if (l1Config.model.baseUrl !== undefined) {
    modelConfig.baseUrl = l1Config.model.baseUrl;
  }
  if (l1Config.model.temperature !== undefined) {
    modelConfig.temperature = l1Config.model.temperature;
  }
  if (l1Config.model.maxTokens !== undefined) {
    modelConfig.maxTokens = l1Config.model.maxTokens;
  }

  const l2Config: AgentConfig = {
    name: l1Config.name,
    model: modelConfig as unknown as AgentConfig['model'],
    maxSteps: l1Config.maxSteps,
    streaming: l1Config.streaming,
    parallelToolCalls: l1Config.parallelToolCalls,
  };

  // Optional fields - only set if defined (exactOptionalPropertyTypes)
  if (l1Config.systemPrompt !== undefined) {
    l2Config.systemPrompt = l1Config.systemPrompt;
  }
  if (l1Config.timeout !== undefined) {
    l2Config.timeout = l1Config.timeout;
  }
  if (l1Config.preset !== undefined) {
    l2Config.preset = l1Config.preset;
  }

  // Tools
  if (l1Config.tools.length > 0) {
    if (typeof l1Config.tools[0] === 'string') {
      l2Config.tools = l1Config.tools as string[];
    } else {
      l2Config.tools = (l1Config.tools as Array<{ name: string; enabled?: boolean }>)
        .filter(t => t.enabled !== false)
        .map(t => t.name);
    }
  }

  // Retry
  if (l1Config.retry) {
    l2Config.retry = l1Config.retry.maxAttempts;
    l2Config.retryDelay = l1Config.retry.delayMs;
  }

  // Checkpoint - convert to CheckpointConfig
  if (l1Config.checkpoint?.enabled) {
    const checkpointConfig: Record<string, unknown> = {
      storage: l1Config.checkpoint.storage,
    };
    if (l1Config.checkpoint.path !== undefined) {
      checkpointConfig.path = l1Config.checkpoint.path;
    }
    l2Config.checkpoint = checkpointConfig as unknown as CheckpointConfig;
  }

  // Tracing - convert to TracingConfig
  if (l1Config.tracing !== undefined) {
    if (typeof l1Config.tracing === 'boolean') {
      l2Config.tracing = l1Config.tracing;
    } else {
      l2Config.tracing = {
        exporter: l1Config.tracing.exporter,
        ...(l1Config.tracing.endpoint !== undefined && { endpoint: l1Config.tracing.endpoint }),
      };
    }
  }

  // Metrics - convert to MetricsConfig
  if (l1Config.metrics !== undefined) {
    if (typeof l1Config.metrics === 'boolean') {
      l2Config.metrics = l1Config.metrics;
    } else {
      l2Config.metrics = {
        ...(l1Config.metrics.prefix !== undefined && { prefix: l1Config.metrics.prefix }),
      };
    }
  }

  return l2Config;
}

// ============================================================
// L1 API - Agent Loader
// ============================================================

/**
 * Load an agent from a configuration file.
 *
 * This is the main L1 API entry point. It reads the configuration
 * file, validates it, and creates an agent instance.
 *
 * @param filePath - Path to the configuration file
 * @returns Agent instance ready to run
 *
 * @example
 * ```typescript
 * // agent.json:
 * // {
 * //   "name": "assistant",
 * //   "model": { "provider": "openai", "model": "gpt-4o" },
 * //   "systemPrompt": "You are a helpful assistant.",
 * //   "maxSteps": 5
 * // }
 *
 * import { loadAgent } from 'agentforge/l1';
 *
 * const agent = await loadAgent('agent.json');
 * const result = await agent.run('Hello!');
 * console.log(result);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function loadAgent(filePath: string): Promise<Agent> {
  const l1Config = loadConfig(filePath);
  const l2Config = toL2Config(l1Config);
  return createAgent(l2Config);
}

/**
 * Load an agent from a configuration object.
 *
 * @param config - L1 configuration object
 * @returns Agent instance ready to run
 *
 * @example
 * ```typescript
 * import { loadAgentFromConfig } from 'agentforge/l1';
 *
 * const agent = await loadAgentFromConfig({
 *   name: 'assistant',
 *   model: { provider: 'openai', model: 'gpt-4o' },
 *   systemPrompt: 'You are a helpful assistant.',
 * });
 *
 * const result = await agent.run('Hello!');
 * ```
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function loadAgentFromConfig(config: L1AgentConfig): Promise<Agent> {
  // Validate config
  const result = L1AgentConfigSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.errors.map(e => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  const l2Config = toL2Config(result.data);
  return createAgent(l2Config);
}

// ============================================================
// Convenience Functions
// ============================================================

/**
 * Run a single prompt using a configuration file.
 *
 * @param filePath - Path to the configuration file
 * @param prompt - The prompt to run
 * @returns Agent response
 *
 * @example
 * ```typescript
 * import { runPrompt } from 'agentforge/l1';
 *
 * const response = await runPrompt('agent.json', 'Hello!');
 * console.log(response);
 * ```
 */
export async function runPrompt(filePath: string, prompt: string): Promise<string> {
  const agent = await loadAgent(filePath);
  return agent.run(prompt);
}

/**
 * Run a single prompt using a configuration object.
 *
 * @param config - L1 configuration object
 * @param prompt - The prompt to run
 * @returns Agent response
 */
export async function runPromptWithConfig(config: L1AgentConfig, prompt: string): Promise<string> {
  const agent = await loadAgentFromConfig(config);
  return agent.run(prompt);
}

// ============================================================
// Schema Export
// ============================================================

export { L1AgentConfigSchema as AgentConfigSchema };
