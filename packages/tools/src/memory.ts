import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export interface MemoryStore {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  list(): Promise<Array<{ key: string; value: string }>>;
}

export function createInMemoryStore(): MemoryStore {
  const store = new Map<string, string>();
  return {
    async set(k: string, v: string) {
      store.set(k, v);
    },
    async get(k: string) {
      return store.get(k);
    },
    async list() {
      return [...store.entries()].map(([key, value]) => ({ key, value }));
    },
  };
}

export interface MemoryToolsOptions {
  store?: MemoryStore;
}

export function createMemoryTools(options: MemoryToolsOptions = {}) {
  const store = options.store ?? createInMemoryStore();

  const storeTool = {
    name: 'memory_store',
    description: 'Store a value in memory for later retrieval.',
    inputSchema: z.object({
      key: z.string().describe('The key to store under'),
      value: z.string().describe('The value to store'),
    }),
    outputSchema: z.object({ success: z.boolean() }),
    requireApproval: false,
    async execute(input: { key: string; value: string }) {
      await store.set(input.key, input.value);
      return { success: true };
    },
    renderCall: (i: { key: string }) => `memory_store("${i.key}", ...)`,
    renderResult: () => 'Stored',
  } as Tool<{ key: string; value: string }, { success: boolean }>;

  const retrieveTool = {
    name: 'memory_retrieve',
    description: 'Retrieve a stored value from memory.',
    inputSchema: z.object({
      key: z.string().describe('The key to retrieve'),
    }),
    outputSchema: z.object({ value: z.string().optional() }),
    requireApproval: false,
    async execute(input: { key: string }) {
      return { value: await store.get(input.key) };
    },
    renderCall: (i: { key: string }) => `memory_retrieve("${i.key}")`,
    renderResult: (o: { value?: string }) => o.value ?? 'Not found',
  } as Tool<{ key: string }, { value?: string }>;

  const listTool = {
    name: 'memory_list',
    description: 'List all stored entries in memory.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      items: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
    requireApproval: false,
    async execute() {
      return { items: await store.list() };
    },
    renderCall: () => 'memory_list()',
    renderResult: (o: { items: unknown[] }) => `${o.items.length} items`,
  } as Tool<Record<string, never>, { items: Array<{ key: string; value: string }> }>;

  return { storeTool, retrieveTool, listTool };
}

const defaultTools = createMemoryTools();
export const memoryStoreTool = defaultTools.storeTool;
export const memoryRetrieveTool = defaultTools.retrieveTool;
export const memoryListTool = defaultTools.listTool;
