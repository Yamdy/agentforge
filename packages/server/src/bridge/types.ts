// WebSocket Bridge — Protocol Types

// ---------------------------------------------------------------------------
// Client -> Server Commands
// ---------------------------------------------------------------------------

export interface WSRunCommand {
  type: 'run';
  agentId: string;
  input: string;
  requestId: string;
}

export interface WSStreamCommand {
  type: 'stream';
  agentId: string;
  input: string;
  requestId: string;
}

export interface WSResumeCommand {
  type: 'resume';
  agentId: string;
  sessionId: string;
  requestId: string;
}

export interface WSCancelCommand {
  type: 'cancel';
  requestId: string;
}

export interface WSPingCommand {
  type: 'ping';
}

export type WSCommand =
  | WSRunCommand
  | WSStreamCommand
  | WSResumeCommand
  | WSCancelCommand
  | WSPingCommand
  | { type: string; requestId?: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Server -> Client Events
// ---------------------------------------------------------------------------

export interface WSRunResultEvent {
  type: 'run_result';
  requestId: string;
  response: string;
  tokenUsage: { input: number; output: number };
  sessionId: string;
}

export interface WSStreamEvent {
  type: 'stream_event';
  requestId: string;
  event: unknown;
}

export interface WSStreamCompleteEvent {
  type: 'stream_complete';
  requestId: string;
}

export interface WSToolCallEvent {
  type: 'tool_call';
  requestId: string;
  name: string;
  args: unknown;
}

export interface WSStateEvent {
  type: 'state';
  agentId: string;
  state: string;
}

export interface WSErrorEvent {
  type: 'error';
  requestId?: string;
  message: string;
  correlationId?: string;
}

export interface WSCancelledEvent {
  type: 'cancelled';
  requestId: string;
}

export interface WSPongEvent {
  type: 'pong';
}

export type WSMessage =
  | WSRunResultEvent
  | WSStreamEvent
  | WSStreamCompleteEvent
  | WSToolCallEvent
  | WSStateEvent
  | WSErrorEvent
  | WSCancelledEvent
  | WSPongEvent;

// ---------------------------------------------------------------------------
// Connection Tracking
// ---------------------------------------------------------------------------

/**
 * Minimal socket interface — matches Node.js `ws` WebSocket and test mocks.
 * Avoids dependency on DOM WebSocket type.
 */
export interface WSSocket {
  send(data: string): void;
  close(): void;
  on(event: 'message', handler: (data: unknown) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (err: unknown) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export interface BridgeConnection {
  readonly id: string;
  readonly socket: WSSocket;
}
