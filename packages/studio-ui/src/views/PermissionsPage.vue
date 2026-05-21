<script setup lang="ts">
import { usePermissions } from '../composables/usePermissions';

const { permissions, pendingCount, isLoading, approve, deny } = usePermissions();

const columns = [
  { key: 'toolName', label: 'Tool' },
  { key: 'reason', label: 'Reason' },
  { key: 'sessionId', label: 'Session' },
  { key: 'createdAt', label: 'Time' },
  { key: 'actions', label: '' },
];

function formatTime(ts: string): string {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="permissions-page">
    <h2>Permissions ({{ pendingCount }})</h2>
    <div v-if="isLoading" class="loading">Loading permissions...</div>
    <table v-else-if="permissions.length > 0" class="table">
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key">{{ col.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="perm in permissions" :key="perm.permissionId">
          <td>{{ perm.toolName }}</td>
          <td class="cell-mono">{{ perm.reason }}</td>
          <td class="cell-mono">{{ perm.sessionId.slice(0, 12) }}...</td>
          <td>{{ formatTime(perm.createdAt) }}</td>
          <td class="actions-cell">
            <button class="btn-approve" @click="approve(perm.permissionId)">Approve</button>
            <button class="btn-deny" @click="deny(perm.permissionId)">Deny</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">No pending permissions</div>
  </div>
</template>

<style scoped>
.permissions-page {
  max-width: 1200px;
}

h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px;
}

.loading {
  padding: 20px;
  color: var(--muted-color, #888);
}

.table {
  width: 100%;
  border-collapse: collapse;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
}

.table th,
.table td {
  padding: 10px 14px;
  text-align: left;
  font-size: 13px;
}

.table th {
  background: var(--table-header-bg, #fafafa);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  color: var(--muted-color, #888);
}

.table tbody tr {
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.table tbody tr:hover {
  background: var(--hover-bg, #fafafa);
}

.cell-mono {
  font-family: monospace;
  font-size: 12px;
}

.actions-cell {
  white-space: nowrap;
}

.btn-approve {
  background: #16a34a;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
  margin-right: 6px;
}

.btn-approve:hover {
  background: #15803d;
}

.btn-deny {
  background: #dc2626;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
}

.btn-deny:hover {
  background: #b91c1c;
}

.empty {
  text-align: center;
  color: var(--muted-color, #888);
  padding: 24px;
}
</style>
