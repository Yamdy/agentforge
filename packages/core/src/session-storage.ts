import type { SessionEvent, SessionRecord, SessionStorage, SessionStatus } from '@primo-ai/sdk';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class FilesystemSessionStorage implements SessionStorage {
  constructor(private basePath: string) {}

  private validateSessionId(sessionId: string): void {
    if (new RegExp('[/\\\\]|\\.\\.').test(sessionId)) {
      throw new Error(`Invalid sessionId: ${sessionId}`);
    }
  }

  async append(sessionId: string, event: SessionEvent): Promise<void> {
    this.validateSessionId(sessionId);
    const dir = this.sessionDir(sessionId);
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify(event) + '\n';
    await appendFile(this.eventsPath(sessionId), line, 'utf-8');
  }

  async *read(sessionId: string): AsyncIterable<SessionEvent> {
    this.validateSessionId(sessionId);
    const filePath = this.eventsPath(sessionId);
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return;
    }
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        yield JSON.parse(trimmed) as SessionEvent;
      } catch {
        // Skip malformed lines (e.g. truncated writes from crash)
      }
    }
  }

  async list(filter?: { parentSessionId?: string; status?: SessionStatus }): Promise<SessionRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.basePath);
    } catch {
      return [];
    }

    const records: SessionRecord[] = [];
    for (const sessionId of entries) {
      const meta = await this.readMeta(sessionId);
      if (!meta) continue;
      if (filter?.parentSessionId && meta.parentSessionId !== filter.parentSessionId) continue;
      if (filter?.status && meta.status !== filter.status) continue;
      records.push(meta);
    }
    return records;
  }

  async updateMeta(sessionId: string, meta: Partial<SessionRecord>): Promise<void> {
    this.validateSessionId(sessionId);
    const existing = await this.readMeta(sessionId);
    const updated: SessionRecord = {
      ...(existing ?? this.defaultRecord(sessionId)),
      ...meta,
      updatedAt: new Date().toISOString(),
    };
    const dir = this.sessionDir(sessionId);
    await mkdir(dir, { recursive: true });
    await writeFile(this.metaPath(sessionId), JSON.stringify(updated), 'utf-8');
  }

  private sessionDir(sessionId: string): string {
    return join(this.basePath, sessionId);
  }

  private eventsPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), 'events.jsonl');
  }

  private metaPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), 'meta.json');
  }

  private async readMeta(sessionId: string): Promise<SessionRecord | undefined> {
    try {
      const content = await readFile(this.metaPath(sessionId), 'utf-8');
      return JSON.parse(content) as SessionRecord;
    } catch {
      return undefined;
    }
  }

  private defaultRecord(sessionId: string): SessionRecord {
    const now = new Date().toISOString();
    return {
      sessionId,
      createdAt: now,
      updatedAt: now,
      status: 'active',
    };
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    return this.readMeta(sessionId);
  }

  async delete(sessionId: string): Promise<void> {
    const dir = this.sessionDir(sessionId);
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  }

  async getMessages(sessionId: string, options?: { limit?: number; before?: string }): Promise<import('@primo-ai/sdk').Message[]> {
    const events: SessionEvent[] = [];
    for await (const event of this.read(sessionId)) {
      events.push(event);
    }

    if (events.length === 0) return [];

    // Rebuild Message[] from events — same logic as SessionManagerImpl.restore()
    const messages: import('@primo-ai/sdk').Message[] = [];
    let toolCallIdx = 0;

    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (!payload) continue;

      switch (event.type) {
        case 'agent:start': {
          const input = ((payload.request as Record<string, unknown> | undefined)?.input ?? payload.input) as string | undefined;
          if (input) {
            messages.push({ role: 'user', content: input });
          }
          break;
        }
        case 'iteration:end':
        case 'iteration.end': {
          if (payload.response) {
            messages.push({ role: 'assistant', content: payload.response as string });
          }
          break;
        }
        case 'tool:after':
        case 'tool.after': {
          const toolName = payload.toolName as string;
          const content = payload.error
            ? String(payload.error)
            : typeof payload.result === 'string'
              ? payload.result
              : JSON.stringify(payload.result ?? '');
          const msg: import('@primo-ai/sdk').Message = {
            role: 'tool',
            content,
            toolCallId: `restored_${toolName}_${toolCallIdx++}`,
            toolName,
          };
          if (payload.error) (msg as import('@primo-ai/sdk').Message & { error?: string }).error = String(payload.error);
          if (payload.result !== undefined) (msg as import('@primo-ai/sdk').Message & { result?: unknown }).result = payload.result;
          messages.push(msg);
          break;
        }
        case 'error': {
          messages.push({ role: 'assistant', content: `[Error] ${String(payload.error)}` });
          break;
        }
        default:
          break;
      }
    }

    // Apply pagination
    if (options?.limit && options.limit > 0) {
      return messages.slice(-options.limit);
    }

    return messages;
  }
}
