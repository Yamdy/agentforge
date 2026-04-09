import type { Message } from './types.js';

interface CurrentContext {
  messages: Message[];
  sessionId?: string;
}

let currentContext: CurrentContext | null = null;

export function setCurrentMemory(context: CurrentContext): void {
  currentContext = { ...context };
}

export function getCurrentMemory(): CurrentContext | null {
  return currentContext;
}

export function clearCurrentMemory(): void {
  currentContext = null;
}
