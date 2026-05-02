/**
 * SubAgent Types
 *
 * Internal types for subagent execution logic.
 * These types extend the interfaces.ts definitions with implementation-specific details.
 *
 * @module agentforge/subagent
 */

import type { AgentEvent, Message } from '../core/events.js';
import type { AgentMode } from '../core/interfaces.js';

/**
 * Agent Loop type reference.
 *
 * Matches the real AgentLoop interface from loop/agent-loop.ts (Promise-based).
 */
export interface AgentLoop {
  /** Run the agent with input, returns output via Promise */
  run(input: string): Promise<string>;
  /** Subscribe to specific event types */
  on(type: string, listener: (event: AgentEvent) => void): () => void;
  /** Subscribe to all events */
  onAny(listener: (event: AgentEvent) => void): () => void;
}

/**
 * Subagent execution mode
 */
export type SubagentMode = 'sync' | 'async' | 'compiled';

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

  /** Subagent execution mode */
  executionMode?: SubagentMode;

  /** Optional configuration passed to the agent */
  config?: Record<string, unknown>;

  /** Compiled mode configuration */
  compiledConfig?: {
    model: { provider: string; model: string };
    tools: string[];
    systemPrompt?: string;
    maxSteps?: number;
  };

  /** Async mode configuration */
  asyncConfig?: {
    onComplete?: (result: SubagentAsyncResult) => void;
    onError?: (error: Error) => void;
  };
}

/**
 * Result of an async subagent execution
 */
export interface SubagentAsyncResult {
  sessionId: string;
  status: 'completed' | 'error' | 'cancelled';
  output?: string;
  error?: Error;
  events: AgentEvent[];
}

/**
 * Handle for an async subagent execution
 */
export interface AsyncSubagentHandle {
  sessionId: string;
  status(): Promise<'running' | 'completed' | 'error'>;
  result(): Promise<SubagentAsyncResult>;
  cancel(): Promise<void>;
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
