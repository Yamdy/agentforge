export interface PendingPermission {
  permissionId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  createdAt: string;
}

export class PermissionManager {
  private pending = new Map<string, {
    resolve: (approved: boolean) => void;
    permission: PendingPermission;
  }>();

  awaitDecision(permission: PendingPermission): Promise<boolean> {
    return new Promise((resolve) => {
      this.pending.set(permission.permissionId, { resolve, permission });
    });
  }

  resolve(permissionId: string, approved: boolean): void {
    const entry = this.pending.get(permissionId);
    if (!entry) throw new Error(`Permission not found: ${permissionId}`);
    entry.resolve(approved);
    this.pending.delete(permissionId);
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
