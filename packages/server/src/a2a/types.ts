// A2A Protocol Types — v1.0 spec

// ---------------------------------------------------------------------------
// Task States
// ---------------------------------------------------------------------------

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'input-required'
  | 'auth-required'
  | 'rejected';

export const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set([
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

export const INTERRUPTED_STATES: ReadonlySet<A2ATaskState> = new Set([
  'input-required',
  'auth-required',
]);

export function isTerminal(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

// ---------------------------------------------------------------------------
// Valid state transitions (from A2A v1.0 spec)
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Map<A2ATaskState, Set<A2ATaskState>> = new Map([
  ['submitted', new Set(['working', 'rejected'])],
  ['working', new Set(['completed', 'failed', 'canceled', 'input-required', 'auth-required'])],
  ['input-required', new Set(['working'])],
  ['auth-required', new Set(['working'])],
  ['completed', new Set()],
  ['failed', new Set()],
  ['canceled', new Set()],
  ['rejected', new Set()],
]);

export function isValidTransition(from: A2ATaskState, to: A2ATaskState): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

// ---------------------------------------------------------------------------
// Parts (discriminated union)
// ---------------------------------------------------------------------------

export interface TextPart {
  kind: 'text';
  text: string;
}

export interface DataPart {
  kind: 'data';
  data: Record<string, unknown>;
}

export interface FilePart {
  kind: 'file';
  url?: string;
  bytes?: string;
  mimeType?: string;
  filename?: string;
}

export type A2APart = TextPart | DataPart | FilePart;

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export type A2ARole = 'user' | 'agent';

export interface A2AMessage {
  kind: 'message';
  messageId: string;
  role: A2ARole;
  parts: A2APart[];
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp: string;
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  history?: A2AMessage[];
  artifacts?: A2AArtifact[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
}

export interface A2AAgentCard {
  name: string;
  description: string;
  version: string;
  url: string;
  skills: AgentSkill[];
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  provider?: { url: string; organization: string };
  documentationUrl?: string;
  iconUrl?: string;
}

// ---------------------------------------------------------------------------
// Streaming Events
// ---------------------------------------------------------------------------

export interface TaskStatusUpdateEvent {
  kind: 'status-update';
  taskId: string;
  contextId: string;
  status: A2ATaskStatus;
  metadata?: Record<string, unknown>;
}

export interface TaskArtifactUpdateEvent {
  kind: 'artifact-update';
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export type A2AStreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: string | number;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export const A2A_ERROR_CODES = {
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
} as const;
