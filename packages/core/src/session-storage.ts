import type { SessionEvent, SessionRecord, SessionStorage, SessionStatus, IntegrityReport } from '@primo-ai/sdk';
import { appendFile, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { EventBus } from './event-bus.js';

export interface FilesystemSessionStorageOptions {
  /** Session TTL in seconds. Sessions with terminal status older than TTL are filtered from list() and cleaned up. */
  ttl?: number;
  /** Optional EventBus for emitting integrity error events. */
  eventBus?: EventBus;
  /** Skip checksum validation on read(). Default: false. */
  skipChecksum?: boolean;
}

export class FilesystemSessionStorage implements SessionStorage {
  private ttl?: number;
  private eventBus?: EventBus;
  private skipChecksum: boolean;

  constructor(private basePath: string, options?: FilesystemSessionStorageOptions) {
    this.ttl = options?.ttl;
    this.eventBus = options?.eventBus;
    this.skipChecksum = options?.skipChecksum ?? false;
  }

  private validateSessionId(sessionId: string): void {
    if (new RegExp('[/\\\\]|\\.\\.').test(sessionId)) {
      throw new Error(`Invalid sessionId: ${sessionId}`);
    }
  }

  private computeChecksum(event: SessionEvent): string {
    return createHash('sha256')
      .update(JSON.stringify({ seq: event.seq, timestamp: event.timestamp, type: event.type, payload: event.payload }))
      .digest('hex');
  }

  private verifyChecksum(event: SessionEvent): boolean {
    if (!event.checksum) return false;
    const expected = this.computeChecksum(event);
    return event.checksum === expected;
  }

  async append(sessionId: string, event: SessionEvent): Promise<void> {
    this.validateSessionId(sessionId);
    const dir = this.sessionDir(sessionId);
    await mkdir(dir, { recursive: true });
    const eventWithChecksum: SessionEvent = {
      ...event,
      checksum: this.computeChecksum(event),
    };
    const line = JSON.stringify(eventWithChecksum) + '\n';
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
        const event = JSON.parse(trimmed) as SessionEvent;
        if (!this.skipChecksum && !this.verifyChecksum(event)) {
          this.eventBus?.emit('session:integrity_error', {
            sessionId,
            seq: event.seq,
            expected: this.computeChecksum(event),
            actual: event.checksum,
          });
          continue; // Skip events with invalid checksum
        }
        yield event;
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

    const now = Date.now();
    const records: SessionRecord[] = [];
    for (const sessionId of entries) {
      const meta = await this.readMeta(sessionId);
      if (!meta) continue;
      if (filter?.parentSessionId && meta.parentSessionId !== filter.parentSessionId) continue;
      if (filter?.status && meta.status !== filter.status) continue;
      // Filter out expired sessions (terminal status + older than TTL)
      if (this.ttl && this.isExpired(meta, now)) continue;
      records.push(meta);
    }
    return records;
  }

  private isExpired(meta: SessionRecord, now?: number): boolean {
    if (!this.ttl) return false;
    const terminalStatuses: SessionStatus[] = ['completed', 'cancelled', 'error'];
    if (!terminalStatuses.includes(meta.status)) return false;
    const updatedAt = new Date(meta.updatedAt).getTime();
    return (now ?? Date.now()) - updatedAt > this.ttl * 1000;
  }

  async verifyIntegrity(sessionId: string): Promise<IntegrityReport> {
    this.validateSessionId(sessionId);
    const filePath = this.eventsPath(sessionId);
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return { sessionId, valid: true, totalEvents: 0, invalidEvents: 0, errors: [] };
    }

    const errors: IntegrityReport['errors'] = [];
    let totalEvents = 0;
    let invalidEvents = 0;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      totalEvents++;
      try {
        const event = JSON.parse(trimmed) as SessionEvent;
        if (!event.checksum) {
          invalidEvents++;
          errors.push({ seq: event.seq, expected: 'checksum_missing', actual: 'undefined' });
        } else if (!this.verifyChecksum(event)) {
          invalidEvents++;
          errors.push({
            seq: event.seq,
            expected: this.computeChecksum(event),
            actual: event.checksum,
          });
        }
      } catch {
        invalidEvents++;
        errors.push({ seq: -1, expected: 'valid_json', actual: 'parse_error' });
      }
    }

    return {
      sessionId,
      valid: invalidEvents === 0,
      totalEvents,
      invalidEvents,
      errors,
    };
  }

  async cleanup(): Promise<number> {
    if (!this.ttl) return 0;
    let entries: string[];
    try {
      entries = await readdir(this.basePath);
    } catch {
      return 0;
    }

    const now = Date.now();
    let deleted = 0;
    for (const sessionId of entries) {
      const meta = await this.readMeta(sessionId);
      if (!meta) continue;
      if (this.isExpired(meta, now)) {
        await rm(this.sessionDir(sessionId), { recursive: true, force: true });
        deleted++;
      }
    }
    return deleted;
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
          const input = payload.input as string | undefined;
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
