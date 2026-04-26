/**
 * Shared type definitions for {{config.agentName}}.
 */

/**
 * Agent output result type.
 */
export interface AgentOutput {
  /** Final response text */
  text: string;
  /** Number of steps executed */
  steps: number;
  /** Total tokens used */
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Custom tool context for this agent.
 */
export interface CustomToolContext {
  /** Session identifier */
  sessionId: string;
  /** User ID if available */
  userId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}