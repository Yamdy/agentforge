<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSessions } from '../composables/useSessions';

const router = useRouter();
const { sessions, total, isLoading } = useSessions();

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'agentName', label: 'Agent' },
  { key: 'status', label: 'Status' },
  { key: 'messageCount', label: 'Messages' },
  { key: 'createdAt', label: 'Created' },
  { key: 'updatedAt', label: 'Updated' },
];

function formatTime(ts: string): string {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="session-list">
    <h2>Sessions ({{ total }})</h2>
    <div v-if="isLoading" class="loading">Loading sessions...</div>
    <table v-else class="table">
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key">{{ col.label }}</th>
          <th v-if="false"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="session in sessions" :key="session.id">
          <td class="cell-mono">{{ session.id.slice(0, 8) }}...</td>
          <td>{{ session.agentName }}</td>
          <td>{{ session.status }}</td>
          <td>{{ session.messageCount }}</td>
          <td>{{ formatTime(session.createdAt) }}</td>
          <td>{{ formatTime(session.updatedAt) }}</td>
        </tr>
        <tr v-if="sessions.length === 0">
          <td :colspan="columns.length" class="empty">No sessions found.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.session-list {
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

.empty {
  text-align: center;
  color: var(--muted-color, #888);
  padding: 24px;
}
</style>
