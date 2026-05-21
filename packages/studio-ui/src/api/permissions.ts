import { api } from './client';

export interface PendingPermission {
  permissionId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  createdAt: string;
}

export async function fetchPendingPermissions(): Promise<{ permissions: PendingPermission[] }> {
  const data = await api<PendingPermission[]>('/permissions/pending');
  return { permissions: data };
}

export async function respondPermission(permissionId: string, approved: boolean): Promise<void> {
  await api(`/permissions/pending/${permissionId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ approved }),
  });
}
