import { AsyncLocalStorage } from 'node:async_hooks';
import type { Message } from './types.js';

interface CurrentContext {
  messages: Message[];
  sessionId?: string;
  userId?: string;
  tenantId?: string;
  requestId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

const asyncLocalStorage = new AsyncLocalStorage<CurrentContext>();

export function setCurrentMemory(context: CurrentContext): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, { ...context, messages: [...context.messages] });
  } else {
    asyncLocalStorage.enterWith({ ...context, messages: [...context.messages] });
  }
}

export function getCurrentMemory(): CurrentContext | null {
  return asyncLocalStorage.getStore() ?? null;
}

export function clearCurrentMemory(): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.messages = [];
    store.sessionId = undefined;
    store.userId = undefined;
    store.tenantId = undefined;
    store.requestId = undefined;
    store.traceId = undefined;
    store.metadata = undefined;
  }
}

export { asyncLocalStorage };
