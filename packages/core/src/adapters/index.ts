/**
 * Adapters provide high-level APIs for common Processor patterns.
 */

export { modifiers, message, systemPrompt, tools, providerOptions } from './modifiers.js';
export { gates, permission, quota, cost } from './gates.js';
export type { PermissionDecision, PermissionGateConfig, QuotaGateConfig, CostGateConfig } from './gates.js';
