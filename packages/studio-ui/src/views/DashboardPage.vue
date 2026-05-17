<script setup lang="ts">
import { useTraces } from '../composables/useTraces';
import { useKpi } from '../composables/useMetrics';
import KpiCard from '../components/KpiCard.vue';
import { useRouter } from 'vue-router';
import { computed } from 'vue';

const router = useRouter();

const { traces, isLoading: tracesLoading } = useTraces({ limit: '10' });
const { kpi, isLoading: kpiLoading } = useKpi('24h');

const recentTraces = computed(() => traces.value.slice(0, 10));
</script>

<template>
  <div class="dashboard">
    <section class="kpi-row">
      <KpiCard title="Total Runs" :value="kpi?.totalRuns ?? 0" :loading="kpiLoading" />
      <KpiCard title="Avg Latency" :value="kpi ? `${kpi.avgLatency.toFixed(0)}ms` : '-'" :loading="kpiLoading" />
      <KpiCard title="Total Tokens" :value="kpi?.totalTokens.toLocaleString() ?? 0" :loading="kpiLoading" />
      <KpiCard title="Estimated Cost" :value="kpi ? `$${kpi.estimatedCost.toFixed(4)}` : '-'" :loading="kpiLoading" />
    </section>

    <section class="section">
      <h2 class="section-title">Recent Traces</h2>
      <div v-if="tracesLoading" class="loading">Loading traces...</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Agent</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Tokens</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="trace in recentTraces" :key="trace.id">
            <td class="cell-mono">{{ trace.id.slice(0, 8) }}...</td>
            <td>{{ trace.agentName }}</td>
            <td>{{ trace.status }}</td>
            <td>{{ trace.duration }}ms</td>
            <td>{{ trace.tokenTotal.toLocaleString() }}</td>
            <td>
              <button class="link-btn" @click="router.push(`/traces/${trace.id}`)">View</button>
            </td>
          </tr>
          <tr v-if="recentTraces.length === 0">
            <td colspan="6" class="empty">No traces yet.</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 1200px;
}

.kpi-row {
  display: flex;
  gap: 16px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}

.section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px;
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
  transition: background 0.15s;
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
