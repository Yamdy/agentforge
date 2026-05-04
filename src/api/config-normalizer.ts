/**
 * AgentConfig normalization layer.
 *
 * Accepts AgentConfig in both legacy flat format and new grouped format,
 * resolves all defaults, and produces a fully populated NormalizedAgentConfig.
 */

import type { Message } from '../core/events.js';
import type { ToolDefinition } from '../core/interfaces.js';
import { parseModelSpec } from '../adapters/index.js';
import type { Plugin } from '../plugins/index.js';
import type { PluginSpec } from '../plugins/plugin-loader.js';
import type {
  AgentConfig,
  AgentModelConfig,
  HITLConfig,
  TracingConfig,
  MetricsConfig,
  CheckpointConfig,
  SubagentConfig,
  MCPServerConfig,
} from './types.js';

// ============================================================
// Normalized Config
// ============================================================

export interface NormalizedAgentConfig {
  name: string;
  model: { provider: string; model: string };
  llmOptions: Record<string, unknown> | undefined;
  systemPrompt: string | undefined;
  history: Message[] | undefined;
  maxSteps: number;
  toolSpecs: (string | ToolDefinition)[];
  parallelToolCalls: boolean;
  streaming: boolean;
  executionMode: 'react' | 'plan-then-execute' | 'plan-then-execute-strict';
  timeout: number | undefined;
  tokenBudget: number | undefined;
  retry: number;
  retryDelay: number;
  maxLLMRepairAttempts: number;
  hitl: HITLConfig | undefined;
  tracing: boolean | TracingConfig | undefined;
  metrics: boolean | MetricsConfig | undefined;
  checkpoint: boolean | CheckpointConfig | undefined;
  preset: 'production' | 'debug' | 'development' | 'test' | undefined;
  memory: AgentConfig['memory'] | undefined;
  skills: AgentConfig['skills'] | undefined;
  summarization: AgentConfig['summarization'] | undefined;
  compaction: AgentConfig['compaction'] | undefined;
  subagents: SubagentConfig[] | undefined;
  mcp: MCPServerConfig[] | undefined;
  plugins: Plugin[] | undefined;
  pluginSpecs: PluginSpec[] | undefined;
}

// ============================================================
// Defaults
// ============================================================

const DEFAULTS = {
  name: 'agent',
  maxSteps: 10,
  parallelToolCalls: true,
  streaming: false,
  retry: 0,
  retryDelay: 1000,
  maxLLMRepairAttempts: 3,
  executionMode: 'react' as const,
};

// ============================================================
// Normalize
// ============================================================

export function normalizeConfig(raw: AgentConfig): NormalizedAgentConfig {
  return {
    // Core identity
    name: raw.name ?? DEFAULTS.name,
    model: resolveModel(raw.model),
    llmOptions: raw.llmOptions,
    systemPrompt: raw.systemPrompt,
    history: raw.history,
    maxSteps: raw.maxSteps ?? DEFAULTS.maxSteps,
    toolSpecs: raw.tools ?? [],

    // Execution — grouped > flat > default
    parallelToolCalls:
      raw.execution?.parallelToolCalls ?? raw.parallelToolCalls ?? DEFAULTS.parallelToolCalls,
    streaming: raw.execution?.streaming ?? raw.streaming ?? DEFAULTS.streaming,
    executionMode: raw.execution?.executionMode ?? raw.executionMode ?? DEFAULTS.executionMode,

    // Controls — grouped > flat > default
    timeout: raw.controls?.timeout ?? raw.timeout,
    tokenBudget: raw.controls?.tokenBudget ?? raw.tokenBudget,
    retry: raw.controls?.retry ?? raw.retry ?? DEFAULTS.retry,
    retryDelay: raw.controls?.retryDelay ?? raw.retryDelay ?? DEFAULTS.retryDelay,
    maxLLMRepairAttempts:
      raw.controls?.maxLLMRepairAttempts ??
      raw.maxLLMRepairAttempts ??
      DEFAULTS.maxLLMRepairAttempts,
    hitl: raw.controls?.hitl ?? raw.hitl,

    // Observability — grouped > flat
    tracing: raw.observability?.tracing ?? raw.tracing,
    metrics: raw.observability?.metrics ?? raw.metrics,
    checkpoint: raw.observability?.checkpoint ?? raw.checkpoint,
    preset: raw.observability?.preset ?? raw.preset,

    // Extensions — grouped > flat
    memory: raw.extensions?.memory ?? raw.memory,
    skills: raw.extensions?.skills ?? raw.skills,
    summarization: raw.extensions?.summarization ?? raw.summarization,
    compaction: raw.extensions?.compaction ?? raw.compaction,
    subagents: raw.extensions?.subagents ?? raw.subagents,
    mcp: raw.extensions?.mcp ?? raw.mcp,

    // Plugins — grouped > flat
    plugins: raw.pluginsConfig?.plugins ?? raw.plugins,
    pluginSpecs: raw.pluginsConfig?.pluginSpecs ?? raw.pluginSpecs,
  };
}

function resolveModel(raw: string | AgentModelConfig | undefined): {
  provider: string;
  model: string;
} {
  if (typeof raw === 'string') {
    return parseModelSpec(raw);
  }
  if (raw && typeof raw === 'object') {
    const r = raw as { provider?: string; model?: string };
    return {
      provider: r.provider ?? 'openai',
      model: r.model ?? 'gpt-4o',
    };
  }
  return { provider: 'openai', model: 'gpt-4o' };
}
