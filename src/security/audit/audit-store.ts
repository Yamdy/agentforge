/**
 * AgentForge Audit Store
 */

import type { AuditEntry, AuditFilter } from './audit-logger.js';

export interface AuditStore {
  append(entry: AuditEntry): void;
  query(filter: AuditFilter): AuditEntry[];
  getAll(): AuditEntry[];
  clear(): void;
  count(): number;
}

export class InMemoryAuditStore implements AuditStore {
  private readonly entries: AuditEntry[] = [];

  append(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  query(filter: AuditFilter): AuditEntry[] {
    return this.entries.filter(entry => {
      if (filter.eventType && entry.eventType !== filter.eventType) return false;
      if (filter.sessionId && entry.sessionId !== filter.sessionId) return false;
      if (filter.result && entry.result !== filter.result) return false;
      if (filter.since) {
        const entryTime = new Date(entry.timestamp).getTime();
        const sinceTime = new Date(filter.since).getTime();
        if (entryTime < sinceTime) return false;
      }
      if (filter.until) {
        const entryTime = new Date(entry.timestamp).getTime();
        const untilTime = new Date(filter.until).getTime();
        if (entryTime > untilTime) return false;
      }
      return true;
    });
  }

  getAll(): AuditEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }

  count(): number {
    return this.entries.length;
  }
}
