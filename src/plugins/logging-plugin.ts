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

import type { Plugin, PluginContext } from './plugin.js';
import type { AgentEvent, AgentEventType } from '../core/events.js';

/**
 * Maximum length for string content before truncation
 */
const MAX_CONTENT_LENGTH = 100;

/**
 * Event types that should include full error details
 */
const ERROR_EVENT_TYPES = new Set(['agent.error', 'llm.error', 'tool.error']);

/**
 * Event types to subscribe to
 */
const SUBSCRIBED_EVENTS: AgentEventType[] = [
  'agent.start',
  'agent.complete',
  'agent.error',
  'llm.request',
  'llm.response',
  'tool.result',
  'state.change',
  'permission',
  'done',
];

/**
 * Per-session agent name, captured via init().
 */
let _agentName = '';

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
 * Shared event handler — logs any subscribed event.
 */
function handleEvent(event: AgentEvent): void {
  const logEntry = {
    timestamp: new Date(event.timestamp).toISOString(),
    sessionId: event.sessionId,
    agentName: _agentName,
    type: event.type,
    data: truncateEventData(event),
  };

  // Output structured JSON log
  // eslint-disable-next-line no-console -- Logging plugin intentionally uses console
  console.log(JSON.stringify(logEntry));
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
export const loggingPlugin: Plugin = {
  name: 'logging',
  enabled: true,

  init(ctx: PluginContext): void {
    _agentName = ctx.agentName;
  },

  eventSubscriptions: SUBSCRIBED_EVENTS.map(evt => ({
    event: evt,
    handler: handleEvent,
  })),
};
