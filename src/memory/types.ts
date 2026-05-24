import { z } from 'zod';
import type { Message } from '../types.js';

// Re-export Checkpoint type from session for convenience
export type { Checkpoint } from '../session/types.js';

// === AgentState ===
/**
 * Represents the persistent state of an agent within a session.
 * Used for checkpointing and resuming agent execution.
 */
export const AgentStateSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  agentName: z.string(),
  status: z.enum(['pending', 'running', 'paused', 'completed', 'cancelled', 'error']),
  step: z.number().int().nonnegative(),
  maxSteps: z.number().int().positive(),
  error: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// === Thread ===
export const ThreadSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Thread = z.infer<typeof ThreadSchema>;

export interface ListThreadsOptions {
  limit?: number;
  offset?: number;
}

// === Observation ===
export const ObservationSchema = z.object({
  id: z.string(),
  content: z.string(),
  timestamp: z.date(),
  compressionLevel: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .optional(),
});

export type Observation = z.infer<typeof ObservationSchema>;

// === WorkingMemory ===
export const WorkingMemorySchema = z.object({
  content: z.string(),
  updatedAt: z.date(),
});

export type WorkingMemory = z.infer<typeof WorkingMemorySchema>;

// === MemoryStorage 接口 ===
export interface MemoryStorage {
  // Thread operations
  getThread(threadId: string): Promise<Thread | null>;
  saveThread(thread: Thread): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
  listThreads(options?: ListThreadsOptions): Promise<Thread[]>;

  // Message operations
  getMessages(threadId: string): Promise<Message[]>;
  addMessage(threadId: string, message: Message): Promise<void>;

  // WorkingMemory operations
  getWorkingMemory(threadId: string): Promise<WorkingMemory | null>;
  saveWorkingMemory(threadId: string, memory: WorkingMemory): Promise<void>;

  // ObservationalMemory operations (optional)
  getObservationalMemory?(threadId: string): Promise<Observation[] | null>;
  saveObservationalMemory?(threadId: string, observations: Observation[]): Promise<void>;

  // AgentState operations (optional)
  getAgentState?(sessionId: string, agentName: string): Promise<AgentState | null>;
  saveAgentState?(state: AgentState): Promise<AgentState>;
  deleteAgentState?(sessionId: string, agentName: string): Promise<void>;
  listAgentStates?(sessionId: string): Promise<AgentState[]>;

  // Checkpoint operations (optional)
  getCheckpoint?(checkpointId: string): Promise<import('../session/types.js').Checkpoint | null>;
  saveCheckpoint?(checkpoint: import('../session/types.js').Checkpoint): Promise<import('../session/types.js').Checkpoint>;
  listCheckpoints?(sessionId: string): Promise<import('../session/types.js').Checkpoint[]>;
  deleteCheckpoint?(checkpointId: string): Promise<boolean>;
}

// === Configs ===
export const MessageHistoryConfigSchema = z.object({
  lastMessages: z.number().optional().default(20),
});

export type MessageHistoryConfig = z.infer<typeof MessageHistoryConfigSchema>;

export const WorkingMemoryConfigSchema = z.object({
  enabled: z.boolean(),
  template: z.string().optional(),
});

export type WorkingMemoryConfig = z.infer<typeof WorkingMemoryConfigSchema>;

export const ObservationalMemoryConfigSchema = z.object({
  enabled: z.boolean(),
  compressionLevel: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .optional()
    .default(2),
});

export type ObservationalMemoryConfig = z.infer<typeof ObservationalMemoryConfigSchema>;

export const MemoryManagerConfigSchema = z.object({
  threadId: z.string().optional(),
  messageHistory: MessageHistoryConfigSchema.optional(),
  workingMemory: WorkingMemoryConfigSchema.optional(),
  observationalMemory: ObservationalMemoryConfigSchema.optional(),
  storage: z.custom<MemoryStorage>().optional(),
});

export type MemoryManagerConfig = z.infer<typeof MemoryManagerConfigSchema>;

// === Schemas export
export const schemas = {
  Thread: ThreadSchema,
  Observation: ObservationSchema,
  WorkingMemory: WorkingMemorySchema,
  AgentState: AgentStateSchema,
  MessageHistoryConfig: MessageHistoryConfigSchema,
  WorkingMemoryConfig: WorkingMemoryConfigSchema,
  ObservationalMemoryConfig: ObservationalMemoryConfigSchema,
  MemoryManagerConfig: MemoryManagerConfigSchema,
} as const;

export type Schemas = typeof schemas;
