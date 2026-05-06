/**
 * Observability Module
 *
 * Production-ready monitoring and diagnostics for AgentForge.
 *
 * @module observability
 */

export { ResourceMonitor, type ResourceMetrics } from './resource-monitor.js';
export { HealthCheckerImpl, type HealthCheckerOptions } from './health-checker.js';
export { MetricsCollectorImpl, type MetricsCollectorOptions } from './metrics-collector.js';

// Pricing
export {
  type ModelPricing,
  type PricingEntry,
  getModelPricing,
  calculateCost,
  calculateCacheSavings,
} from './pricing/pricing-data.js';

// Correlation
export {
  type CorrelationContext,
  runWithCorrelation,
  runWithCorrelationSync,
  getCorrelationContext,
  setCorrelationField,
} from './correlation/correlation-context.js';

// Sensitive Data Filter
export { SensitiveDataFilter } from './sensitive-data-filter.js';

// TraceContext
export type { TraceContext } from './trace-context.js';

// OTel Attributes
export {
  ATTR_OPERATION,
  ATTR_PROVIDER,
  ATTR_REQUEST_MODEL,
  ATTR_USAGE_INPUT_TOKENS,
  ATTR_USAGE_OUTPUT_TOKENS,
  ATTR_AGENT_ID,
  ATTR_AGENT_NAME,
  ATTR_AGENT_DESCRIPTION,
  ATTR_TOOL_NAME,
  ATTR_REQUEST_MESSAGES_COUNT,
  ATTR_REQUEST_MAX_TOKENS,
  ATTR_REQUEST_TOOLS_COUNT,
  ATTR_TOOL_ARGUMENTS_SIZE,
  ATTR_AGENTFORGE_RUN_ID,
  ATTR_AGENTFORGE_STEP,
  ATTR_AGENTFORGE_EVENT,
  ATTR_AGENTFORGE_TOOL_RESULT,
  ATTR_AGENTFORGE_ERROR_CODE,
  ATTR_AGENTFORGE_CACHE_READ_TOKENS,
  ATTR_AGENTFORGE_CACHE_WRITE_TOKENS,
  ATTR_AGENTFORGE_TTFT_MS,
  ATTR_AGENTFORGE_COST,
  ATTR_AGENTFORGE_CACHE_SAVINGS,
  ATTR_AGENTFORGE_TOOL_ERROR_TYPE,
  ATTR_AGENTFORGE_EVAL_SCORE,
  ATTR_AGENTFORGE_EVAL_RUN_ID,
  OPERATION_CHAT,
  OPERATION_EXECUTE_TOOL,
  OPERATION_AGENT_RUN,
  OPERATION_AGENT_STEP,
  type LLMRequestInfo,
  type ToolExecutionInfo,
  extractLLMAttributes,
  extractToolAttributes,
} from './tracers/otel-attributes.js';
