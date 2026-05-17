<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTraces } from '../composables/useTraces';

const router = useRouter();
const filter = ref<Record<string, string>>({});
const { traces, total, isLoading } = useTraces(filter);

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'agentName', label: 'Agent' },
  { key: 'status', label: 'Status' },
  { key: 'duration', label: 'Duration' },
  { key: 'tokenTotal', label: 'Tokens' },
  { key: 'startTime', label: 'Started' },
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function viewTrace(id: string) {
  router.push(`/traces/${id}`);
}
</script>

<template>
  <div class="trace-list">
    <h2>Traces ({{ total }})</h2>
    <div v-if="isLoading" class="loading">Loading traces...</div>
    <table v-else class="table">
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key">{{ col.label }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="trace in traces" :key="trace.id">
          <td class="cell-mono">{{ trace.id.slice(0, 8) }}...</td>
          <td>{{ trace.agentName }}</td>
          <td>{{ trace.status }}</td>
          <td>{{ trace.duration }}ms</td>
          <td>{{ trace.tokenTotal.toLocaleString() }}</td>
          <td>{{ formatTime(trace.startTime) }}</td>
          <td>
            <button class="link-btn" @click="viewTrace(trace.id)">View</button>
          </td>
        </tr>
        <tr v-if="traces.length === 0">
          <td :colspan="columns.length + 1" class="empty">No traces found.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.trace-list {
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

.link-btn {
  background: none;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}

.link-btn:hover {
  background: var(--hover-bg, #f0f0f0);
}

.empty {
  text-align: center;
  color: var(--muted-color, #888);
  padding: 24px;
}
</style>
