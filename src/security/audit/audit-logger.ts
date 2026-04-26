/**
 * AgentForge Audit Logger
 */

import type { AuditStore } from './audit-store.js';
import { InMemoryAuditStore } from './audit-store.js';

export type AuditEventType =
  | 'permission.check'
  | 'permission.denied'
  | 'permission.granted'
  | 'tool.execute'
  | 'tool.error'
  | 'injection.detected'
  | 'args.rejected'
  | 'rate.limited'
  | 'sandbox.violation';

export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  agentName: string;
  eventType: AuditEventType;
  action: string;
  resource: string;
  result: 'success' | 'denied' | 'error';
  details: Record<string, unknown>;
}

export interface AuditFilter {
  eventType?: AuditEventType;
  sessionId?: string;
  result?: 'success' | 'denied' | 'error';
  since?: string;
  until?: string;
}

export interface AuditLoggerConfig {
  sessionId: string;
  agentName: string;
  store?: AuditStore;
  enableIntegrity?: boolean;
}

export class DefaultAuditLogger implements AuditLogger {
  private readonly sessionId: string;
  private readonly agentName: string;
  private readonly store: AuditStore;
  private readonly enableIntegrity: boolean;

  constructor(config: AuditLoggerConfig) {
    this.sessionId = config.sessionId;
    this.agentName = config.agentName;
    this.store = config.store ?? new InMemoryAuditStore();
    this.enableIntegrity = config.enableIntegrity ?? true;
  }

  append(entry: Omit<AuditEntry, 'timestamp'>): void {
    try {
      const fullEntry: AuditEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        agentName: this.agentName,
      };
      this.store.append(fullEntry);
    } catch {
      // Audit failure must never crash
    }
  }

  query(filter: AuditFilter): AuditEntry[] {
    return this.store.query(filter);
  }

  verifyIntegrity(): boolean {
    if (!this.enableIntegrity) return true;
    const entries = this.store.getAll();
    for (const entry of entries) {
      const ts = new Date(entry.timestamp);
      if (isNaN(ts.getTime())) return false;
    }
    return true;
  }

  getStore(): AuditStore {
    return this.store;
  }
}

export interface AuditLogger {
  append(entry: Omit<AuditEntry, 'timestamp'>): void;
  query(filter: AuditFilter): AuditEntry[];
  verifyIntegrity(): boolean;
}
