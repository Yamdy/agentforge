// ── Working Memory ──────────────────────────────────────────────

export interface WorkingMemory {
  userProfile: {
    name?: string;
    preferences: Record<string, unknown>;
    goals: string[];
    constraints: string[];
  };
  taskState: {
    currentGoal: string;
    progress: number;
    blockers: string[];
    nextSteps: string[];
  };
  injection: {
    template: string;
    scope: 'thread' | 'resource';
  };
}

// ── Episodic Memory ─────────────────────────────────────────────

export interface MemoryEvent {
  id: string;
  timestamp: string;
  type: 'user_input' | 'agent_response' | 'tool_call' | 'decision';
  content: string;
  importance: number;
  metadata?: Record<string, unknown>;
}

export interface EventQuery {
  timeRange?: { start: string; end: string };
  minImportance?: number;
  types?: string[];
  limit?: number;
}

// ── Semantic Memory ─────────────────────────────────────────────

export interface Fact {
  id: string;
  content: string;
  embedding?: number[];
  scope: string;
  categories: string[];
  importance: number;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
}

export interface SearchOptions {
  topK?: number;
  scope?: string;
  minImportance?: number;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  attributes: Record<string, unknown>;
}

export interface Relation {
  from: string;
  to: string;
  type: string;
  weight: number;
}

// ── Memory System ───────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  content: string;
  type: 'fact' | 'event' | 'working';
  score: number;
  timestamp: string;
}

export interface RememberOptions {
  scope?: string;
  categories?: string[];
  importance?: number;
  type?: 'fact' | 'event' | 'preference';
}

export interface RecallOptions {
  topK?: number;
  scope?: string;
  timeRange?: { start: string; end: string };
}

export interface ConsolidationResult {
  deduped: number;
  merged: number;
  forgotten: number;
  newFacts: number;
}

// ── Storage Backend ─────────────────────────────────────────────

export interface MemoryStorage {
  getWorkingMemory(scope: string): Promise<WorkingMemory | undefined>;
  setWorkingMemory(scope: string, memory: WorkingMemory): Promise<void>;

  appendEvent(scope: string, event: MemoryEvent): Promise<void>;
  getEvents(scope: string, query?: EventQuery): Promise<MemoryEvent[]>;

  upsertFact(scope: string, fact: Fact): Promise<void>;
  getFacts(scope: string, query?: SearchOptions): Promise<Fact[]>;
  searchFacts(query: string, options?: SearchOptions): Promise<Fact[]>;
  deleteFact(scope: string, factId: string): Promise<void>;

  upsertEntity(entity: Entity): Promise<void>;
  getEntity(id: string): Promise<Entity | undefined>;
  upsertRelation(relation: Relation): Promise<void>;
  getRelations(from?: string, to?: string): Promise<Relation[]>;
}
