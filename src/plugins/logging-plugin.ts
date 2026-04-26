/**
 * Logging Plugin - Production-grade structured logging
 *
 * Outputs structured JSON logs for all agent events.
 * - Truncates long content to prevent log bloat
 * - Handles error events with full error details
 * - Non-blocking synchronous execution
 *
 * @module
 */

import type { ObserverPlugin, PluginContext } from './plugin.js';
import type { AgentEvent } from '../core/events.js';

/**
 * Maximum length for string content before truncation
 */
const MAX_CONTENT_LENGTH = 100;

/**
 * Event types that should include full error details
 */
const ERROR_EVENT_TYPES = new Set([
  'agent.error',
  'llm.error',
  'tool.error',
  'subagent.error',
  'mcp.error',
  'workflow.error',
]);

/**
 * Truncate a string to max length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

/**
 * Safely truncate content in event data
 */
function truncateEventData(event: AgentEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (key === 'type' || key === 'timestamp' || key === 'sessionId') {
      continue; // These are already in the log structure
    }

    if (typeof value === 'string') {
      // For error events, keep full error messages
      if (ERROR_EVENT_TYPES.has(event.type) && (key === 'error' || key === 'message')) {
        data[key] = value;
      } else {
        data[key] = truncate(value, MAX_CONTENT_LENGTH);
      }
    } else if (Array.isArray(value)) {
      // Truncate arrays but keep structure
      if (value.length > 5) {
        const firstFive = value.slice(0, 5) as unknown[];
        data[key] = [...firstFive, `...${value.length - 5} more`];
      } else {
        data[key] = value as unknown[];
      }
    } else if (typeof value === 'object' && value !== null) {
      // For objects, create a truncated representation
      data[key] = truncate(JSON.stringify(value), MAX_CONTENT_LENGTH);
    } else {
      data[key] = value;
    }
  }

  return data;
}

/**
 * Production-grade logging plugin
 *
 * Features:
 * - Structured JSON output: { timestamp, sessionId, type, data }
 * - Automatic content truncation (max 100 chars)
 * - Full error details for error events
 * - Non-blocking synchronous execution
 *
 * @example
 * ```typescript
 * const manager = createPluginManager();
 * manager.register(loggingPlugin);
 * ```
 */
export const loggingPlugin: ObserverPlugin = {
  name: 'logging',
  type: 'observer',
  priority: 10,
  eventTypes: [], // Subscribe to all events
  enabled: true,

  observe(event: AgentEvent, ctx: PluginContext): void {
    const logEntry = {
      timestamp: new Date(event.timestamp).toISOString(),
      sessionId: event.sessionId,
      agentName: ctx.agentName,
      type: event.type,
      data: truncateEventData(event),
    };

    // Output structured JSON log
    // eslint-disable-next-line no-console -- Logging plugin intentionally uses console
    console.log(JSON.stringify(logEntry));
  },
};
