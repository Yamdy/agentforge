export { AgentForgeServer, type ServerOptions, type A2AOptions, type CorsOptions, type ServerHandle } from './server.js';
export { AgentRegistry } from './registry.js';
export { AgentForgeClient } from './client.js';
export { StaticKeyAuthAdapter } from './middleware/static-key-auth.js';
export { serializeSSE, parseSSE } from './sse.js';

// Profiles
export { ProfileLoader, mergeProfiles, applyProfile, builtinProfiles } from './profiles/index.js';
export { codingAgentProfile, businessAgentProfile, personalAgentProfile, dataAgentProfile } from './profiles/index.js';

// A2A Protocol
export { InMemoryTaskStore } from './a2a/task-store.js';
export { JsonlTaskStore } from './a2a/jsonl-task-store.js';
export { buildAgentCard, type AgentCardOptions } from './a2a/agent-card.js';
export { A2ARequestHandler, type A2ARequestHandlerOptions } from './a2a/server.js';
export { A2AClient, type A2AClientOptions } from './a2a/client.js';
export { a2aRoutes, type A2ARoutesOptions, a2aMultiAgentRoutes, type A2AMultiAgentRoutesOptions } from './a2a/routes.js';
export type {
  A2ATask, A2ATaskState, A2AMessage, A2APart, A2AArtifact,
  A2AAgentCard, AgentSkill, AgentCapabilities,
  A2AStreamEvent, TaskStatusUpdateEvent, TaskArtifactUpdateEvent,
  JsonRpcRequest, JsonRpcResponse, A2A_ERROR_CODES,
} from './a2a/types.js';
