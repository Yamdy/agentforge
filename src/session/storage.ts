import { Storage, NotFoundError } from '../storage/index.js';

export interface SessionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
}

export interface Session {
  id: string;
  title: string;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
  compactedAt?: number;
  parentId?: string;
  projectId?: string;
}

export async function createSession(
  id: string,
  title: string,
  options?: { parentId?: string; projectId?: string; messages?: SessionMessage[] }
): Promise<Session> {
  const now = Date.now();
  const session: Session = {
    id,
    title,
    messages: options?.messages ?? [],
    createdAt: now,
    updatedAt: now,
    parentId: options?.parentId,
    projectId: options?.projectId,
  };

  await Storage.write(['session', id], session);
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  try {
    return await Storage.read<Session>(['session', id]);
  } catch (e) {
    if (e instanceof NotFoundError) {
      return null;
    }
    throw e;
  }
}

export async function listSessions(options?: {
  limit?: number;
  offset?: number;
  parentId?: string;
  projectId?: string;
}): Promise<Session[]> {
  const allSessions = await Storage.list(['session']);
  let sessions: Session[] = [];

  for (const key of allSessions) {
    try {
      const session = await Storage.read<Session>(['session', key[key.length - 1]]);
      sessions.push(session);
    } catch {
      // Skip invalid entries
    }
  }

  sessions = sessions.sort((a, b) => b.updatedAt - a.updatedAt);

  if (options?.parentId) {
    sessions = sessions.filter((s) => s.parentId === options.parentId);
  }
  if (options?.projectId) {
    sessions = sessions.filter((s) => s.projectId === options.projectId);
  }

  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 50;
  return sessions.slice(offset, offset + limit);
}

export async function updateSession(
  id: string,
  updates: Partial<Pick<Session, 'title' | 'messages' | 'parentId' | 'projectId'>>
): Promise<Session | null> {
  const current = await getSession(id);
  if (!current) return null;

  const now = Date.now();
  const updated: Session = {
    ...current,
    title: updates.title ?? current.title,
    messages: updates.messages ?? current.messages,
    parentId: updates.parentId !== undefined ? updates.parentId : current.parentId,
    projectId: updates.projectId !== undefined ? updates.projectId : current.projectId,
    updatedAt: now,
  };

  await Storage.write(['session', id], updated);
  return updated;
}

export async function addMessageToSession(id: string, message: SessionMessage): Promise<Session | null> {
  const current = await getSession(id);
  if (!current) return null;

  const messages = [...current.messages, { ...message, timestamp: message.timestamp ?? Date.now() }];
  return updateSession(id, { messages });
}

export async function deleteSession(id: string): Promise<boolean> {
  const session = await getSession(id);
  if (!session) return false;

  await Storage.remove(['session', id]);
  return true;
}

export async function markSessionCompacted(id: string): Promise<void> {
  const current = await getSession(id);
  if (!current) return;

  await Storage.write(['session', id], {
    ...current,
    compactedAt: Date.now(),
  });
}

export function closeSessionStorage(): void {
  // No-op for file-based storage
}

export async function initSessionStorage(): Promise<void> {
  // No-op for file-based storage - directory created on demand
}
