/**
 * SubAgent Types
 *
 * Internal types for subagent execution logic.
 * These types extend the interfaces.ts definitions with implementation-specific details.
 *
 * @module agentforge/subagent
 */

import type { Observable } from 'rxjs';
import type { AgentEvent, Message } from '../core/events.js';
import type { AgentMode } from '../core/interfaces.js';

/**
 * Agent Loop type reference.
 *
 * The AgentLoop interface is defined in loop/agent-loop.ts and provides
 * the run() method for executing agent logic.
 */
export interface AgentLoop {
  /** Run the agent with input, returns event stream */
  run(input: string): Observable<AgentEvent>;
  /** Destroy signal for cleanup */
  destroy$: Observable<void>;
}

/**
 * Subagent configuration for registration.
 *
 * Contains all information needed to register and run a subagent.
 * This is the internal representation that includes the AgentLoop reference.
 */
export interface SubagentConfig {
  /** Unique name for the subagent (used as tool name) */
  name: string;

  /** Human-readable description for tool definition */
  description?: string;

  /** Reference to the agent loop instance */
  agent: AgentLoop;

  /** Agent mode (primary, subagent, or all) */
  mode?: AgentMode;

  /** Optional configuration passed to the agent */
  config?: Record<string, unknown>;
}

/**
 * Options for running a subagent.
 */
export interface SubagentRunOptions {
  /** Existing conversation messages to include in context */
  sessionMessages?: Message[];

  /** Parent session ID for event correlation */
  parentSessionId?: string;

  /** Parent tool call ID for event correlation */
  parentToolCallId?: string;
}

/**
 * Result of a subagent execution.
 *
 * Contains the output and metadata from a completed subagent run.
 */
export interface SubagentResult {
  /** Final output from the subagent */
  output: string;

  /** Number of steps executed */
  steps: number;

  /** Token usage if available */
  tokens?: {
    prompt: number;
    completion: number;
  };

  /** Whether the execution ended in error */
  isError: boolean;

  /** Error details if execution failed */
  error?: {
    name: string;
    message: string;
  };
}

/**
 * Internal subagent entry stored in the registry.
 */
export interface SubagentEntry {
  /** The configuration for this subagent */
  config: SubagentConfig;

  /** Registration timestamp */
  registeredAt: number;
}
