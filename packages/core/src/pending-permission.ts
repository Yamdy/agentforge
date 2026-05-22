export interface PendingPermission {
  permissionId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  createdAt: string;
}

export interface PermissionManagerOptions {
  eventBus?: { emit(eventType: string, data?: unknown): void };
  sessionId?: string;
}

export class PermissionManager {
  private pending = new Map<string, {
    resolve: (approved: boolean) => void;
    permission: PendingPermission;
  }>();
  private decisionCache = new Map<string, boolean>();
  private eventBus?: { emit(eventType: string, data?: unknown): void };
  private sessionId?: string;

  constructor(options?: PermissionManagerOptions) {
    this.eventBus = options?.eventBus;
    this.sessionId = options?.sessionId;
  }

  awaitDecision(permission: PendingPermission): Promise<boolean> {
    const cached = this.decisionCache.get(permission.permissionId);
    if (cached !== undefined) {
      this.decisionCache.delete(permission.permissionId);
      return Promise.resolve(cached);
    }

    this.eventBus?.emit('permission:requested', {
      ...permission,
      sessionId: this.sessionId ?? permission.sessionId,
    });

    return new Promise((resolve) => {
      this.pending.set(permission.permissionId, { resolve, permission });
    });
  }

  resolve(permissionId: string, approved: boolean): void {
    this.eventBus?.emit('permission:decided', {
      permissionId,
      approved,
      sessionId: this.sessionId,
    });

    const entry = this.pending.get(permissionId);
    if (entry) {
      entry.resolve(approved);
      this.pending.delete(permissionId);
    } else {
      this.decisionCache.set(permissionId, approved);
    }
  }

  applyDecision(permissionId: string, approved: boolean): void {
    const entry = this.pending.get(permissionId);
    if (entry) {
      entry.resolve(approved);
      this.pending.delete(permissionId);
    } else {
      this.decisionCache.set(permissionId, approved);
    }
  }

  list(): PendingPermission[] {
    return Array.from(this.pending.values()).map(e => e.permission);
  }

  getBySession(sessionId: string): PendingPermission[] {
    return this.list().filter(p => p.sessionId === sessionId);
  }

  get(permissionId: string): PendingPermission | undefined {
    return this.pending.get(permissionId)?.permission;
  }
}
