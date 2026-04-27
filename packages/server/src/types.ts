import type { AgentEvent, DefaultHITLController } from '@primo512109/agentforge';
import type { L1AgentConfig } from '@primo512109/agentforge';

/**
 * A chat message in a session.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
}

/**
 * A session represents a conversation with an agent.
 *
 * The HITL controller lives as long as the session, not the agent instance,
 * because each chat turn creates a new ephemeral agent with accumulated history.
 */
export interface Session {
  id: string;
  agentConfigId: string;
  configOverrides?: Partial<L1AgentConfig>;
  messages: ChatMessage[];
  events: AgentEvent[];
  /** HITL controller lives as long as the session, not the agent instance */
  hitlController: DefaultHITLController;
  /** Tracks active run for concurrency control and cancellation */
  activeRun: AbortController | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request context passed to every HTTP handler.
 */
export interface RequestContext {
  server: AgentForgeServer;
  params: Record<string, string>;
  /** Parsed from URL query string */
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  request: Request;
}

/**
 * The server state container. Holds all stores and factories.
 */
export interface AgentForgeServer {
  configStore: import('./config-store.js').ConfigStore;
  sessionStore: import('./session-store.js').InMemorySessionStore;
  agentFactory: import('./agent-factory.js').AgentFactory;
  configDir: string;
  version: string;
}